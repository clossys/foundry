import { describe, expect, it } from "vitest";
import * as contract from "./sectioned-view.js";
import type { SectionedViewDocument } from "./sectioned-view.js";
const ref = (id = "copy") => ({ id });
const items = (count: number) => Array.from({ length: count }, (_, index) => ({ id: `item-${index}`, heading: ref(`heading-${index}`) }));
const document = (fields: Record<string, unknown>): SectionedViewDocument => ({ id: "page", sections: [{ id: "band", kind: "content-section", ground: "base", heading: ref(), ...fields }] }) as SectionedViewDocument;
const findings = (block: unknown) => contract.validateSectionedViewDocument(document({ block }));
const errors = (block: unknown) => findings(block).filter((entry) => entry.severity === "error");
const resolver = (value: { id: string }) => ({ ref: value, text: value.id === "scene-label" ? "A clear sample showing how source documents connect to the resolved result for this section" : value.id, recordId: "fixture", revision: "1", locale: "en", source: { kind: "consumer" as const, reference: "fixture" }, entryId: value.id });

describe("canonical frame", () => {
  it("accepts header-only split directions and all frame sizes, resolving defaults", () => {
    for (const size of ["standard", "display"]) for (const layout of ["stacked", "split-start", "split-end"]) expect(contract.validateSectionedViewDocument(document({ size, layout }))).toEqual([]);
    expect(contract.resolveSectionedViewDocument(document({}), resolver).sections[0]).toMatchObject({ size: "standard", layout: "stacked" });
  });
  it("replaces only unreleased hero compact boolean with compact/display size", () => {
    for (const size of ["compact", "display"]) expect(contract.validateSectionedViewDocument({ id: "page", sections: [{ id: "hero", kind: "hero", ground: "base", heading: ref(), size }] } as SectionedViewDocument)).toEqual([]);
    expect(contract.validateSectionedViewDocument({ id: "page", sections: [{ id: "hero", kind: "hero", ground: "base", heading: ref(), compact: true }] } as unknown as SectionedViewDocument).length).toBeGreaterThan(0);
    expect(contract.validateSectionedViewDocument({ id: "page", sections: [{ id: "hero", kind: "hero", ground: "base", heading: ref(), size: "compact", media: { assetId: "asset", alt: ref() } }] } as SectionedViewDocument).length).toBeGreaterThan(0);
  });
  it("refuses retired frame keys/enums while preserving published FAQ split", () => {
    for (const fields of [{ layout: "split" }, { mediaSide: "start" }, { size: "huge" }]) expect(contract.validateSectionedViewDocument(document(fields)).length).toBeGreaterThan(0);
    expect(contract.validateSectionedViewDocument({ id: "page", sections: [{ id: "faq", kind: "faq", ground: "base", heading: ref(), layout: "split", items: [{ id: "question", question: ref(), answer: ref() }] }] })).toEqual([]);
  });
  it("accepts text-only and link-only footnotes, refusing empty and malformed targets", () => {
    for (const footnote of [{ text: ref() }, { link: { label: ref(), href: "/learn" } }]) expect(contract.validateSectionedViewDocument(document({ footnote }))).toEqual([]);
    for (const footnote of [{}, { link: { label: ref(), href: "javascript:alert(1)" } }, { text: "raw" }]) expect(contract.validateSectionedViewDocument(document({ footnote })).length).toBeGreaterThan(0);
  });
  it("preserves action placement and closed emphasis/primary rules", () => {
    const actions = [{ id: "start", label: ref(), href: "/start", emphasis: "primary" }];
    expect(contract.validateSectionedViewDocument(document({ layout: "split-start", actions, block: { type: "items", arrangement: "rows", items: items(2) } }))).toEqual([]);
    expect(contract.validateSectionedViewDocument(document({ actions, block: { type: "items", arrangement: "rows", items: items(2) } })).length).toBeGreaterThan(0);
    expect(contract.validateSectionedViewDocument(document({ actions: [...actions, { ...actions[0], id: "again" }] })).length).toBeGreaterThan(0);
  });
});
