/**
 * The `content-section` kind, feature-grid item icons, and the
 * `checkSectionVariety` page-rhythm lint. Contract only: these tests validate
 * and resolve documents; no view renders them here.
 */

import { describe, expect, it } from "vitest";
import { createCopyResolver } from "@clossys/writer";
import type { CopyRef, CopyRegistry } from "@clossys/writer";
import {
  checkSectionVariety,
  CONTENT_ICON_NAMES,
  resolveSectionedViewDocument,
  SectionedViewResolutionError,
  validateSectionedViewDocument,
} from "./sectioned-view.js";
import type {
  ResolvedSectionedViewContentSection,
  SectionedViewContentModule,
  SectionedViewContentSection,
  SectionedViewDocument,
  SectionedViewSection,
  SectionedViewSpecimenMedia,
  SectionedViewSpecimenPanel,
  SectionedViewSpecimenPart,
} from "./sectioned-view.js";

const copyIds = new Set<string>();
/** A CopyRef whose id is registered with the fixture registry below. */
const ref = (id: string): CopyRef => {
  copyIds.add(id);
  return { id };
};

const status = (tone: "success" | "warning" | "danger" | "info" | "neutral", id: string) => ({ tone, label: ref(`acme.status.${id}`) });

const fieldsPart = (id: string, rows = 2): SectionedViewSpecimenPart => ({
  id,
  type: "fields",
  label: ref(`acme.${id}.label`),
  columns: 2,
  items: Array.from({ length: rows }, (_, index) => ({ id: `f${index}`, label: ref(`acme.${id}.f${index}.label`), value: ref(`acme.${id}.f${index}.value`) })),
});

const panelA: SectionedViewSpecimenPanel = {
  id: "covenants",
  title: ref("acme.panel.a.title"),
  meta: ref("acme.panel.a.meta"),
  status: status("warning", "review"),
  parts: [
    fieldsPart("terms"),
    { id: "checks", type: "status-rows", items: [{ id: "one", label: ref("acme.checks.one.label"), detail: ref("acme.checks.one.detail"), status: status("success", "within") }] },
    { id: "ratio", type: "meter", label: ref("acme.ratio.label"), value: 3.4, scaleMax: 5, limit: 3, direction: "max", tone: "danger", valueText: ref("acme.ratio.value"), limitText: ref("acme.ratio.limit"), status: status("danger", "outside"), note: ref("acme.ratio.note") },
  ],
  footer: { assignee: { initials: ref("acme.assignee.initials"), name: ref("acme.assignee.name"), note: ref("acme.assignee.note") }, note: ref("acme.footer.note") },
};

const panelB: SectionedViewSpecimenPanel = {
  id: "reporting",
  title: ref("acme.panel.b.title"),
  parts: [
    {
      id: "matrix",
      type: "table",
      caption: ref("acme.matrix.caption"),
      columns: [{ id: "name", label: ref("acme.matrix.col.name") }, { id: "state", label: ref("acme.matrix.col.state") }],
      rows: [{ id: "q1", cells: [{ text: ref("acme.matrix.q1.name") }, { status: status("info", "received") }] }],
    },
    { id: "due", type: "schedule", label: ref("acme.due.label"), items: [{ id: "one", date: ref("acme.due.one.date"), label: ref("acme.due.one.label"), amount: ref("acme.due.one.amount"), status: status("neutral", "scheduled") }] },
  ],
};

const panelC: SectionedViewSpecimenPanel = {
  id: "owners",
  title: ref("acme.panel.c.title"),
  parts: [
    { id: "split", type: "shares", items: [{ id: "one", name: ref("acme.shares.one.name"), share: 60, shareText: ref("acme.shares.one.text"), status: status("success", "verified") }] },
    { id: "docs", type: "files", items: [{ id: "one", format: ref("acme.files.one.format"), name: ref("acme.files.one.name"), source: ref("acme.files.one.source") }] },
  ],
};

