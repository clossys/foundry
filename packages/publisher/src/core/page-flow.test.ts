import { contentCatalogDocument } from "../preview/fixture-content-catalog.js";
import { describe, expect, it } from "vitest";
import type { SectionedViewDocument, SectionedViewSection } from "./sectioned-view.js";
import { checkSectionVariety, validateSectionedViewDocument } from "./sectioned-view.js";
import { checkPageFlow, sectionWeight, resolveActionEmphasis } from "./page-flow.js";

const ref = { id: "fixture.heading" };
const item = { id: "item", heading: ref };
const panel = { id: "panel", title: ref, parts: [{ id: "fields", type: "fields", items: [{ id: "field", label: ref, value: ref }] }] };
const media = { type: "specimen", label: ref, panels: [panel] };
const hero: SectionedViewSection = { id: "hero", kind: "hero", heading: ref, actions: [{ id: "start", label: ref, href: "/start" }] };
const section = (extra: object = {}): SectionedViewSection => ({ id: "band", kind: "content-section", heading: ref, ...extra } as SectionedViewSection);
const A = (extra: object = {}) => section({ media, ...extra });
const actionA = (actions: object[]) => section({ layout: "split", media, block: { type: "comparison", before: { label: ref, description: ref, visual: panel }, after: { label: ref, description: ref, visual: panel } }, actions });
const B = (extra: object = {}) => section({ block: { type: "topic-list", items: [item, { ...item, id: "two" }] }, ...extra });
const C = (extra: object = {}) => section(extra);
const doc = (...bands: SectionedViewSection[]): SectionedViewDocument => ({ id: "page", sectionGroundRhythm: "view", sections: [hero, ...bands.map((band, index) => ({ ...band, id: `band-${index}` }))] });
const rules = (document: SectionedViewDocument, code: string, options?: { callToAction?: { href: string } }) => checkPageFlow(document, options).filter((finding) => finding.rule === `sectioned-view-flow-${code}`);
const linked = (id: string, href: string) => B({ id, block: { type: "topic-list", items: [{ ...item, href }, { ...item, id: "two", href: `/${id}-other` }] } });

describe("sectionWeight derivation", () => {
  const rows: [string, SectionedViewSection, string, string][] = [
    ["hero", hero, "hero", "hero"],
    ["pricing", { id: "pricing", kind: "pricing", heading: ref, items: [] }, "A", "table"],
    ["full media", A(), "A", "specimen"],
    ["split media", section({ layout: "split", media }), "B", "specimen"],
    ["visual comparison", section({ block: { type: "comparison", before: { label: ref, visual: panel }, after: { label: ref, visual: panel } } }), "A", "compare"],
    ["text comparison", section({ block: { type: "comparison", before: { label: ref }, after: { label: ref } } }), "B", "compare"],
    ["visual cards", section({ block: { type: "card-grid", items: [{ ...item, span: "full", visual: panel.parts[0] }] } }), "A", "grid"],
    ["text cards", section({ block: { type: "card-grid", items: [{ ...item, span: "full" }] } }), "B", "grid"],
    ["visual steps", section({ block: { type: "ordered-step-sequence", items: [{ ...item, ordinal: ref, visual: panel }] } }), "A", "sequence"],
    ["text steps", section({ block: { type: "ordered-step-sequence", items: [{ ...item, ordinal: ref }] } }), "B", "sequence"],
    ["statement", section({ block: { type: "feature-grid", emphasis: "statement", items: [item, { ...item, id: "two" }, { ...item, id: "three" }] } }), "A", "statement"],
    ["plain features", section({ block: { type: "feature-grid", items: [item] } }), "C", "list"],
    ["rule features", section({ block: { type: "feature-grid", treatment: "rule", items: [item] } }), "C", "list"],
    ["plate features", section({ block: { type: "feature-grid", treatment: "plate", items: [item] } }), "B", "grid"],
    ["split features", section({ layout: "split", block: { type: "feature-grid", items: [item] } }), "B", "list"],
    ["topics", B(), "B", "list"],
    ["frame", C(), "C", "frame"],
    ["block FAQ", section({ block: { type: "faq", items: [] } }), "C", "reference"],
    ...([ ["faq", "C", "reference"], ["feature-grid", "C", "list"], ["ordered-step-sequence", "B", "sequence"], ["status-list", "B", "table"], ["stat-grid", "B", "proof"], ["stat", "B", "proof"], ["testimonial", "B", "proof"] ] as const).map(([kind, weight, shape]): [string, SectionedViewSection, string, string] => [kind, { id: kind, kind, heading: ref, items: [] } as SectionedViewSection, weight, shape]),
  ];
  it.each(rows)("derives %s", (_name, value, weight, shape) => expect(sectionWeight(value)).toEqual({ weight, shape }));
  it("ignores ground and resolves stacked-media precedence before blocks", () => {
    expect(sectionWeight(A({ ground: "inverse", block: { type: "faq", items: [] } }))).toEqual({ weight: "A", shape: "specimen" });
  });
});

