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
  "acme.status.not-offered": "Not offered",
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
    { id: "status", kind: "status-list", ground: "base", heading: ref("acme.status.heading"), labels: { available: ref("acme.status.available"), partial: ref("acme.status.partial"), planned: ref("acme.status.planned"), dispositions: { "not-offered": ref("acme.status.not-offered") } }, groups: [{ id: "core", heading: ref("acme.status.group.heading"), items: [{ id: "capability", label: ref("acme.status.item.label"), state: "available" }, { id: "unavailable", label: ref("acme.status.item.label"), disposition: "not-offered" }] }] },
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
      "acme.status.heading", "acme.status.available", "acme.status.partial", "acme.status.planned", "acme.status.not-offered", "acme.status.group.heading", "acme.status.item.label", "acme.status.item.label",
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

  it("requires exactly one first-position hero for the fixed document outline", () => {
    const noFirstHero = { ...document, sections: document.sections.slice(1) };
    const twoHeroes = { ...document, sections: [document.sections[0], { ...document.sections[0], id: "hero-two" }] };
    expect(validateSectionedViewDocument(noFirstHero).map((entry) => entry.path)).toContain("sections.0.kind");
    expect(validateSectionedViewDocument(twoHeroes).map((entry) => entry.rule)).toEqual(expect.arrayContaining(["sectioned-view-hero-position", "sectioned-view-hero-count"]));
  });

  it("reports a null first section without leaking a runtime error", () => {
    const candidate = { ...document, sections: [null] };
    expect(validateSectionedViewDocument(candidate).map((entry) => entry.path)).toContain("sections.0.kind");
    expect(() => resolveSectionedViewDocument(candidate as unknown as SectionedViewDocument, resolver)).toThrow(SectionedViewResolutionError);
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

  it("rejects sparse sections, repeated items, status groups, and status items at their authored paths", () => {
    const sparseSections = { id: document.id, sections: [document.sections[0], , document.sections[2]] };
    const sparseItems = { id: document.id, sections: [{ ...document.sections[1], items: [document.sections[1].items[0], , document.sections[1].items[1]] }] };
    const groups = new Array(2);
    groups[0] = document.sections[4].groups[0];
    const statusItems = new Array(2);
    statusItems[0] = document.sections[4].groups[0].items[0];
    const sparseGroups = { id: document.id, sections: [{ ...document.sections[4], groups }] };
    const sparseStatusItems = { id: document.id, sections: [{ ...document.sections[4], groups: [{ ...document.sections[4].groups[0], items: statusItems }] }] };

    expect(validateSectionedViewDocument(sparseSections).map((entry) => entry.path)).toContain("sections.1");
    expect(validateSectionedViewDocument(sparseItems).map((entry) => entry.path)).toContain("sections.0.items.1");
    expect(validateSectionedViewDocument(sparseGroups).map((entry) => entry.path)).toContain("sections.0.groups.1");
    expect(validateSectionedViewDocument(sparseStatusItems).map((entry) => entry.path)).toContain("sections.0.groups.0.items.1");
    expect(() => resolveSectionedViewDocument(sparseSections as unknown as SectionedViewDocument, resolver)).toThrow(SectionedViewResolutionError);
  });

  it("continues duplicate-id checks after a malformed repeated item", () => {
    const candidate = {
      id: document.id,
      sections: [{
        ...document.sections[1],
        items: [null, { id: "duplicate", heading: ref("acme.features.one.heading") }, { id: "duplicate", heading: ref("acme.features.two.heading") }],
      }],
    };
    const findings = validateSectionedViewDocument(candidate);
    expect(findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ rule: "sectioned-view-item-shape", path: "sections.0.items.0" }),
      expect.objectContaining({ rule: "sectioned-view-item-id-duplicate", path: "sections.0.items.2.id" }),
    ]));
  });

  it("fails closed on inherited, hidden, symbol, and accessor properties", () => {
    const inheritedDocument = Object.create({ sections: document.sections }) as { id: string };
    inheritedDocument.id = document.id;
    expect(validateSectionedViewDocument(inheritedDocument)).toEqual(expect.arrayContaining([expect.objectContaining({ rule: "sectioned-view-document-shape" })]));

    const hiddenKey = { ...document, sections: [{ ...document.sections[0] }] };
    Object.defineProperty(hiddenKey.sections[0], "node", { value: {}, enumerable: false });
    const symbolKey = { ...document, sections: [{ ...document.sections[0] }] };
    Object.defineProperty(symbolKey.sections[0], Symbol("node"), { value: {}, enumerable: true });
    const accessorKey = { ...document, sections: [{ ...document.sections[0] }] };
    Object.defineProperty(accessorKey.sections[0], "heading", { get: () => ref("acme.hero.heading"), enumerable: true });

    for (const candidate of [hiddenKey, symbolKey, accessorKey]) {
      expect(validateSectionedViewDocument(candidate).map((entry) => entry.rule)).toContain("sectioned-view-section-shape");
      expect(() => resolveSectionedViewDocument(candidate as SectionedViewDocument, resolver)).toThrow(SectionedViewResolutionError);
    }
  });

  it("requires the complete closed CopyRef wire shape before consulting a custom resolver", () => {
    const malformed = [
      { id: "acme.hero.heading", locale: " " },
      { id: "acme.hero.heading", values: { count: {} } },
      { id: "acme.hero.heading", extra: "nope" },
    ];
    for (const heading of malformed) {
      const candidate = { id: document.id, sections: [{ ...document.sections[0], heading }] };
      let calls = 0;
      expect(validateSectionedViewDocument(candidate).map((entry) => entry.path)).toContain("sections.0.heading");
      expect(() => resolveSectionedViewDocument(candidate as unknown as SectionedViewDocument, (() => { calls += 1; return undefined; }) as CopyResolver)).toThrow(SectionedViewResolutionError);
      expect(calls).toBe(0);
    }

    const symbolValues = { id: "acme.hero.heading", values: {} as Record<string, string> };
    Object.defineProperty(symbolValues.values, Symbol("hidden"), { value: "x", enumerable: true });
    expect(validateSectionedViewDocument({ id: document.id, sections: [{ ...document.sections[0], heading: symbolValues }] }).map((entry) => entry.path)).toContain("sections.0.heading");
  });

  it("reports a missing or nonfunction resolver as an unresolved-copy error rather than leaking TypeError", () => {
    for (const resolverCandidate of [undefined, null, {}]) {
      try {
        resolveSectionedViewDocument(document, resolverCandidate as CopyResolver);
        expect.unreachable();
      } catch (error) {
        expect(error).toBeInstanceOf(SectionedViewResolutionError);
        expect((error as SectionedViewResolutionError).reason).toBe("unresolved-copy");
        expect((error as Error).message).toContain("CopyResolver");
      }
    }
  });
});