const specimen = (panels: SectionedViewSpecimenPanel[], arrangement?: SectionedViewSpecimenMedia["arrangement"]): SectionedViewSpecimenMedia => ({
  type: "specimen",
  label: ref("acme.specimen.label"),
  ...(arrangement === undefined ? {} : { arrangement }),
  ...(arrangement === "flow" ? { connector: ref("acme.specimen.connector") } : {}),
  panels,
});

const item = (id: string, extra: Record<string, unknown> = {}) => ({ id, heading: ref(`acme.item.${id}.heading`), description: ref(`acme.item.${id}.description`), ...extra });

const featuresModule: SectionedViewContentModule = { type: "features", columns: 3, treatment: "plate", items: [item("a", { icon: "landmark" }), item("b", { icon: "scale", eyebrow: ref("acme.item.b.eyebrow") }), item("c")] };
const cardsModule: SectionedViewContentModule = {
  type: "cards",
  items: [
    { ...item("wide"), span: "two-thirds", icon: "layers", visual: fieldsPart("wide-visual", 5) },
    { ...item("narrow"), span: "third" },
    { ...item("t1"), span: "third" },
    { ...item("t2"), span: "third" },
    { ...item("t3"), span: "third" },
  ],
};
const comparisonModule: SectionedViewContentModule = {
  type: "comparison",
  before: { label: ref("acme.before.label"), heading: ref("acme.before.heading"), points: [ref("acme.before.p1"), ref("acme.before.p2")], visual: panelC },
  after: { label: ref("acme.after.label"), points: [ref("acme.after.p1"), ref("acme.after.p2")], visual: { ...panelC, id: "owners-after" } },
};
const topicsModule: SectionedViewContentModule = { type: "topics", columns: 2, items: [item("ta", { icon: "file-check" }), item("tb"), item("tc"), item("td")] };
const stepsModule: SectionedViewContentModule = {
  type: "steps",
  items: [
    { id: "one", ordinal: ref("acme.step.one.ordinal"), label: ref("acme.step.one.actor"), heading: ref("acme.step.one.heading"), description: ref("acme.step.one.description"), visual: panelB },
    { id: "two", ordinal: ref("acme.step.two.ordinal"), heading: ref("acme.step.two.heading") },
    { id: "three", ordinal: ref("acme.step.three.ordinal"), heading: ref("acme.step.three.heading") },
  ],
};
const faqModule: SectionedViewContentModule = {
  type: "faq",
  items: ["q1", "q2", "q3", "q4"].map((id) => ({ id, question: ref(`acme.faq.${id}.question`), answer: ref(`acme.faq.${id}.answer`) })),
};

const section = (id: string, extra: Partial<SectionedViewContentSection> = {}): SectionedViewContentSection => ({
  id,
  kind: "content-section",
  heading: ref(`acme.${id}.heading`),
  ...extra,
});

const fullDocument: SectionedViewDocument = {
  id: "acme-content",
  sectionGroundRhythm: "view",
  sections: [
    { id: "welcome", kind: "hero", heading: ref("acme.hero.heading") },
    section("evidence", { eyebrow: ref("acme.evidence.eyebrow"), description: ref("acme.evidence.description"), layout: "split", mediaSide: "start", module: topicsModule, media: specimen([panelA, panelB, panelC], "flow") }),
    section("principles", { align: "center", module: featuresModule }),
    section("capabilities", { module: cardsModule }),
    section("questions", { module: faqModule }),
    section("problem", { module: comparisonModule }),
    section("intro", { description: ref("acme.intro.description"), actions: [{ id: "more", label: ref("acme.intro.more"), href: "/more" }] }),
    section("flow", { module: stepsModule }),
    { id: "legacy", kind: "feature-grid", heading: ref("acme.legacy.heading"), items: [{ id: "one", icon: "globe", heading: ref("acme.legacy.one.heading") }] },
  ],
};

function registryFor(ids: Iterable<string>, omit: readonly string[] = []): CopyRegistry {
  return {
    id: "acme-content-fixture",
    locale: "en",
    revision: "1",
    source: { kind: "consumer", reference: "fixtures/acme-content" },
    entries: [...ids].filter((id) => !omit.includes(id)).map((id) => ({ id, text: `Text for ${id}`, context: "fixture", status: "approved" as const })),
  };
}