describe("page flow rules", () => {
  const cases: [string, SectionedViewSection[], SectionedViewSection[]][] = [
    ["opening-set-piece", [B(), B(), A()], [B(), A()]],
    ["opening-crowded", [A(), B(), A()], [A(), B(), C(), A()]],
    ["opening-pause", [C(), B(), A()], [C(), A(), B()]],
    ["set-piece-run", [A(), A(), B()], [A(), B(), A(), B()]],
    ["support-run", [A(), B(), B(), B()], [A(), B(), B(), C()]],
    ["pause-run", [A(), C(), C()], [A(), C(), B()]],
    ["set-piece-shape", [A(), B(), A(), B()], [A(), B(), section({ block: { type: "feature-grid", emphasis: "statement", items: [item, { ...item, id: "two" }, { ...item, id: "three" }] } }), B()]],
    ["set-piece-count", [A(), B(), A()], [A(), B(), C()]],
    ["pause-count", [A(), B(), B(), A(), B()], [A(), B(), C(), A(), B()]],
    ["closing-band", [A(), B(), A()], [A(), B(), C()]],
    ["inverse-weight", [A(), B({ ground: "inverse" }), C()], [A(), section({ ground: "inverse", block: { type: "feature-grid", emphasis: "statement", items: [item, { ...item, id: "two" }, { ...item, id: "three" }] } }), B()]],
    ["primary-placement", [A(), B(), actionA([{ id: "go", label: ref, href: "/start", emphasis: "primary" }]), B()], [actionA([{ id: "go", label: ref, href: "/start", emphasis: "primary" }]), B(), C()]],
    ["primary-target", [actionA([{ id: "go", label: ref, href: "/other", emphasis: "primary" }]), B()], [actionA([{ id: "go", label: ref, href: "/start", emphasis: "primary" }]), B()]],
    ["link-groups", [linked("a", "/one"), linked("b", "/two"), linked("c", "/three")], [linked("a", "/one"), linked("b", "/two")]],
    ["link-repeat", [linked("a", "/guide/"), B({ footnote: { text: ref, link: { label: ref, href: "/guide#details" } } })], [linked("a", "/guide"), B({ footnote: { text: ref, link: { label: ref, href: "/other" } } })]],
  ];
  it.each(cases)("%s has a failing and passing fixture", (rule, fail, pass) => {
    expect(rules(doc(...fail), rule).length).toBeGreaterThan(0);
    expect(validateSectionedViewDocument(doc(...pass))).toEqual([]);
    expect(rules(doc(...pass), rule)).toEqual([]);
  });
  it("does not lint a page without a first hero", () => expect(checkPageFlow({ id: "page", sections: [A(), B()] })).toEqual([]));
  it("checks the close target and excludes hero and close from body repeats", () => {
    expect(rules(doc(A(), B()), "primary-target", { callToAction: { href: "/other" } })).toHaveLength(1);
    expect(rules(doc(linked("a", "/start")), "link-repeat", { callToAction: { href: "/start" } })).toEqual([]);
  });
  it("counts links across body action and footnote paths", () => {
    const findings = rules(doc(actionA([{ id: "go", label: ref, href: "/guide" }]), C({ footnote: { text: ref, link: { label: ref, href: "/guide/" } } })), "link-repeat");
    expect(findings[0]?.path).toBe("sections.2.footnote.link.href");
    expect(findings[0]?.severity).toBe("warning");
  });
  it("preserves variety output bytes and does not mutate the document", () => {
    const value = doc(A(), A({ ground: "inverse" }), B(), B());
    const input = JSON.stringify(value);
    const before = JSON.stringify(checkSectionVariety(value));
    checkPageFlow(value);
    expect(JSON.stringify(checkSectionVariety(value))).toBe(before);
    expect(JSON.stringify(value)).toBe(input);
  });
});

