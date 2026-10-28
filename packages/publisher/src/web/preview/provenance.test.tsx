/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createCopyResolver, type CopyRegistry } from "@clossys/writer";
import { fallbackChain } from "@clossys/writer/locale";
import { resolveSectionedViewDocument } from "../../core/sectioned-view.js";
import { refField } from "../../content/__fixtures__/copy-ref.js";
import { resolveCopy } from "../../content/composition.js";
import { copyLocaleProvenance } from "../../content/copy-provenance.js";
import { computeContentDigest } from "../../content/digest.js";
import { SectionedView } from "../views/SectionedView.js";
import { assertRenderableSectionedViewDocument } from "../views/SectionedViewContent.js";
import { contentRouteCandidate, contentRouteFixture } from "../__fixtures__/content-route.js";
import { prepareContentRoute } from "../content-route.js";
import { RawContentPreview } from "./raw.js";
import { createContentPreviewProvenance } from "./provenance.js";

const manifest = {
  defaultLocale: "en", locales: [
    { tag: "en", dir: "ltr", state: "active" },
    { tag: "fr", dir: "ltr", state: "active" },
    { tag: "ar", dir: "rtl", state: "active" },
  ], fallback: { ar: ["en"], fr: ["en"] },
} satisfies Parameters<typeof fallbackChain>[1];
const registry: CopyRegistry = { id: "preview-copy", revision: "copy-r7", locale: "en",
  source: { kind: "consumer", reference: "preview-fixture" },
  entries: [{ id: "preview.body", text: "Continue to your workspace", context: "Preview body", status: "approved" }],
};
const resolver = createCopyResolver(registry, { manifest });
const documentFor = (locale: string) => resolveSectionedViewDocument({ id: "preview-fixture", sections: [
  { id: "intro", kind: "hero", ground: "base", heading: { id: "preview.body", locale } },
] }, resolver);

function routeFor(locale: string) {
  const input = contentRouteFixture();
  const current = input.registry.candidates[0]!;
  const content = { ...current, composition: { ...current.composition!, sections: [{ ...current.composition!.sections[0]!, fields: [refField("title", locale, "preview.body")] }] },
    pageMeta: current.pageMeta!.map(field => ({ ...field, locale })),
  };
  return { ...input, locale, writer: { registry, manifest },
    frameCopy: input.frameCopy!.map(field => ({ ...field, locale })),
    registry: { ...input.registry,
      workspace: { ...input.registry.workspace, locales: ["en", "fr", "ar"] },
      slots: input.registry.slots.map(slot => ({ ...slot, locales: ["en", "fr", "ar"] })),
      candidates: [contentRouteCandidate(content, current.id, current.slotId)],
    },
  };
}