const docWith = (...sections: SectionedViewSection[]): SectionedViewDocument => ({ id: "acme-one", sectionGroundRhythm: "view", sections });
const rules = (document: unknown) => validateSectionedViewDocument(document).map((entry) => entry.rule);
/** A one-section document holding `module`, for module-level refusals. */
const moduleDoc = (module: unknown) => docWith(section("only", { module: module as SectionedViewContentModule }));
const partDoc = (part: unknown) => docWith(section("only", { media: specimen([{ id: "p", title: ref("acme.p.title"), parts: [part as SectionedViewSpecimenPart] }]) }));

describe("content-section — validation", () => {
  it("accepts a document using every module type, every specimen part, and an intro band", () => {
    expect(validateSectionedViewDocument(fullDocument)).toEqual([]);
  });

  it("lists exactly sixteen content icon names, and every feature-grid and content item icon must be one of them", () => {
    expect(CONTENT_ICON_NAMES).toHaveLength(16);
    expect(new Set(CONTENT_ICON_NAMES).size).toBe(16);
    const legacy = docWith({ id: "legacy", kind: "feature-grid", heading: ref("acme.legacy.heading"), items: [{ id: "one", icon: "rocket" as never, heading: ref("acme.legacy.one.heading") }] });
    expect(rules(legacy)).toEqual(["sectioned-view-content-icon"]);
    expect(rules(moduleDoc({ type: "topics", columns: 1, items: [item("a", { icon: "sparkles" }), item("b")] }))).toEqual(["sectioned-view-content-icon"]);
  });

  it("keeps a feature-grid item without an icon valid, unchanged from before", () => {
    expect(rules(docWith({ id: "legacy", kind: "feature-grid", heading: ref("acme.legacy.heading"), items: [{ id: "one", heading: ref("acme.legacy.one.heading") }] }))).toEqual([]);
  });

  it("refuses mediaSide without split, align on a split, and a split without media", () => {
    expect(rules(docWith(section("a", { mediaSide: "end" })))).toEqual(["sectioned-view-content-media-side"]);
    expect(rules(docWith(section("a", { layout: "split", align: "center", media: specimen([panelB]) })))).toEqual(["sectioned-view-content-align"]);
    expect(rules(docWith(section("a", { layout: "split", module: topicsModule })))).toEqual(["sectioned-view-content-split-media"]);
    expect(rules(docWith(section("a", { layout: "grid" as never })))).toEqual(["sectioned-view-content-layout"]);
  });

  it("refuses keys a content section, a module, or an item does not own", () => {
    expect(rules(docWith({ ...section("a"), className: "x" } as SectionedViewSection))).toEqual(["sectioned-view-section-keys"]);
    expect(rules(moduleDoc({ ...topicsModule, treatment: "rule" }))).toEqual(["sectioned-view-content-module-shape"]);
    expect(rules(moduleDoc({ type: "topics", items: [item("a", { href: "/x" }), item("b")] }))).toEqual(["sectioned-view-item-shape"]);
    expect(rules(moduleDoc({ type: "slider", items: [] }))).toEqual(["sectioned-view-content-module-type"]);
  });

  it("names the supported module types when it refuses an unknown one", () => {
    const message = validateSectionedViewDocument(moduleDoc({ type: "slider" }))[0]?.message ?? "";
    expect(message).toContain('"slider"');
    expect(message).toContain("features, cards, comparison, topics, steps, faq");
  });

  it("holds features to 2-4 items, exactly 3 with statement emphasis, and icons to plain and plate", () => {
    expect(rules(moduleDoc({ type: "features", items: [item("a")] }))).toEqual(["sectioned-view-content-count"]);
    expect(rules(moduleDoc({ type: "features", items: ["a", "b", "c", "d", "e"].map((id) => item(id)) }))).toEqual(["sectioned-view-content-count"]);
    expect(rules(moduleDoc({ type: "features", emphasis: "statement", items: ["a", "b", "c", "d"].map((id) => item(id)) }))).toEqual(["sectioned-view-content-count"]);
    expect(rules(moduleDoc({ type: "features", emphasis: "statement", items: ["a", "b", "c"].map((id) => item(id)) }))).toEqual([]);
    expect(rules(moduleDoc({ type: "features", treatment: "rule", items: [item("a", { icon: "globe" }), item("b")] }))).toEqual(["sectioned-view-content-icon-treatment"]);
    expect(rules(moduleDoc({ type: "features", columns: 5, items: [item("a"), item("b")] }))).toEqual(["sectioned-view-content-module-option"]);
  });

  it("holds card spans to whole rows: two-thirds + third, three thirds, two halves, or one full card", () => {
    const cards = (...spans: string[]) => moduleDoc({ type: "cards", items: spans.map((span, index) => ({ ...item(`c${index}`), span })) });
    expect(rules(cards("third", "two-thirds"))).toEqual([]);
    expect(rules(cards("half", "half", "full"))).toEqual([]);
    expect(rules(cards("half", "third", "third"))).toEqual(["sectioned-view-content-card-spans"]);
    expect(rules(cards("third", "third"))).toEqual(["sectioned-view-content-card-spans"]);
    expect(rules(cards("full"))).toEqual(["sectioned-view-content-count"]);
    expect(rules(cards("third", "third", "third", "third", "third", "third", "half", "half"))).toEqual(["sectioned-view-content-count"]);
    expect(rules(cards("third", "wide" as never, "third"))).toEqual(["sectioned-view-content-card-span"]);
  });

  it("holds a card's visual to one part of at most 5 rows", () => {
    expect(rules(moduleDoc({ type: "cards", items: [{ ...item("a"), span: "half", visual: fieldsPart("v", 6) }, { ...item("b"), span: "half" }] }))).toEqual(["sectioned-view-content-count"]);
  });

  it("holds a comparison's sides to the same form, the same point count, and a visual on both or neither", () => {
    const side = (extra: Record<string, unknown>) => ({ label: ref("acme.side.label"), ...extra });
    const points = (count: number) => Array.from({ length: count }, (_, index) => ref(`acme.point.${index}`));
    const comparison = (before: unknown, after: unknown) => moduleDoc({ type: "comparison", before, after });
    expect(rules(comparison(side({ description: ref("acme.d") }), side({ description: ref("acme.d") })))).toEqual([]);
    expect(rules(comparison(side({ description: ref("acme.d") }), side({ points: points(2) })))).toEqual(["sectioned-view-content-comparison-sides"]);
    expect(rules(comparison(side({ points: points(2) }), side({ points: points(3) })))).toEqual(["sectioned-view-content-comparison-sides"]);
    expect(rules(comparison(side({ points: points(5) }), side({ points: points(5) })))).toEqual(["sectioned-view-content-count", "sectioned-view-content-count"]);
    expect(rules(comparison(side({ description: ref("acme.d"), visual: panelB }), side({ description: ref("acme.d") })))).toEqual(["sectioned-view-content-comparison-sides"]);
    expect(rules(comparison(side({ description: ref("acme.d"), points: points(2) }), side({ description: ref("acme.d") })))).toContain("sectioned-view-content-comparison-side");
    expect(rules(comparison(side({}), side({ description: ref("acme.d") })))).toContain("sectioned-view-content-comparison-side");
  });

  it("holds topics to 2-8 items, an even count in 2 columns, and steps to 3-4 and faq to 4-6", () => {
    const topics = (count: number, columns?: 1 | 2) => moduleDoc({ type: "topics", ...(columns ? { columns } : {}), items: Array.from({ length: count }, (_, index) => item(`t${index}`)) });
    expect(rules(topics(3))).toEqual(["sectioned-view-content-count"]);
    expect(rules(topics(3, 1))).toEqual([]);
    expect(rules(topics(10))).toEqual(["sectioned-view-content-count"]);
    expect(rules(moduleDoc({ type: "steps", items: stepsModule.type === "steps" ? stepsModule.items.slice(0, 2) : [] }))).toEqual(["sectioned-view-content-count"]);
    expect(rules(moduleDoc({ type: "faq", items: faqModule.type === "faq" ? faqModule.items.slice(0, 3) : [] }))).toEqual(["sectioned-view-content-count"]);
  });

  it("holds a specimen's panels to its arrangement and its connector to flow", () => {
    expect(rules(docWith(section("a", { media: specimen([panelB, panelC]) })))).toEqual(["sectioned-view-content-count"]);
    expect(rules(docWith(section("a", { media: specimen([panelB], "row") })))).toEqual(["sectioned-view-content-count"]);
    expect(rules(docWith(section("a", { media: { ...specimen([panelB, panelC], "row"), connector: ref("acme.connector") } })))).toEqual(["sectioned-view-specimen-connector"]);
    expect(rules(docWith(section("a", { media: { ...specimen([panelB]), type: "video" as never } })))).toEqual(["sectioned-view-content-media-type"]);
    expect(rules(docWith(section("a", { media: specimen([panelB, { ...panelB }], "row") })))).toEqual(["sectioned-view-item-id-duplicate"]);
  });

  it("holds a panel to 1-3 parts and a footer to an assignee, a note, or both", () => {
    const panel = (extra: Record<string, unknown>) => docWith(section("a", { media: specimen([{ ...panelB, ...extra } as SectionedViewSpecimenPanel]) }));
    expect(rules(panel({ parts: [fieldsPart("a"), fieldsPart("b"), fieldsPart("c"), fieldsPart("d")] }))).toEqual(["sectioned-view-content-count"]);
    expect(rules(panel({ footer: {} }))).toEqual(["sectioned-view-specimen-footer-shape"]);
    expect(rules(panel({ footer: { assignee: { name: ref("acme.n") } } }))).toEqual(["sectioned-view-specimen-footer-shape"]);
    expect(rules(panel({ href: "/open" }))).toEqual(["sectioned-view-specimen-panel-shape"]);
  });

  it("holds every part to 6 rows and a table to 4 columns, 5 rows, and one cell per column", () => {
    expect(rules(partDoc(fieldsPart("f", 7)))).toEqual(["sectioned-view-content-count"]);
    const table = (columns: number, rows: number, cells = columns) => ({
      id: "t",
      type: "table",
      caption: ref("acme.t.caption"),
      columns: Array.from({ length: columns }, (_, index) => ({ id: `c${index}`, label: ref(`acme.t.c${index}`) })),
      rows: Array.from({ length: rows }, (_, index) => ({ id: `r${index}`, cells: Array.from({ length: cells }, () => ({ text: ref("acme.t.cell") })) })),
    });
    expect(rules(partDoc(table(4, 5)))).toEqual([]);
    expect(rules(partDoc(table(5, 1)))).toEqual(["sectioned-view-content-count"]);
    expect(rules(partDoc(table(2, 6)))).toEqual(["sectioned-view-content-count"]);
    expect(rules(partDoc(table(2, 1, 3)))).toEqual(["sectioned-view-specimen-table-cells"]);
    const bothCell = { ...table(1, 1), rows: [{ id: "r", cells: [{ text: ref("acme.t.cell"), status: status("info", "x") }] }] };
    expect(rules(partDoc(bothCell))).toEqual(["sectioned-view-specimen-table-cells"]);
  });

  it("holds meter and share numbers to finite, non-negative values and a meter's limit text to a limit", () => {
    const meter = (extra: Record<string, unknown>) => partDoc({ id: "m", type: "meter", label: ref("acme.m.label"), value: 2, scaleMax: 4, tone: "info", valueText: ref("acme.m.value"), ...extra });
    expect(rules(meter({}))).toEqual([]);
    expect(rules(meter({ scaleMax: 0 }))).toEqual(["sectioned-view-specimen-number"]);
    expect(rules(meter({ value: -1 }))).toEqual(["sectioned-view-specimen-number"]);
    expect(rules(meter({ value: Number.NaN }))).toEqual(["sectioned-view-specimen-number"]);
    expect(rules(meter({ limit: Number.POSITIVE_INFINITY, limitText: ref("acme.m.limit") }))).toEqual(["sectioned-view-specimen-number"]);
    expect(rules(meter({ value: "2" }))).toEqual(["sectioned-view-specimen-number"]);
    expect(rules(meter({ limitText: ref("acme.m.limit") }))).toEqual(["sectioned-view-specimen-limit-text"]);
    expect(rules(meter({ tone: "brand" }))).toEqual(["sectioned-view-specimen-tone"]);
    expect(rules(meter({ direction: "up" }))).toEqual(["sectioned-view-content-module-option"]);
    const shares = (share: unknown) => partDoc({ id: "s", type: "shares", items: [{ id: "a", name: ref("acme.s.name"), share, shareText: ref("acme.s.text") }] });
    expect(rules(shares(100))).toEqual([]);
    expect(rules(shares(101))).toEqual(["sectioned-view-specimen-number"]);
  });

  it("refuses an unknown part type, a status outside the closed tones, and copy that is not a CopyRef", () => {
    expect(rules(partDoc({ id: "x", type: "chart", items: [] }))).toEqual(["sectioned-view-specimen-part-type"]);
    expect(rules(partDoc({ id: "x", type: "status-rows", items: [{ id: "a", label: ref("acme.l"), status: { tone: "live", label: ref("acme.s") } }] }))).toEqual(["sectioned-view-specimen-tone"]);
    expect(rules(partDoc({ id: "x", type: "files", items: [{ id: "a", format: "PDF", name: ref("acme.n") }] }))).toEqual(["sectioned-view-copy-ref-shape"]);
  });
});

