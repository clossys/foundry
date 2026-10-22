import { describe, expect, it } from "vitest";
import type { SectionedViewDocument, SectionedViewSection, SectionedViewContentSection, SectionedViewContentAction } from "./sectioned-view.js";
import { checkSectionVariety, validateSectionedViewDocument } from "./sectioned-view.js";
import { checkPageFlow, sectionWeight, resolveActionEmphasis } from "./page-flow.js";

const ref = { id: "fixture.heading" };
const item = { id: "item", heading: ref, description: ref };
const items = (count: number) => Array.from({ length: count }, (_, i) => ({ ...item, id: `item-${i}` }));
const part = { id: "fields", type: "fields" as const, label: ref, items: [{ id: "field", label: ref, value: ref }] };
const panel = { id: "panel", title: ref, parts: [part] };
const media = { type: "specimen" as const, label: ref, panel };
const features = { type: "items" as const, arrangement: "columns" as const, columns: 2 as const, items: items(2) };
const statementBlock = { type: "items" as const, recipe: "statement" as const, items: items(3) };
const prose = { type: "prose" as const, paragraphs: [[{ type: "text" as const, text: ref }]] };
const matrix = (visual = false) => ({ type: "matrix" as const, sides: ["before", "after"].map((id) => ({ id, label: ref, heading: ref, description: ref, ...(visual ? { visual: panel } : { points: [ref, ref] }) })) });
const hero: SectionedViewSection = { id: "hero", kind: "hero", heading: ref, actions: [{ id: "start", label: ref, href: "/start" }] };
const section = (extra: Partial<SectionedViewContentSection> = {}): SectionedViewContentSection => ({ id: "band", kind: "content-section", heading: ref, ...extra });
const A = (extra: Partial<SectionedViewContentSection> = {}) => section({ media, ...extra });
const actionA = (actions: SectionedViewContentAction[]) => section({ layout: "split-end", media, block: matrix(true), actions });
const B = (extra: Partial<SectionedViewContentSection> = {}) => section({ block: { type: "items", recipe: "topics", items: items(2) }, ...extra });
const C = (extra: Partial<SectionedViewContentSection> = {}) => section(extra);
const doc = (...bands: SectionedViewSection[]): SectionedViewDocument => ({ id: "page", sectionGroundRhythm: "view", sections: [hero, ...bands.map((band, index) => ({ ...band, id: `band-${index}` }))] });
const rules = (document: SectionedViewDocument, code: string, options?: { callToAction?: { href: string } }) => checkPageFlow(document, options).filter((finding) => finding.rule === `sectioned-view-flow-${code}`);
const linked = (id: string, href: string) => B({ id, block: { type: "items", recipe: "topics", items: [{ ...item, href }, { ...item, id: "two", href: `/${id}-other` }] } });

it("weighs inverse on the effective close ground while preserving canonical anchors", () => {
  const legacy: SectionedViewSection = { id: "legacy-close", kind: "faq", ground: "inverse", heading: ref, items: ["one", "two", "three", "four"].map(id => ({ id, question: ref, answer: ref })) };
  expect(rules(doc(B(), legacy), "inverse-weight")).toHaveLength(1);
  expect(rules(doc(B(), legacy), "inverse-weight", { callToAction: { href: "/start" } })).toEqual([]);
  expect(rules(doc(B(), section({ ground: "inverse", block: statementBlock })), "inverse-weight", { callToAction: { href: "/start" } })).toHaveLength(1);
});

