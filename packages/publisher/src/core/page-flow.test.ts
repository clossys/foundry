import { createHash } from "node:crypto";
import { contentCatalogDocument } from "../preview/fixture-content-catalog.js";
import { describe, expect, it } from "vitest";
import type { SectionedViewDocument, SectionedViewSection } from "./sectioned-view.js";
import { checkSectionVariety, validateSectionedViewDocument } from "./sectioned-view.js";
import { checkPageFlow, sectionWeight } from "./page-flow.js";

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

it("keeps existing catalog variety output byte-identical", () => {
  expect(createHash("sha256").update(JSON.stringify(checkSectionVariety(contentCatalogDocument))).digest("hex")).toBe("d79f6fff1f380e820d196344aa4627353a8601d184e9d95220a931b0f5d631b9");
});

it("pins set-piece minimum transitions and short-page bounds", () => {
  expect(rules(doc(B(), B()), "set-piece-count")).toEqual([]);
  expect(rules(doc(B(), B(), C()), "set-piece-count")).toHaveLength(1);
  expect(rules(doc(A(), B(), C(), B(), B()), "set-piece-count")).toEqual([]);
  expect(rules(doc(A(), B(), C(), B(), B(), C()), "set-piece-count")).toHaveLength(1);
  expect(rules(doc(A(), B(), C(), A(), B(), C()), "set-piece-count")).toEqual([]);
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
  expect(rules(doc(actionA([action("primary")]), B(), C()), "action-fit")).toEqual([]);
  expect(rules(doc(actionA([action("secondary")]), B(), C()), "action-fit")).toEqual([]);
  expect(rules(doc(actionA([action("secondary"), { ...action("secondary"), id: "two" }]), B()), "action-fit")).toHaveLength(1);
  expect(rules(doc(A(), section({ layout: "split", media, actions: [action("primary")] }), C()), "action-fit")).toHaveLength(1);
  expect(rules(doc(A(), C({ actions: [action("secondary")] })), "action-fit")).toHaveLength(1);
  expect(rules(doc(A(), C({ actions: [{ id: "one", label: ref, href: "/one" }, { id: "two", label: ref, href: "/two" }] })), "action-fit")).toHaveLength(3);
  expect(rules(doc(A(), linked("links", "/guide")), "action-fit")).toEqual([]);
});

it("matches the current secondary rendering default until the emphasis ladder changes", () => {
  const omitted = { id: "go", label: ref, href: "/guide" };
  expect(rules(doc(actionA([omitted]), B(), C()), "action-fit")).toEqual([]);
  expect(rules(doc(actionA([omitted, { ...omitted, id: "two" }]), B()), "action-fit")).toHaveLength(1);
  expect(rules(doc(A(), C({ actions: [omitted] })), "action-fit")).toHaveLength(1);
  expect(rules(doc(A(), section({ layout: "split", media, actions: [omitted] }), C()), "action-fit")).toHaveLength(1);
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


it("compares every currently primary hero action with the shared close target", () => {
  const page: SectionedViewDocument = { ...doc(), sections: [{ ...hero, actions: [{ id: "first", label: ref, href: "/start" }, { id: "second", label: ref, href: "/other" }] }] };
  expect(validateSectionedViewDocument(page)).toEqual([]);
  const findings = rules(page, "primary-target", { callToAction: { href: "/start" } });
  expect(findings).toHaveLength(1);
  expect(findings[0]?.path).toBe("sections.0.actions.1.href");
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