describe("content-section — resolution", () => {
  const resolver = createCopyResolver(registryFor(copyIds));

  it("resolves every CopyRef to text, keeps numbers, tones and ids, and leaves absent optional fields absent", () => {
    const resolved = resolveSectionedViewDocument(fullDocument, resolver);
    const evidence = resolved.sections[1] as ResolvedSectionedViewContentSection;
    expect(evidence.kind).toBe("content-section");
    expect(evidence.ground).toBe("base");
    expect(evidence.heading).toBe("Text for acme.evidence.heading");
    expect(evidence.layout).toBe("split");
    expect(evidence.mediaSide).toBe("start");
    const media = evidence.media!;
    expect(media.label).toBe("Text for acme.specimen.label");
    expect(media.connector).toBe("Text for acme.specimen.connector");
    expect(media.arrangement).toBe("flow");
    const meter = media.panels[0]!.parts[2]!;
    expect(meter).toEqual({ id: "ratio", type: "meter", label: "Text for acme.ratio.label", value: 3.4, scaleMax: 5, limit: 3, direction: "max", tone: "danger", valueText: "Text for acme.ratio.value", limitText: "Text for acme.ratio.limit", status: { tone: "danger", label: "Text for acme.status.outside" }, note: "Text for acme.ratio.note" });
    expect(media.panels[1]!.parts[0]).toEqual({ id: "matrix", type: "table", caption: "Text for acme.matrix.caption", columns: [{ id: "name", label: "Text for acme.matrix.col.name" }, { id: "state", label: "Text for acme.matrix.col.state" }], rows: [{ id: "q1", cells: [{ text: "Text for acme.matrix.q1.name" }, { status: { tone: "info", label: "Text for acme.status.received" } }] }] });
    expect(media.panels[0]!.footer).toEqual({ assignee: { initials: "Text for acme.assignee.initials", name: "Text for acme.assignee.name", note: "Text for acme.assignee.note" }, note: "Text for acme.footer.note" });

    const principles = resolved.sections[2] as ResolvedSectionedViewContentSection;
    expect(Object.hasOwn(principles, "eyebrow")).toBe(false);
    expect(Object.hasOwn(principles, "media")).toBe(false);
    expect(principles.module).toEqual({
      type: "features",
      columns: 3,
      treatment: "plate",
      items: [
        { id: "a", icon: "landmark", heading: "Text for acme.item.a.heading", description: "Text for acme.item.a.description" },
        { id: "b", icon: "scale", eyebrow: "Text for acme.item.b.eyebrow", heading: "Text for acme.item.b.heading", description: "Text for acme.item.b.description" },
        { id: "c", heading: "Text for acme.item.c.heading", description: "Text for acme.item.c.description" },
      ],
    });
    const cards = (resolved.sections[3] as ResolvedSectionedViewContentSection).module;
    expect(cards?.type === "cards" && cards.items[0]!.visual?.type).toBe("fields");
    const intro = resolved.sections[6] as ResolvedSectionedViewContentSection;
    expect(intro.actions).toEqual([{ id: "more", label: "Text for acme.intro.more", href: "/more" }]);
    expect(Object.hasOwn(intro, "module")).toBe(false);
  });

  it("carries a feature-grid item's icon through resolution", () => {
    const resolved = resolveSectionedViewDocument(fullDocument, resolver);
    const legacy = resolved.sections[8]!;
    expect(legacy.kind === "feature-grid" && legacy.items[0]).toEqual({ id: "one", icon: "globe", heading: "Text for acme.legacy.one.heading", description: undefined });
  });

  it("records one resolution per CopyRef, in field order, ready for provenance", () => {
    const small = docWith(section("small", { eyebrow: ref("acme.small.eyebrow"), description: ref("acme.small.description"), module: { type: "topics", columns: 1, items: [item("x"), item("y")] } }));
    // `small` registers its own ids, so it needs a registry built after it.
    const resolved = resolveSectionedViewDocument(small, createCopyResolver(registryFor(copyIds)));
    expect(resolved.resolutions.map((resolution) => resolution.ref.id)).toEqual([
      "acme.small.eyebrow",
      "acme.small.heading",
      "acme.small.description",
      "acme.item.x.heading",
      "acme.item.x.description",
      "acme.item.y.heading",
      "acme.item.y.description",
    ]);
    const all = resolveSectionedViewDocument(fullDocument, resolver);
    expect(new Set(all.resolutions.map((resolution) => resolution.ref.id))).toEqual(copyIdsUsedBy(fullDocument));
  });

  it("names the exact path of unresolved specimen copy", () => {
    const missing = createCopyResolver(registryFor(copyIds, ["acme.ratio.value"]));
    try {
      resolveSectionedViewDocument(fullDocument, missing);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(SectionedViewResolutionError);
      expect((error as SectionedViewResolutionError).reason).toBe("unresolved-copy");
      expect((error as Error).message).toContain("sections.1.media.panels.0.parts.2.valueText");
    }
  });

  it("refuses an invalid content section before resolving any copy", () => {
    let calls = 0;
    const counting = (copyRef: CopyRef) => {
      calls += 1;
      return resolver(copyRef);
    };
    expect(() => resolveSectionedViewDocument(docWith(section("a", { mediaSide: "end" })), counting)).toThrow(SectionedViewResolutionError);
    expect(calls).toBe(0);
  });
});

