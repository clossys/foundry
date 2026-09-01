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

/** Copy used only by the optional additive fields, kept out of `copy` so the provenance fixture above keeps measuring the pre-existing document. */
const additionalCopy = {
  "acme.hero.action.start": "Start now",
  "acme.hero.action.docs": "Read the docs",
  "acme.features.eyebrow": "Capabilities",
  "acme.faq.eyebrow": "Answers",
  "acme.steps.eyebrow": "Process",
  "acme.status.eyebrow": "Posture",
  "acme.status.item.detail": "Generally available in every region.",
  "acme.status.none.detail": "Not offered because the audit is not ours to claim.",
};

const registry: CopyRegistry = {
  id: "acme-sectioned-fixture",
  locale: "en",
  revision: "1",
  source: { kind: "consumer", reference: "fixtures/acme-sectioned" },
  entries: Object.entries({ ...copy, ...additionalCopy }).map(([id, text]) => ({ id, text, context: "fixture", status: "approved" })),
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

describe("SectionedViewDocument optional additive fields", () => {
  const expressive: SectionedViewDocument = {
    ...document,
    sections: [
      { ...document.sections[0], actions: [{ id: "start", label: ref("acme.hero.action.start"), href: "/start" }, { id: "docs", label: ref("acme.hero.action.docs"), href: "https://example.com/docs" }] },
      { ...document.sections[1], eyebrow: ref("acme.features.eyebrow") },
      { ...document.sections[2], eyebrow: ref("acme.faq.eyebrow") },
      { ...document.sections[3], eyebrow: ref("acme.steps.eyebrow") },
      {
        ...document.sections[4],
        eyebrow: ref("acme.status.eyebrow"),
        groups: [{
          ...document.sections[4].groups[0],
          items: [
            { id: "capability", label: ref("acme.status.item.label"), detail: ref("acme.status.item.detail"), state: "available" },
            { id: "unavailable", label: ref("acme.status.item.label"), detail: ref("acme.status.none.detail"), disposition: "not-offered" },
          ],
        }],
      },
    ],
  };

  it("still accepts, unchanged, a document that carries none of them", () => {
    expect(validateSectionedViewDocument(document)).toEqual([]);
    const resolved = resolveSectionedViewDocument(document, resolver);
    expect(resolved.sections[0].actions).toBeUndefined();
    for (const section of resolved.sections.slice(1)) expect(section.eyebrow).toBeUndefined();
    expect(resolved.sections[4].groups[0].items.every((item) => item.detail === undefined)).toBe(true);
  });

  it("accepts an eyebrow on every non-hero kind and resolves it before the section heading", () => {
    expect(validateSectionedViewDocument(expressive)).toEqual([]);
    const resolved = resolveSectionedViewDocument(expressive, resolver);
    expect(resolved.sections.map((section) => section.eyebrow)).toEqual(["New", "Capabilities", "Answers", "Process", "Posture"]);
    expect(resolved.resolutions.map((resolution) => resolution.entryId)).toEqual([
      "acme.hero.eyebrow", "acme.hero.heading", "acme.hero.description", "acme.hero.action.start", "acme.hero.action.docs",
      "acme.features.eyebrow", "acme.features.heading", "acme.features.description", "acme.features.one.heading", "acme.features.one.description", "acme.features.two.heading",
      "acme.faq.eyebrow", "acme.faq.heading", "acme.faq.description", "acme.faq.one.question", "acme.faq.one.answer",
      "acme.steps.eyebrow", "acme.steps.heading", "acme.steps.one.ordinal", "acme.steps.one.label", "acme.steps.one.heading", "acme.steps.one.description",
      "acme.status.eyebrow", "acme.status.heading", "acme.status.available", "acme.status.partial", "acme.status.planned", "acme.status.not-offered", "acme.status.group.heading",
      "acme.status.item.label", "acme.status.item.detail", "acme.status.item.label", "acme.status.none.detail",
    ]);
  });

  it("carries hero actions as data and resolves their labels while the href travels unchanged", () => {
    const resolved = resolveSectionedViewDocument(expressive, resolver);
    expect(resolved.sections[0].actions).toEqual([
      { id: "start", label: "Start now", href: "/start" },
      { id: "docs", label: "Read the docs", href: "https://example.com/docs" },
    ]);
  });

  it("carries a per-item detail on both a readiness row and an off-axis disposition row", () => {
    const resolved = resolveSectionedViewDocument(expressive, resolver);
    expect(resolved.sections[4].groups[0].items).toEqual([
      { id: "capability", label: "Fixture capability", detail: "Generally available in every region.", state: "available" },
      { id: "unavailable", label: "Fixture capability", detail: "Not offered because the audit is not ours to claim.", disposition: "not-offered" },
    ]);
  });

  it("refuses an empty, malformed, duplicated, or unsafely targeted action", () => {
    const empty = { ...document, sections: [{ ...document.sections[0], actions: [] }] };
    const openKey = { ...document, sections: [{ ...document.sections[0], actions: [{ id: "x", label: ref("acme.hero.action.start"), href: "/x", onClick: () => {} }] }] };
    const missingHref = { ...document, sections: [{ ...document.sections[0], actions: [{ id: "x", label: ref("acme.hero.action.start") }] }] };
    const duplicate = { ...document, sections: [{ ...document.sections[0], actions: [{ id: "x", label: ref("acme.hero.action.start"), href: "/x" }, { id: "x", label: ref("acme.hero.action.docs"), href: "/y" }] }] };
    const unsafe = ["javascript:alert(1)", "//evil.example", "data:text/html,x", " /leading-space", "http://user:pass@example.com/"].map((href) => ({ ...document, sections: [{ ...document.sections[0], actions: [{ id: "x", label: ref("acme.hero.action.start"), href }] }] }));

    expect(validateSectionedViewDocument(empty).map((entry) => entry.rule)).toContain("sectioned-view-actions-shape");
    expect(validateSectionedViewDocument(openKey).map((entry) => entry.rule)).toContain("sectioned-view-action-shape");
    expect(validateSectionedViewDocument(missingHref).map((entry) => entry.rule)).toContain("sectioned-view-action-shape");
    expect(validateSectionedViewDocument(duplicate).map((entry) => entry.rule)).toContain("sectioned-view-item-id-duplicate");
    for (const candidate of unsafe) {
      expect(validateSectionedViewDocument(candidate as unknown as SectionedViewDocument).map((entry) => entry.rule)).toContain("sectioned-view-action-href");
      expect(() => resolveSectionedViewDocument(candidate as unknown as SectionedViewDocument, resolver)).toThrow(SectionedViewResolutionError);
    }
  });

  it("holds an eyebrow and a status detail to the same CopyRef shape as every other audience field", () => {
    const badEyebrow = { ...document, sections: [document.sections[0], { ...document.sections[1], eyebrow: "Capabilities" }] };
    const badDetail = { ...document, sections: [document.sections[0], { ...document.sections[4], groups: [{ ...document.sections[4].groups[0], items: [{ id: "capability", label: ref("acme.status.item.label"), detail: { id: " " }, state: "available" as const }] }] }] };
    expect(validateSectionedViewDocument(badEyebrow).map((entry) => entry.path)).toContain("sections.1.eyebrow");
    expect(validateSectionedViewDocument(badDetail).map((entry) => entry.path)).toContain("sections.1.groups.0.items.0.detail");
  });

  it("fails at the authored path when new-field copy is unresolvable, leaving no partial document", () => {
    const missing: CopyResolver = (candidate) => (candidate.id === "acme.status.item.detail" ? undefined : resolver(candidate));
    try {
      resolveSectionedViewDocument(expressive, missing);
      expect.unreachable();
    } catch (error) {
      expect((error as SectionedViewResolutionError).reason).toBe("unresolved-copy");
      expect((error as Error).message).toContain("sections.4.groups.0.items.0.detail");
    }
  });
});