describe("sectionWeight derivation", () => {
  const rows: [string, SectionedViewSection, string, string][] = [
    ["hero", hero, "hero", "hero"],
    ["pricing", { id: "pricing", kind: "pricing", heading: ref, items: [{ id: "plan", name: ref, price: ref, features: [ref] }] }, "A", "table"],
    ["full media", A(), "A", "specimen"],
    ...(["split-start", "split-end"] as const).map((layout): [string, SectionedViewSection, string, string] => [layout + " media", section({ layout, media }), "B", "specimen"]),
    ["visual comparison", section({ block: matrix(true) }), "A", "compare"],
    ["text comparison", section({ block: matrix() }), "B", "compare"],
    ["visual cards", section({ block: { type: "items", recipe: "cards", items: items(2).map((i) => ({ ...i, visual: part })) } }), "A", "grid"],
    ["text cards", section({ block: { type: "items", recipe: "cards", items: items(2) } }), "B", "grid"],
    ["visual steps", section({ block: { type: "items", recipe: "steps", items: items(3).map((i) => ({ ...i, visual: part })) } }), "A", "sequence"],
    ["text steps", section({ block: { type: "items", recipe: "steps", items: items(3) } }), "B", "sequence"],
    ["statement", section({ block: statementBlock }), "A", "statement"],
    ["plain features", section({ block: features }), "C", "list"],
    ["rule features", section({ block: { ...features, treatment: "rule" } }), "C", "list"],
    ["plate features", section({ block: { ...features, treatment: "plate" } }), "B", "grid"],
    ...(["split-start", "split-end"] as const).map((layout): [string, SectionedViewSection, string, string] => [layout + " features", section({ layout, block: features }), "B", "list"]),
    ["topics", B(), "B", "list"],
    ["frame", C(), "C", "frame"],
    ["block FAQ", section({ block: { type: "items", recipe: "faq", items: items(4) } }), "C", "reference"],
    ["prose", section({ block: prose }), "C", "reference"],
    ...(["split-start", "split-end"] as const).map((layout): [string, SectionedViewSection, string, string] => [layout + " prose with media", section({ layout, block: prose, media }), "B", "specimen"]),
    ["stacked prose with media", section({ block: prose, media }), "A", "specimen"],
    ["faq", { id: "faq", kind: "faq", heading: ref, items: ["one", "two", "three", "four"].map(id => ({ id, question: ref, answer: ref })) }, "C", "reference"],
    ["feature-grid", { id: "features", kind: "feature-grid", heading: ref, items: [item] }, "C", "list"],
    ["ordered-step-sequence", { id: "steps", kind: "ordered-step-sequence", heading: ref, items: [{ ...item, ordinal: ref }] }, "B", "sequence"],
    ["status-list", { id: "status", kind: "status-list", heading: ref, labels: { available: ref, partial: ref, planned: ref, dispositions: { "not-offered": ref } }, items: ["one", "two", "three"].map(id => ({ id, label: ref, state: "available" as const })) }, "B", "table"],
    ["stat-grid", { id: "stats", kind: "stat-grid", heading: ref, items: [{ id: "s", label: ref, value: ref }] }, "B", "proof"],
    ["stat", { id: "stat", kind: "stat", items: [{ id: "s", label: ref, value: ref }] }, "B", "proof"],
    ["testimonial", { id: "quote", kind: "testimonial", items: [{ id: "q", quote: ref, attributorName: ref }] }, "B", "proof"],
  ];
  it.each(rows)("derives %s", (_name, value, weight, shape) => { expect(validateSectionedViewDocument(value.kind === "hero" ? { id: "page", sectionGroundRhythm: "view", sections: [value] } : doc(value))).toEqual([]); expect(sectionWeight(value)).toEqual({ weight, shape }); });
  it("ignores ground and resolves stacked-media precedence before blocks", () => {
    expect(sectionWeight(A({ ground: "inverse", block: { type: "items", recipe: "faq", items: items(4) } }))).toEqual({ weight: "A", shape: "specimen" });
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
    ["set-piece-shape", [A(), B(), A(), B()], [A(), B(), section({ block: statementBlock }), B()]],
    ["set-piece-count", [A(), B(), A()], [A(), B(), C()]],
    ["pause-count", [A(), B(), B(), A(), B()], [A(), B(), C(), A(), B()]],
    ["closing-band", [A(), B(), A()], [A(), B(), C()]],
    ["inverse-weight", [A(), B({ ground: "inverse" }), C()], [A(), section({ ground: "inverse", block: statementBlock }), B()]],
    ["primary-placement", [A(), B(), actionA([{ id: "go", label: ref, href: "/start", emphasis: "primary" }]), B()], [actionA([{ id: "go", label: ref, href: "/start", emphasis: "primary" }]), B(), C()]],
    ["primary-target", [actionA([{ id: "go", label: ref, href: "/other", emphasis: "primary" }]), B()], [actionA([{ id: "go", label: ref, href: "/start", emphasis: "primary" }]), B()]],
    ["link-groups", [linked("a", "/one"), linked("b", "/two"), linked("c", "/three")], [linked("a", "/one"), linked("b", "/two")]],
    ["link-repeat", [linked("a", "/guide/"), B({ footnote: { text: ref, link: { label: ref, href: "/guide#details" } } })], [linked("a", "/guide"), B({ footnote: { text: ref, link: { label: ref, href: "/other" } } })]],
  ];
  it.each(cases)("%s has a failing and passing fixture", (rule, fail, pass) => {
    expect(validateSectionedViewDocument(doc(...fail))).toEqual([]);
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
  const list = section({ block: features });
  expect(rules(doc(list, A(), B()), "opening-pause")).toHaveLength(1);
  expect(rules(doc(A(), C(), B()), "opening-pause")).toHaveLength(1);
});
it("checks explicit inverse at both body edges", () => {
  const statement = section({ ground: "inverse", block: statementBlock });
  expect(rules(doc(statement, B()), "inverse-weight")).toHaveLength(1);
  expect(rules(doc(A(), B(), statement), "inverse-weight")).toHaveLength(1);
});

it("fits explicit action weight ceilings and counts without guessing omitted emphasis", () => {
  const action = (emphasis: "primary" | "secondary") => ({ id: "go", label: ref, href: "/guide", emphasis });
  expect(rules(doc(actionA([action("primary")]), B(), C()), "action-weight")).toEqual([]);
  expect(rules(doc(actionA([action("secondary")]), B(), C()), "action-weight")).toEqual([]);
  expect(rules(doc(actionA([action("secondary"), { ...action("secondary"), id: "two" }]), B()), "action-weight")).toHaveLength(1);
  expect(rules(doc(A(), section({ layout: "split-end", media, actions: [action("primary")] }), C()), "action-weight")).toHaveLength(1);
  const overweight = doc(A(), C({ actions: [action("secondary")] }));
  expect(rules(overweight, "action-weight")).toMatchObject([{ rule: "sectioned-view-flow-action-weight", path: "sections.2.actions.0", severity: "warning" }]);
  expect(checkPageFlow(overweight).some((finding) => finding.rule === ["sectioned-view-flow-action", "tier"].join("-"))).toBe(false);
  expect(rules(doc(A(), C({ actions: [{ id: "one", label: ref, href: "/one" }, { id: "two", label: ref, href: "/two" }] })), "action-weight")).toHaveLength(1);
  expect(rules(doc(A(), linked("links", "/guide")), "action-weight")).toEqual([]);
});

it("matches the weight-resolved rendering defaults", () => {
  const omitted = { id: "go", label: ref, href: "/guide" };
  expect(rules(doc(actionA([omitted]), B(), C()), "action-weight")).toEqual([]);
  expect(rules(doc(actionA([omitted, { ...omitted, id: "two" }]), B()), "action-weight")).toEqual([]);
  expect(rules(doc(A(), C({ actions: [omitted] })), "action-weight")).toEqual([]);
  expect(rules(doc(A(), section({ layout: "split-end", media, actions: [omitted] }), C()), "action-weight")).toEqual([]);
});

it("compares hero and supplied close even when there are no body bands", () => {
  expect(rules(doc(), "primary-target", { callToAction: { href: "/other" } })).toHaveLength(1);
  expect(rules(doc(), "primary-target", { callToAction: { href: "/start" } })).toEqual([]);
});

it("accepts a complete six-band flow with no findings", () => {
  const faq: SectionedViewSection = { id: "faq", kind: "faq", heading: ref, items: Array.from({ length: 4 }, (_, index) => ({ id: `question-${index}`, question: ref, answer: ref })) };
  const statement = section({ block: statementBlock });
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
    for (const [band, expected] of [[actionA([action]), "secondary"], [B({ layout: "split-end", actions: [action] }), "tertiary"], [C({ actions: [action] }), "tertiary"], [section({ block: features }), "quiet"]] as const) {
      expect(validateSectionedViewDocument(doc(band))).toEqual([]);
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

it("uses ceil for the maximum pauses across four and five body bands", () => {
  for (const bands of [[C(), A(), B(), C()], [C(), A(), B(), C(), B()]]) {
    expect(validateSectionedViewDocument(doc(...bands))).toEqual([]);
    expect(rules(doc(...bands), "pause-count")).toEqual([]);
  }
  for (const bands of [[A(), C(), C(), C()], [A(), C(), B(), C(), C()]]) expect(rules(doc(...bands), "pause-count")).toHaveLength(1);
});
