// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { createHash } from "node:crypto";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { ComposeDocument } from "../core/index.js";
import { RenderError } from "../internal/errors.js";
import { createWebRenderer } from "./internal/createWebRenderer.js";
import { getWebTemplate } from "./internal/webTemplates.js";
import { renderWebDocument } from "./renderWebDocument.js";
import type { RenderWebOptions } from "./types.js";
import type { SiteFrameInput } from "./frame/types.js";

const frame: SiteFrameInput = {
  shell: {
    brand: { assetId: "mark", label: { id: "Example home" }, variant: "mark", size: "md" },
    skipLink: { id: "Skip to content" },
    origin: "https://example.com",
    environments: [{ href: "https://app.example.com/", label: { id: "App" }, icon: [["path", { d: "M4 12h16" }]], isCurrent: true }],
    footer: { legal: { entity: { id: "Example Ltd" }, links: [{ href: "/privacy", label: { id: "Privacy" } }] } },
  },
  resolveCopy: ref => ({ ref, text: ref.id, recordId: "fixture", entryId: ref.id, revision: "1", locale: "en", source: { kind: "consumer", reference: "fixture" } }),
  resolveAsset: () => ({ type: "image", src: "/mark.svg", width: 48, height: 48, alt: "Example mark" }),
};
const doc: ComposeDocument = {
  id: "auth", channel: "web", template: "AuthView",
  meta: { channel: "web", title: "Sign in", description: "Continue." },
  bindings: [{ slot: "heading", value: "Sign in" }, { slot: "form", value: "Form content" }, { slot: "footnote", value: "Account notice" }],
};
const framed = (value: unknown) => ({ frame: value } as RenderWebOptions);
const html = (document = doc, options: RenderWebOptions = {}) => renderToStaticMarkup(renderWebDocument(document, options).element);

describe("renderWebDocument optional AuthView frame", () => {
  it.each([false, true])("frames only the shipped AuthView with one set of landmarks (instance=%s)", instance => {
    const renderer = instance ? createWebRenderer({ includeBuiltins: true }).renderWebDocument : renderWebDocument;
    const result = renderer(doc, { frame });
    const root = document.createElement("div");
    root.innerHTML = renderToStaticMarkup(result.element);
    for (const selector of ["header", "main#publisher-main-content", "footer", "h1"]) expect(root.querySelectorAll(selector)).toHaveLength(1);
    const main = root.querySelector("main")!;
    expect(main.querySelector("header, footer, main")).toBeNull();
    for (const text of ["Sign in", "Form content", "Account notice"]) expect(main).toHaveTextContent(text);
    expect(root.querySelector('header a[aria-label="Example home"]')).toHaveAttribute("href", "https://example.com/");
    expect(root.querySelector("footer a")).toHaveAttribute("href", "https://example.com/privacy");
    expect(root.querySelector("[data-consent-banner], [data-consent-presentation=card], [role=dialog]")).toBeNull();
    expect(result.head).toEqual(renderWebDocument({ ...doc, bindings: [{ slot: "brand", value: "Example" }, ...doc.bindings] }).head);
  });

  it.each(["brand", "footerSecondary"].flatMap(slot => [
    { slot, copyId: "payload" }, { slot, value: "" }, { slot, value: "Chrome" },
  ]))("refuses a document chrome binding before resolving it: %j", binding => {
    const resolveCopyId = vi.fn();
    expect(() => renderWebDocument({ ...doc, bindings: [...doc.bindings, binding] }, { frame, resolveCopyId })).toThrow(/frame.*chrome binding/);
    expect(resolveCopyId).not.toHaveBeenCalled();
  });

  it.each([
    ["ErrorView", [{ slot: "status", value: "404" }, { slot: "title", value: "Not found" }]],
    ["MarketingView", [{ slot: "brand", value: "Example" }, { slot: "heroHeading", value: "Welcome" }, { slot: "ctaHeading", value: "Continue" }]],
    ["Unknown", []],
  ] as const)("refuses frame on %s", (template, bindings) => {
    const options = { frame, ...(template === "MarketingView" ? { groups: [{ slot: "features", items: [] }] } : {}) };
    const document = { ...doc, template, bindings: [...bindings] };
    expect(() => renderWebDocument(document, options)).toThrow(RenderError);
  });

  it("refuses a consumer template named AuthView even when it copies the built-in", () => {
    const consumer = { ...getWebTemplate("AuthView")! };
    const renderer = createWebRenderer({ templates: [consumer] });
    expect(() => renderer.renderWebDocument(doc, { frame })).toThrow(/frame.*built-in AuthView/);
  });

  it.each([
    null, [], true, {}, { ...frame, children: "payload" }, { ...frame, resolveCopy: null }, { ...frame, resolveAsset: null },
    { ...frame, resolveCopy: () => { throw new Error("payload"); } }, { ...frame, shell: null },
    { ...frame, shell: { ...frame.shell, extra: "payload" } }, { ...frame, presentation: { extra: true } },
    ...["https:example.com", "https://example.com/.", "https://@www.example.test/"].map(origin => ({ ...frame, shell: { ...frame.shell, origin } })),
  ])("refuses malformed frame %j", value => {
    expect(() => renderWebDocument(doc, framed(value))).toThrow(RenderError);
    expect(() => renderWebDocument(doc, framed(value))).not.toThrow(/payload/);
  });

  it("refuses frame accessors and unsupported own keys without invoking accessors", () => {
    let reads = 0;
    const accessor = { ...frame, get shell() { reads++; return frame.shell; } };
    for (const value of [accessor, { ...frame, [Symbol("field")]: true }, Object.create(frame)]) expect(() => renderWebDocument(doc, framed(value))).toThrow(RenderError);
    expect(reads).toBe(0);
  });

  it("keeps unframed AuthView body/footer bytes with the new header surface and required brand binding", () => {
    const legacy = { ...doc, bindings: [{ slot: "brand", value: "Example" }, ...doc.bindings] };
    const output = html(legacy);
    expect(output).toContain('data-surface="solid" data-tone="base"');
    // Project only the deliberately changed opening tag; keep the original full-page digest.
    const legacyHeaderProjection = output.replace(/<header\b[^>]*>/, '<header data-header-root="" class="bg-surface-raised py-sm border-b border-line-base site-header-contract" style="position:relative;z-index:var(--ui-z-shell, 20);border-bottom-width:var(--ui-border-hairline, 1px)">');
    expect(createHash("sha256").update(legacyHeaderProjection).digest("hex")).toBe("42bad8f517d038103ec6bf994fec76ae1e887848631ac8266727c5b39b5c6cd1");
    expect(html(legacy, { frame: undefined })).toBe(output);
    expect(() => html(doc)).toThrow(/brand/);
  });
});
