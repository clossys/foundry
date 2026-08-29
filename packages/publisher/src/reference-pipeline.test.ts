import { createCopyResolver, validateCopyRegistryShape } from "@clossys/writer";
import type { CopyRegistry } from "@clossys/writer";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { createResolvedOutputManifest } from "./core/output-manifest.js";
import { resolveSurfaceDocument, SurfaceResolutionError } from "./core/resolve-surface.js";
import type { StrategyProvenance, SurfaceDocument } from "./core/types.js";
import { renderEmailDocument } from "./email/renderEmailDocument.js";
import { renderImageDocument } from "./image/renderImageDocument.js";
import { renderPrintDocument } from "./print/renderPrintDocument.js";
import { renderSlidesDeck } from "./slides/renderSlidesDeck.js";
import { renderWebDocument } from "./web/renderWebDocument.js";
import { getWebTemplate } from "./web/internal/webTemplates.js";

const registry: CopyRegistry = {
  id: "reference-fixture",
  locale: "en",
  revision: "fixture-1",
  source: { kind: "consumer", reference: "fixtures/reference-pipeline" },
  entries: [
    ["description", "Description"],
    ["form", "Form"],
    ["web-title", "Reference title"],
    ["web-description", "Reference description"],
    ["email-subject", "Email subject"],
    ["email-preheader", "Email preheader"],
    ["email-body", "Email body"],
    ["canvas", "Canvas text"],
    ["image-alt", "Reference image"],
  ].map(([suffix, text]) => ({ id: `reference.${suffix}`, text, context: "reference pipeline fixture", status: "approved" as const })).concat({
    id: "reference.heading",
    text: "Heading for {audience}",
    context: "reference pipeline fixture",
    placeholders: ["audience"],
    status: "approved",
  }),
};

const provenance: StrategyProvenance = {
  strategyId: "reference-strategy",
  revision: "fixture-1",
  records: [{ kind: "fact", id: "reference.category", revision: "fixture-1" }],
  fingerprint: "sha256:reference-fixture",
};

const canvasLayout = {
  slots: [{ key: "copy", element: "heading" as const, frame: { x: 0.1, y: 0.1, w: 0.8, h: 0.3 }, required: true }],
};

const copyResolver = createCopyResolver(registry);
const ref = (id: string, values?: Record<string, string | number | boolean>) => ({ id: `reference.${id}`, ...(values === undefined ? {} : { values }) });