it("preserves legacy catalog variety output including the adjacent lane variants", () => {
  const legacy = { ...contentCatalogDocument, sections: contentCatalogDocument.sections.filter((section) => !section.id.startsWith("catalog-topics-groups-")) };
  expect(checkSectionVariety(legacy)).toMatchInlineSnapshot(`
[
  {
    "message": "sections.13 repeats the layout, block and visual of the band before it (stacked, topic-list, none); vary one of them.",
    "path": "sections.13",
    "rule": "sectioned-view-variety-repeat",
    "severity": "warning",
  },
  {
    "message": "sections.21 repeats the layout, block and visual of the band before it (stacked, ordered-step-sequence, lanes); vary one of them.",
    "path": "sections.21",
    "rule": "sectioned-view-variety-repeat",
    "severity": "warning",
  },
  {
    "message": "sections.18 is a second band with four or more cards; keep at most one.",
    "path": "sections.18",
    "rule": "sectioned-view-variety-card-bands",
    "severity": "warning",
  },
  {
    "message": "sections.19 is a second comparison; keep at most one.",
    "path": "sections.19",
    "rule": "sectioned-view-variety-comparison-count",
    "severity": "warning",
  },
  {
    "message": "sections.8 uses the feature-grid block with the same treatment as sections.3; give it a different treatment.",
    "path": "sections.8",
    "rule": "sectioned-view-variety-treatment",
    "severity": "warning",
  },
  {
    "message": "sections.13 uses the topic-list block with the same treatment as sections.12; give it a different treatment.",
    "path": "sections.13",
    "rule": "sectioned-view-variety-treatment",
    "severity": "warning",
  },
  {
    "message": "sections.18 uses the card-grid block with the same treatment as sections.15; give it a different treatment.",
    "path": "sections.18",
    "rule": "sectioned-view-variety-treatment",
    "severity": "warning",
  },
]
`);
});