describe("preview locale provenance", () => {
  it.each(["en", "fr", "ar"])("keeps a valid %s resolved preview renderable with its complete Writer trace", locale => {
    const document = documentFor(locale);
    const before = structuredClone(document);
    expect(() => assertRenderableSectionedViewDocument(document)).not.toThrow();
    expect(renderToStaticMarkup(<SectionedView document={document} />)).toContain("Continue to your workspace");
    expect(document.resolutions[0]).toMatchObject({ locale: "en", servedLocale: "en", chain: fallbackChain(locale, manifest), revision: "copy-r7", ref: { locale } });
    expect(document).toEqual(before);
  });

  it.each(["servedLocale", "chain"])("refuses a preview missing %s", field => {
    const document = structuredClone(documentFor("ar"));
    delete (document.resolutions[0]! as unknown as Record<string, unknown>)[field];
    expect(() => renderToStaticMarkup(<SectionedView document={document} />)).toThrow(field);
  });

  it("preserves Writer's omission of an undeclared request from its available chain", () => {
    const document = resolveSectionedViewDocument({ id: "preview-fixture", sections: [
      { id: "intro", kind: "hero", ground: "base", heading: { id: "preview.body", locale: "fr" } },
    ] }, createCopyResolver(registry));
    expect(copyLocaleProvenance(document.resolutions[0])).toEqual({ requestedLocale: "fr", servedLocale: "en", chain: ["en"], reason: "writer-fallback" });
    expect(() => assertRenderableSectionedViewDocument(document)).not.toThrow();
  });

  it.each([
    { servedLocale: "fr" }, { servedLocale: "en-us" }, { locale: "ar" },
    { chain: [] }, { chain: ["ar", "ar", "en"] }, { chain: ["en", "ar"] },
    { chain: ["ar"] }, { chain: ["ar", "en-us"] }, { chain: ["ar", , "en"] },
  ])("refuses inconsistent locale evidence %j", patch => {
    const document = structuredClone(documentFor("ar"));
    Object.assign(document.resolutions[0]!, patch);
    expect(() => assertRenderableSectionedViewDocument(document)).toThrow(/servedLocale|chain|requestedLocale/);
  });

  it.each(["ar", "fr"])("records %s -> en on the actual selected slot and copy revision", locale => {
    const input = routeFor(locale), before = structuredClone(input);
    const prepared = prepareContentRoute(input);
    expect(prepared.status).toBe("ready");
    expect(prepared.provenance).toMatchObject({ slotId: input.slotId, candidateId: "sign-in", revision: "r1",
      digest: computeContentDigest(input.registry.candidates[0]!), libraryVersion: "1", requestedLocale: locale,
      copy: [{ binding: "sections.message", requestedLocale: locale, servedLocale: "en", chain: [locale, "en"], reason: "writer-fallback",
        recordId: registry.id, revision: "copy-r7", entryId: "preview.body", source: registry.source }],
    });
    expect(JSON.stringify(prepared.provenance)).not.toContain(registry.entries[0]!.text);
    expect(prepared.copyFindings).toContainEqual(expect.objectContaining({ rule: "body-copy-fallback", locale, servedLocale: "en", chain: [locale, "en"] }));
    expect(renderToStaticMarkup(<RawContentPreview input={input} />)).toContain(registry.entries[0]!.text);
    expect(input).toEqual(before);
  });

  it("preserves the full policy after the selected locale and refuses truncation", () => {
    const policy = { ...manifest, fallback: { ...manifest.fallback, ar: ["en", "fr"] } };
    const input = routeFor("ar"); input.writer.manifest = policy;
    const prepared = prepareContentRoute(input);
    expect(prepared.provenance?.copy[0]?.chain).toEqual(["ar", "en", "fr"]);
    const resolution = createCopyResolver(registry, { manifest: policy })({ id: "preview.body", locale: "ar" })!;
    expect(() => copyLocaleProvenance({ ...resolution, chain: ["ar", "en"] }, "preview.body", { requestedLocale: "ar", chain: fallbackChain("ar", policy) })).toThrow("chain");
  });

  it("refuses recording missing servedLocale and binds evidence to the immutable candidate", () => {
    const prepared = prepareContentRoute(routeFor("ar"));
    const report = resolveCopy(prepared.candidate, "ar", { resolver });
    const incomplete = structuredClone(report);
    delete incomplete.resolutions[0]!.servedLocale;
    expect(() => createContentPreviewProvenance(prepared, [{ binding: "preview.body", report: incomplete }], manifest)).toThrow("servedLocale");
    expect(() => createContentPreviewProvenance(prepared, [], manifest)).toThrow("complete copy provenance");
    expect(() => createContentPreviewProvenance(prepared, [{ binding: "body", report: { ...report, resolutions: [] } }], manifest)).toThrow("complete copy provenance");
    const retained = createContentPreviewProvenance(prepared, [{ binding: "body", report }], manifest);
    report.resolutions[0]!.chain!.push("fr");
    expect(retained.copy[0]?.chain).toEqual(["ar", "en"]);
    const drifted = { ...prepared, candidate: { ...prepared.candidate, composition: { ...prepared.candidate.composition!, libraryVersion: "2" } } };
    expect(() => createContentPreviewProvenance(drifted, [], manifest)).toThrow("digest");
  });

  it("retains explicit native inline compatibility evidence without inventing a Writer revision", () => {
    const prepared = prepareContentRoute(contentRouteFixture());
    expect(prepared.provenance?.copy).toEqual([]);
    expect(prepared.provenance?.inline.length).toBeGreaterThan(0);
    expect(prepared.provenance?.inline.every(row => row.requestedLocale === "en" && row.servedLocale === "en" && row.chain.join() === "en")).toBe(true);
  });
});