describe("reference pipeline fixture", () => {
  it("binds approved copy through a real resolver, uses flowed UI slots, and emits every channel's publish manifest", () => {
    expect(validateCopyRegistryShape(registry)).toEqual([]);
    const authTemplate = getWebTemplate("AuthView")!;
    expect(authTemplate.flow.slots.every((slot) => !("frame" in slot) && !("element" in slot))).toBe(true);

    const web: SurfaceDocument = {
      id: "reference.web",
      channel: "web",
      meta: { channel: "web", title: ref("web-title"), description: ref("web-description") },
      template: "AuthView",
      bindings: [
        { slot: "heading", copy: ref("heading", { audience: "someone" }) },
        { slot: "description", copy: ref("description") },
        { slot: "form", copy: ref("form") },
      ],
    };
    const email: SurfaceDocument = {
      id: "reference.email",
      channel: "email",
      meta: { channel: "email", subject: ref("email-subject"), preheader: ref("email-preheader") },
      template: "reference-email",
      bindings: [{ slot: "body", copy: ref("email-body") }],
    };
    const image: SurfaceDocument = {
      id: "reference.image",
      channel: "image",
      meta: { channel: "image", width: 400, height: 200, format: "svg", alt: ref("image-alt") },
      template: "reference-image",
      bindings: [{ slot: "copy", copy: ref("canvas") }],
      layout: canvasLayout,
    };
    const print: SurfaceDocument = {
      id: "reference.print",
      channel: "print",
      meta: { channel: "print", pageSize: "Letter", orientation: "portrait", margins: { top: "10mm", right: "10mm", bottom: "10mm", left: "10mm" } },
      template: "reference-print",
      bindings: [{ slot: "copy", copy: ref("canvas") }],
      layout: canvasLayout,
    };
    const slide: SurfaceDocument = {
      id: "reference.slide",
      channel: "slides",
      meta: { channel: "slides", aspect: "16:9" },
      template: "reference-slide",
      bindings: [{ slot: "copy", copy: ref("canvas") }],
      layout: canvasLayout,
    };

    // This is the consumer boundary: resolution must finish before a channel
    // renderer can produce an artifact or a publisher receives its manifest.
    const resolvedWeb = resolveSurfaceDocument(web, copyResolver);
    const resolvedEmail = resolveSurfaceDocument(email, copyResolver);
    const resolvedImage = resolveSurfaceDocument(image, copyResolver);
    const resolvedPrint = resolveSurfaceDocument(print, copyResolver);
    const resolvedSlide = resolveSurfaceDocument(slide, copyResolver);
    const webResult = renderWebDocument(resolvedWeb.document);
    const emailResult = renderEmailDocument(resolvedEmail.document, { flow: { slots: [{ key: "body", required: true }] } });
    const imageResult = renderImageDocument(resolvedImage.document);
    const printResult = renderPrintDocument(resolvedPrint.document);
    const slidesResult = renderSlidesDeck({ id: "reference-deck", slides: [resolvedSlide.document] });

    expect(renderToStaticMarkup(webResult.element)).toContain("Heading");
    expect(emailResult.html).toContain("Email body");
    expect(imageResult.svg).toContain("Canvas text");
    expect(printResult.html).toContain("Canvas text");
    expect(slidesResult.slides[0]!.svg).toContain("Canvas text");

    const manifests = [
      createResolvedOutputManifest(web, resolvedWeb, [{ id: "page", path: "reference/web.html", mediaType: "text/html" }], provenance),
      createResolvedOutputManifest(email, resolvedEmail, [{ id: "message", path: "reference/email.html", mediaType: "text/html" }], provenance),
      createResolvedOutputManifest(image, resolvedImage, [{ id: "image", path: "reference/image.svg", mediaType: "image/svg+xml" }], provenance),
      createResolvedOutputManifest(print, resolvedPrint, [{ id: "print", path: "reference/print.html", mediaType: "text/html" }], provenance),
      createResolvedOutputManifest(slide, resolvedSlide, [{ id: "slide", path: "reference/slide.svg", mediaType: "image/svg+xml" }], provenance),
    ];
    expect(manifests.map((manifest) => manifest.channel)).toEqual(["web", "email", "image", "print", "slides"]);
    expect(manifests.every((manifest) => manifest.provenance?.fingerprint === provenance.fingerprint)).toBe(true);
    expect(manifests.map((manifest) => manifest.copy?.flatMap((copy) => copy.entryIds))).toEqual([
      ["reference.description", "reference.form", "reference.heading", "reference.web-description", "reference.web-title"],
      ["reference.email-body", "reference.email-preheader", "reference.email-subject"],
      ["reference.canvas", "reference.image-alt"],
      ["reference.canvas"],
      ["reference.canvas"],
    ]);
    // Publication provenance is referential only: it must never become a
    // second store for rendered copy or per-request interpolation values.
    expect(JSON.stringify(manifests)).not.toContain("Heading");
    expect(JSON.stringify(manifests)).not.toContain("someone");
  });

  it("fails closed for unresolved approved sources and malformed source bindings", () => {
    const draftResolver = createCopyResolver({ ...registry, entries: registry.entries.map((entry) => (entry.id === "reference.heading" ? { ...entry, status: "draft" as const } : entry)) });
    const unresolved: SurfaceDocument = {
      id: "unresolved.web",
      channel: "web",
      meta: { channel: "web", title: ref("web-title"), description: ref("web-description") },
      template: "AuthView",
      bindings: [{ slot: "heading", copy: ref("heading") }, { slot: "form", copy: ref("form") }],
    };
    let publisherCalled = false;
    expect(() => {
      const resolved = resolveSurfaceDocument(unresolved, draftResolver);
      // A consumer publisher is downstream of both resolution and manifest
      // creation, so a failed source cannot leave a partial artifact behind.
      createResolvedOutputManifest(unresolved, resolved, [{ id: "page", path: "reference/unresolved.html", mediaType: "text/html" }], provenance);
      publisherCalled = true;
    }).toThrow(SurfaceResolutionError);
    expect(publisherCalled).toBe(false);

    const malformed: SurfaceDocument = {
      id: "invalid.email",
      channel: "email",
      meta: { channel: "email", subject: ref("email-subject"), preheader: ref("email-preheader") },
      template: "reference-email",
      bindings: [{ slot: "body", copy: { id: "" } }],
    };
    expect(() => resolveSurfaceDocument(malformed, copyResolver)).toThrow(SurfaceResolutionError);
  });
});