it("pins set-piece minimum transitions and short-page bounds", () => {
  expect(rules(doc(B(), B()), "set-piece-count")).toEqual([]);
  expect(rules(doc(B(), B(), C()), "set-piece-count")).toHaveLength(1);
  expect(rules(doc(A(), B(), C(), B(), B()), "set-piece-count")).toEqual([]);
  expect(rules(doc(A(), B(), C(), B(), B(), C()), "set-piece-count")).toHaveLength(1);
  expect(rules(doc(A(), B(), C(), A(), B(), C()), "set-piece-count")).toEqual([]);
});
it("exempts fewer than three body bands from the opening set-piece requirement", () => {
  for (const bands of [[], [B()], [B(), B()]]) expect(rules(doc(...bands), "opening-set-piece")).toEqual([]);
  expect(rules(doc(B(), B(), A()), "opening-set-piece")).toHaveLength(1);
  expect(rules(doc(B(), A(), B()), "opening-set-piece")).toEqual([]);
  expect(rules(doc(C()), "opening-pause")).toHaveLength(1);
});
it("rejects three breathers across six bands while accepting the maximum of two", () => {
  expect(rules(doc(A(), C(), B(), C(), A(), C()), "pause-count")).toHaveLength(1);
  expect(rules(doc(A(), C(), B(), C(), A(), B()), "pause-count")).toEqual([]);
});
it.each([
  ["/start/", "/start", 0],
  ["/start#intro", "/start#details", 0],
  ["#details/", "#details", 0],
  ["#details", "#other", 1],
  ["/start", "/other", 1],
] as const)("compares normalized primary destinations %s and %s", (first, second, count) => {
  const page = doc(actionA([{ id: "go", label: ref, href: second, emphasis: "primary" }]), B(), C());
  page.sections[0] = { ...hero, actions: [{ id: "start", label: ref, href: first }] };
  expect(rules(page, "primary-target")).toHaveLength(count);
  expect(rules({ ...page, sections: [page.sections[0]!] }, "primary-target", { callToAction: { href: second } })).toHaveLength(count);
});
it("rejects a list pause first or any pause second", () => {
  const list = section({ block: { type: "feature-grid", items: [item, { ...item, id: "two" }] } });
  expect(rules(doc(list, A(), B()), "opening-pause")).toHaveLength(1);
  expect(rules(doc(A(), C(), B()), "opening-pause")).toHaveLength(1);
});
it("checks explicit inverse at both body edges", () => {
  const statement = section({ ground: "inverse", block: { type: "feature-grid", emphasis: "statement", items: [item, { ...item, id: "two" }, { ...item, id: "three" }] } });
  expect(rules(doc(statement, B()), "inverse-weight")).toHaveLength(1);
  expect(rules(doc(A(), B(), statement), "inverse-weight")).toHaveLength(1);
});

it("fits explicit action tiers and counts without guessing omitted emphasis", () => {
  const action = (emphasis: "primary" | "secondary") => ({ id: "go", label: ref, href: "/guide", emphasis });
  expect(rules(doc(actionA([action("primary")]), B(), C()), "action-tier")).toEqual([]);
  expect(rules(doc(actionA([action("secondary")]), B(), C()), "action-tier")).toEqual([]);
  expect(rules(doc(actionA([action("secondary"), { ...action("secondary"), id: "two" }]), B()), "action-tier")).toHaveLength(1);
  expect(rules(doc(A(), section({ layout: "split", media, actions: [action("primary")] }), C()), "action-tier")).toHaveLength(1);
  expect(rules(doc(A(), C({ actions: [action("secondary")] })), "action-tier")).toHaveLength(1);
  expect(rules(doc(A(), C({ actions: [{ id: "one", label: ref, href: "/one" }, { id: "two", label: ref, href: "/two" }] })), "action-tier")).toHaveLength(1);
  expect(rules(doc(A(), linked("links", "/guide")), "action-tier")).toEqual([]);
});

it("matches the weight-resolved rendering defaults", () => {
  const omitted = { id: "go", label: ref, href: "/guide" };
  expect(rules(doc(actionA([omitted]), B(), C()), "action-tier")).toEqual([]);
  expect(rules(doc(actionA([omitted, { ...omitted, id: "two" }]), B()), "action-tier")).toEqual([]);
  expect(rules(doc(A(), C({ actions: [omitted] })), "action-tier")).toEqual([]);
  expect(rules(doc(A(), section({ layout: "split", media, actions: [omitted] }), C()), "action-tier")).toEqual([]);
});

it("compares hero and supplied close even when there are no body bands", () => {
  expect(rules(doc(), "primary-target", { callToAction: { href: "/other" } })).toHaveLength(1);
  expect(rules(doc(), "primary-target", { callToAction: { href: "/start" } })).toEqual([]);
});