/** Every CopyRef id a value holds, by walking it. */
function copyIdsUsedBy(value: unknown, ids = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach((entry) => copyIdsUsedBy(entry, ids));
  else if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record);
    if (keys.length === 1 && keys[0] === "id" && typeof record.id === "string" && copyIds.has(record.id)) ids.add(record.id);
    else Object.values(record).forEach((entry) => copyIdsUsedBy(entry, ids));
  }
  return ids;
}

describe("checkSectionVariety", () => {
  const hero: SectionedViewSection = { id: "welcome", kind: "hero", heading: ref("acme.hero.heading") };
  const warnings = (...sections: SectionedViewSection[]) => checkSectionVariety(docWith(hero, ...sections));
  const ruleList = (...sections: SectionedViewSection[]) => warnings(...sections).map((entry) => entry.rule);

  it("finds nothing on a varied page, and every finding it does report is a warning", () => {
    expect(checkSectionVariety(fullDocument)).toEqual([]);
    const findings = warnings(section("a", { module: topicsModule }), section("b", { module: topicsModule }));
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.every((entry) => entry.severity === "warning")).toBe(true);
  });

  it("leaves validation unchanged: a page with variety warnings still validates", () => {
    const repetitive = docWith(hero, section("a", { module: topicsModule }), section("b", { module: topicsModule }));
    expect(validateSectionedViewDocument(repetitive)).toEqual([]);
    expect(checkSectionVariety(repetitive).length).toBeGreaterThan(0);
  });

  it("warns when neighbouring bands share layout, module and visual", () => {
    expect(ruleList(section("a", { module: topicsModule }), section("b", { module: { ...topicsModule, columns: 1, items: topicsModule.items.slice(0, 3) } as SectionedViewContentModule }))).toEqual(["sectioned-view-variety-repeat"]);
    expect(ruleList(section("a"), section("b"))).toEqual(["sectioned-view-variety-repeat"]);
  });

  it("warns on a split after a split with the same side, and on three splits in a row", () => {
    const split = (id: string, mediaSide: "start" | "end", module: SectionedViewContentModule) => section(id, { layout: "split", mediaSide, module, media: specimen([panelB]) });
    expect(ruleList(split("a", "end", topicsModule), section("gap", { module: featuresModule }), split("b", "end", faqModule))).toEqual([]);
    expect(ruleList(split("a", "end", topicsModule), split("b", "end", faqModule))).toEqual(["sectioned-view-variety-split-side", "sectioned-view-variety-density"]);
    expect(ruleList(split("a", "end", topicsModule), split("b", "start", faqModule), split("c", "end", featuresModule))).toEqual([
      "sectioned-view-variety-density",
      "sectioned-view-variety-split-run",
      "sectioned-view-variety-density",
    ]);
  });

  it("warns when a dense band follows a dense band", () => {
    expect(ruleList(section("a", { module: cardsModule }), section("b", { module: stepsModule }))).toEqual(["sectioned-view-variety-density"]);
    expect(ruleList(section("a", { module: cardsModule }), section("b", { module: faqModule }), section("c", { module: stepsModule }))).toEqual([]);
  });

  it("warns on a specimen on an inverse ground and on a second inverse body band", () => {
    expect(ruleList(section("a", { ground: "inverse", media: specimen([panelB]) }))).toEqual(["sectioned-view-variety-specimen-ground"]);
    expect(ruleList(section("a", { ground: "inverse" }), section("b", { module: faqModule }), section("c", { ground: "inverse", module: topicsModule }))).toEqual(["sectioned-view-variety-inverse-bands"]);
    expect(checkSectionVariety(docWith({ ...hero, ground: "inverse" }, section("a", { ground: "inverse" }))).map((entry) => entry.rule)).toEqual([]);
  });

  it("warns on a second band of four or more cards and on a second comparison", () => {
    expect(ruleList(section("a", { module: cardsModule }), section("gap", { module: faqModule }), section("b", { module: cardsModule }))).toEqual(["sectioned-view-variety-card-bands", "sectioned-view-variety-treatment"]);
    const plainComparison: SectionedViewContentModule = { type: "comparison", before: { label: ref("acme.b"), description: ref("acme.d") }, after: { label: ref("acme.a"), description: ref("acme.d") } };
    expect(ruleList(section("a", { module: plainComparison }), section("gap", { module: faqModule }), section("b", { module: plainComparison }))).toEqual(["sectioned-view-variety-comparison-count"]);
  });

  it("warns when one module type repeats with the same treatment, not with a different one", () => {
    const rule: SectionedViewContentModule = { ...featuresModule, treatment: "rule", items: featuresModule.type === "features" ? featuresModule.items.map(({ icon: _icon, ...rest }) => rest) : [] };
    expect(ruleList(section("a", { module: featuresModule }), section("gap", { module: faqModule }), section("b", { module: rule }))).toEqual([]);
    expect(ruleList(section("a", { module: featuresModule }), section("gap", { module: faqModule }), section("b", { module: featuresModule }))).toEqual(["sectioned-view-variety-treatment"]);
  });

  it("reads several documents as one page and names each finding's document", () => {
    const first = docWith(hero, section("a", { module: topicsModule }));
    const second: SectionedViewDocument = { id: "acme-two", sectionGroundRhythm: "view", sections: [section("b", { module: topicsModule })] };
    const findings = checkSectionVariety([first, second]);
    expect(findings.map((entry) => [entry.rule, entry.path])).toEqual([
      ["sectioned-view-variety-repeat", "documents.1.sections.0"],
      ["sectioned-view-variety-treatment", "documents.1.sections.0"],
    ]);
  });
});
