import { describe, expect, it } from "vitest";
import { createCopyResolver } from "@clossys/writer";
import type { CopyRegistry, CopyResolver } from "@clossys/writer";
import { collectCopyProvenance } from "./output-manifest.js";
import { resolveSectionedViewDocument, SectionedViewResolutionError, validateSectionedViewDocument } from "./sectioned-view.js";
import type { SectionedViewDocument } from "./sectioned-view.js";

const ref = (id: string) => ({ id });
const copy = {
  "acme.hero.eyebrow": "New",
  "acme.hero.heading": "A placeholder home page",
  "acme.hero.description": "Fixture description.",
  "acme.features.heading": "Features",
  "acme.features.description": "Feature fixture.",
  "acme.features.one.heading": "First feature",
  "acme.features.one.description": "First feature description.",
  "acme.features.two.heading": "Second feature",
  "acme.faq.heading": "Questions",
  "acme.faq.description": "FAQ fixture.",
  "acme.faq.one.question": "Why this?",
  "acme.faq.one.answer": "Because it is validated.",
  "acme.steps.heading": "Steps",
  "acme.steps.one.ordinal": "1",
  "acme.steps.one.label": "First",
  "acme.steps.one.heading": "Start here",
  "acme.steps.one.description": "Start fixture.",
  "acme.status.heading": "Readiness",
  "acme.status.available": "Available",
  "acme.status.partial": "Partial",
  "acme.status.planned": "Planned",
  "acme.status.group.heading": "Core",
  "acme.status.item.label": "Fixture capability",
};

const registry: CopyRegistry = {
  id: "acme-sectioned-fixture",
  locale: "en",
  revision: "1",
  source: { kind: "consumer", reference: "fixtures/acme-sectioned" },
  entries: Object.entries(copy).map(([id, text]) => ({ id, text, context: "fixture", status: "approved" })),
};
const resolver = createCopyResolver(registry);

const document: SectionedViewDocument = {
  id: "acme.home",
  sections: [
    { id: "hero", kind: "hero", ground: "base", eyebrow: ref("acme.hero.eyebrow"), heading: ref("acme.hero.heading"), description: ref("acme.hero.description") },
    { id: "features", kind: "feature-grid", ground: "sunken", heading: ref("acme.features.heading"), description: ref("acme.features.description"), items: [{ id: "one", heading: ref("acme.features.one.heading"), description: ref("acme.features.one.description") }, { id: "two", heading: ref("acme.features.two.heading") }] },
    { id: "faq", kind: "faq", ground: "base", heading: ref("acme.faq.heading"), description: ref("acme.faq.description"), items: [{ id: "one", question: ref("acme.faq.one.question"), answer: ref("acme.faq.one.answer") }] },
    { id: "steps", kind: "ordered-step-sequence", ground: "inverse", heading: ref("acme.steps.heading"), items: [{ id: "one", ordinal: ref("acme.steps.one.ordinal"), label: ref("acme.steps.one.label"), heading: ref("acme.steps.one.heading"), description: ref("acme.steps.one.description") }] },
    { id: "status", kind: "status-list", ground: "base", heading: ref("acme.status.heading"), labels: { available: ref("acme.status.available"), partial: ref("acme.status.partial"), planned: ref("acme.status.planned") }, groups: [{ id: "core", heading: ref("acme.status.group.heading"), items: [{ id: "capability", label: ref("acme.status.item.label"), state: "available" }] }] },
  ],
};

describe("SectionedViewDocument core contract", () => {
  it("accepts every closed section kind with no React, route, style, or node escape hatch", () => {
    expect(validateSectionedViewDocument(document)).toEqual([]);
  });

  it("resolves all audience copy in depth-first authored order and preserves data-only sections", () => {
    const resolved = resolveSectionedViewDocument(document, resolver);
    expect(resolved.sections[0]).toMatchObject({ id: "hero", kind: "hero", ground: "base", heading: "A placeholder home page" });
    expect(resolved.sections[2]).toMatchObject({ id: "faq", items: [{ question: "Why this?", answer: "Because it is validated." }] });
    expect(resolved.resolutions.map((resolution) => resolution.entryId)).toEqual([
      "acme.hero.eyebrow", "acme.hero.heading", "acme.hero.description",
      "acme.features.heading", "acme.features.description", "acme.features.one.heading", "acme.features.one.description", "acme.features.two.heading",
      "acme.faq.heading", "acme.faq.description", "acme.faq.one.question", "acme.faq.one.answer",
      "acme.steps.heading", "acme.steps.one.ordinal", "acme.steps.one.label", "acme.steps.one.heading", "acme.steps.one.description",
      "acme.status.heading", "acme.status.available", "acme.status.partial", "acme.status.planned", "acme.status.group.heading", "acme.status.item.label",
    ]);
  });

  it("reuses core output-manifest provenance without adding a second evidence model", () => {
    const provenance = collectCopyProvenance(resolveSectionedViewDocument(document, resolver).resolutions);
    expect(provenance).toEqual([{ recordId: "acme-sectioned-fixture", revision: "1", locale: "en", source: { kind: "consumer", reference: "fixtures/acme-sectioned" }, entryIds: Object.keys(copy).sort() }]);
    expect(JSON.stringify(provenance)).not.toContain("A placeholder home page");
  });

  it("refuses empty sections, unsafe/duplicate fragment ids, unknown kinds, and caller-owned composition keys", () => {
    const invalid = {
      ...document,
      sections: [
        { id: "bad id", kind: "hero", ground: "base", heading: ref("acme.hero.heading"), node: {} },
        { id: "bad-id", kind: "not-a-kind", ground: "free-colour", heading: ref("acme.hero.heading") },
        { id: "bad-id", kind: "feature-grid", ground: "base", heading: ref("acme.features.heading"), items: [] },
      ],
    };
    const findings = validateSectionedViewDocument(invalid);
    expect(findings.map((entry) => entry.rule)).toEqual(expect.arrayContaining([
      "sectioned-view-section-id-fragment",
      "sectioned-view-section-keys",
      "sectioned-view-section-kind",
      "sectioned-view-section-id-duplicate",
      "sectioned-view-items-shape",
    ]));
  });

  it("fails all-or-nothing at the exact authored CopyRef path", () => {
    const missing: CopyResolver = (candidate) => (candidate.id === "acme.faq.one.answer" ? undefined : resolver(candidate));
    try {
      resolveSectionedViewDocument(document, missing);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(SectionedViewResolutionError);
      expect((error as SectionedViewResolutionError).reason).toBe("unresolved-copy");
      expect((error as Error).message).toContain("sections.2.items.0.answer");
    }
  });
});