it("accepts a complete six-band flow with no findings", () => {
  const faq: SectionedViewSection = { id: "faq", kind: "faq", heading: ref, items: Array.from({ length: 4 }, (_, index) => ({ id: `question-${index}`, question: ref, answer: ref })) };
  const statement = section({ block: { type: "feature-grid", emphasis: "statement", items: [item, { ...item, id: "two" }, { ...item, id: "three" }] } });
  const recipe = doc(C(), A(), B(), faq, statement, B());
  expect(validateSectionedViewDocument(recipe)).toEqual([]);
  expect(checkPageFlow(recipe, { callToAction: { href: "/start" } })).toEqual([]);
  expect(checkPageFlow(doc(), { callToAction: { href: "/start" } })).toEqual([]);
});


it("compares only the effective primary hero action with the shared close target", () => {
  const page: SectionedViewDocument = { ...doc(), sections: [{ ...hero, actions: [{ id: "first", label: ref, href: "/start" }, { id: "second", label: ref, href: "/other" }] }] };
  expect(validateSectionedViewDocument(page)).toEqual([]);
  const findings = rules(page, "primary-target", { callToAction: { href: "/start" } });
  expect(findings).toEqual([]);
  const same: SectionedViewDocument = { ...page, sections: [{ ...hero, actions: [{ id: "first", label: ref, href: "/start" }, { id: "second", label: ref, href: "/start" }] }] };
  expect(validateSectionedViewDocument(same)).toEqual([]);
  expect(checkPageFlow(same, { callToAction: { href: "/start" } })).toEqual([]);
});

it("normalizes trailing slashes on leading fragments while preserving distinct fragments", () => {
  const repeated = doc(linked("a", "#details/"), linked("b", "#details"));
  const distinct = doc(linked("a", "#details/"), linked("b", "#other"));
  expect(validateSectionedViewDocument(repeated)).toEqual([]);
  expect(validateSectionedViewDocument(distinct)).toEqual([]);
  const findings = rules(repeated, "link-repeat");
  expect(findings).toHaveLength(1);
  expect(findings[0]?.path).toBe("sections.2.block.items.0.href");
  expect(rules(distinct, "link-repeat")).toEqual([]);
});


describe("action ladder resolution", () => {
  const action = { id: "go", label: ref, href: "/start" };
  it("resolves every weight and shape and preserves explicit emphasis", () => {
    for (const [band, expected] of [[actionA([action]), "secondary"], [B({ actions: [action] }), "tertiary"], [C({ actions: [action] }), "tertiary"], [section({ block: { type: "feature-grid", items: [item, { ...item, id: "two" }] }, actions: [action] }), "quiet"]] as const) {
      expect(resolveActionEmphasis(band, 0)).toBe(expected);
    }
    expect(resolveActionEmphasis(actionA([action, { ...action, id: "two" }]), 1)).toBe("quiet");
    for (const emphasis of ["primary", "secondary", "tertiary", "quiet"] as const) expect(resolveActionEmphasis(C({ actions: [{ ...action, emphasis }] }), 0)).toBe(emphasis);
    expect(resolveActionEmphasis({ ...hero, actions: [action, { ...action, id: "two" }] }, 0)).toBe("primary");
    expect(resolveActionEmphasis({ ...hero, actions: [action, { ...action, id: "two" }] }, 1)).toBe("secondary");
  });
  it("matches only effective hero primary destinations", () => {
    const page: SectionedViewDocument = { ...doc(), sections: [{ ...hero, actions: [{ ...action, href: "/guide", emphasis: "quiet" }, { ...action, id: "two", emphasis: "primary" }] }] };
    expect(rules(page, "primary-target", { callToAction: { href: "/start" } })).toEqual([]);
    expect(rules(page, "primary-target", { callToAction: { href: "/other" } })).toHaveLength(1);
  });
});
