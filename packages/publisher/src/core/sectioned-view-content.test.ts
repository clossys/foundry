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
  CONTENT_ITEM_EYEBROW_MAX_CHARACTERS,
  resolveSectionedViewDocument,
  SectionedViewResolutionError,
  validateSectionedViewDocument,
} from "./sectioned-view.js";
import type {
  ResolvedSectionedViewContentSection,
  SectionedViewContentBlock,
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

const specimen = (panel: SectionedViewSpecimenPanel): SectionedViewSpecimenMedia => ({ type: "specimen", label: ref("acme.specimen.label"), panel });

const item = (id: string, extra: Record<string, unknown> = {}) => ({ id, heading: ref(`acme.item.${id}.heading`), description: ref(`acme.item.${id}.description`), ...extra });

const featuresBlock: SectionedViewContentBlock = { type: "items", arrangement: "columns", columns: 3, treatment: "plate", items: [item("a", { icon: "landmark" }), item("b", { icon: "scale" }), item("c")] };
const cardsBlock: SectionedViewContentBlock = {
  type: "items", arrangement: "bento",
  items: [
    { ...item("wide"), span: "two-thirds", icon: "layers", eyebrow: ref("acme.item.wide.eyebrow"), visual: fieldsPart("wide-visual", 5) },
    { ...item("narrow"), span: "third" },
    { ...item("t1"), span: "third" },
    { ...item("t2"), span: "third" },
    { ...item("t3"), span: "third" },
  ],
};
const comparisonBlock: SectionedViewContentBlock = {
  type: "matrix", sides: [
    { id: "before", label: ref("acme.before.label"), heading: ref("acme.before.heading"), visual: panelC },
    { id: "after", label: ref("acme.after.label"), heading: ref("acme.after.heading"), visual: { ...panelC, id: "owners-after" } },
  ],
};
const topicsBlock: SectionedViewContentBlock = { type: "items", arrangement: "rows", columns: 2, items: [item("ta", { icon: "file-check" }), item("tb"), item("tc"), item("td")] };
const stepsBlock: SectionedViewContentBlock = {
  type: "items", arrangement: "columns", order: "connected",
  items: [
    { id: "one", meta: ref("acme.step.one.actor"), heading: ref("acme.step.one.heading"), description: ref("acme.step.one.description"), visual: panelB.parts[0] },
    { id: "two", heading: ref("acme.step.two.heading"), visual: panelB.parts[1] },
    { id: "three", heading: ref("acme.step.three.heading") },
  ],
};
type SectionedViewFaqItemShape = { id: string; question: CopyRef; answer: CopyRef };
const faqBlock: SectionedViewContentBlock = {
  type: "items", arrangement: "rows", reveal: "disclose",
  items: ["q1", "q2", "q3", "q4"].map((id) => ({ id, heading: ref(`acme.faq.${id}.question`), description: ref(`acme.faq.${id}.answer`) })),
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
    section("evidence", { eyebrow: ref("acme.evidence.eyebrow"), description: ref("acme.evidence.description"), layout: "split-start", block: topicsBlock, media: specimen(panelA) }),
    section("principles", { block: featuresBlock }),
    section("capabilities", { block: cardsBlock }),
    section("questions", { block: faqBlock }),
    section("problem", { block: comparisonBlock }),
    section("intro", { description: ref("acme.intro.description"), actions: [{ id: "more", label: ref("acme.intro.more"), href: "/more" }] }),
    section("flow", { block: stepsBlock }),
    { id: "legacy", kind: "feature-grid", heading: ref("acme.legacy.heading"), items: [{ id: "one", icon: "globe", heading: ref("acme.legacy.one.heading") }] },
  ],
};

function registryFor(ids: Iterable<string>, omit: readonly string[] = []): CopyRegistry {
  return {
    id: "acme-content-fixture",
    locale: "en",
    revision: "1",
    source: { kind: "consumer", reference: "fixtures/acme-content" },
    entries: [...ids].filter((id) => !omit.includes(id)).map((id) => ({ id, text: id === "acme.specimen.label" ? "A sample panel showing its labeled parts" : `Text for ${id}`, context: "fixture", status: "approved" as const })),
  };
}

const docWith = (...sections: SectionedViewSection[]): SectionedViewDocument => ({ id: "acme-one", sectionGroundRhythm: "view", sections });
const rules = (document: unknown) => validateSectionedViewDocument(document).map((entry) => entry.rule);
/** A one-section document holding `block`, for block-level refusals. */
const blockDoc = (block: unknown) => docWith(section("only", { block: block as SectionedViewContentBlock }));
const partDoc = (part: unknown) => docWith(section("only", { media: specimen({ id: "p", title: ref("acme.p.title"), parts: [part as SectionedViewSpecimenPart] }) }));

describe("content-section — validation", () => {
  it("accepts a document using every block type, every specimen part, and an intro band", () => {
    expect(validateSectionedViewDocument(fullDocument)).toEqual([]);
  });

  it("lists exactly sixteen content icon names, and every feature-grid and content item icon must be one of them", () => {
    expect(CONTENT_ICON_NAMES).toHaveLength(16);
    expect(new Set(CONTENT_ICON_NAMES).size).toBe(16);
    const legacy = docWith({ id: "legacy", kind: "feature-grid", heading: ref("acme.legacy.heading"), items: [{ id: "one", icon: "rocket" as never, heading: ref("acme.legacy.one.heading") }] });
    expect(rules(legacy)).toEqual(["sectioned-view-content-icon"]);
    expect(rules(blockDoc({ type: "items", arrangement: "rows", columns: 1, items: [item("a", { icon: "sparkles" }), item("b")] }))).toEqual(["sectioned-view-content-icon"]);
  });

  it("keeps a feature-grid item without an icon valid, unchanged from before", () => {
    expect(rules(docWith({ id: "legacy", kind: "feature-grid", heading: ref("acme.legacy.heading"), items: [{ id: "one", heading: ref("acme.legacy.one.heading") }] }))).toEqual([]);
  });

  it("refuses old frame fields and layout values, while accepting split alignment and header-only splits", () => {
    expect(rules(docWith(section("a", { mediaSide: "end" } as never)))).toContain("sectioned-view-section-keys");
    expect(rules(docWith(section("a", { layout: "split-end", media: specimen(panelB) })))).toEqual([]);
    for (const block of [undefined, cardsBlock, stepsBlock, comparisonBlock]) expect(rules(docWith(section("a", { layout: "split-end", block })))).toEqual([]);
    expect(rules(docWith(section("a", { layout: "split" as never })))).toContain("sectioned-view-content-layout");
  });

  it("accepts a text-only split: topic-list, or two-column item feature-grid, taking the visual column without media", () => {
    expect(rules(docWith(section("a", { layout: "split-end", block: topicsBlock })))).toEqual([]);
    expect(rules(docWith(section("a", { layout: "split-start", block: { type: "items", arrangement: "rows", columns: 1, items: [item("a"), item("b"), item("c")] } })))).toEqual([]);
    expect(rules(docWith(section("a", { layout: "split-end", block: { type: "items", arrangement: "columns", columns: 2, treatment: "rule", items: [item("a"), item("b")] } })))).toEqual([]);
    // A text-only split still takes media when it has some: then the block stays in the text column.
    expect(rules(docWith(section("a", { layout: "split-end", block: topicsBlock, media: specimen(panelB) })))).toEqual([]);
  });

  it("allows canonical block arrangements in either split direction without a media prerequisite", () => {
    for (const layout of ["split-start", "split-end"] as const) for (const block of [featuresBlock, topicsBlock, cardsBlock, stepsBlock, comparisonBlock]) expect(rules(docWith(section("a", { layout, block })))).toEqual([]);
    expect(rules(docWith(section("a", { layout: "split-end", block: featuresBlock, media: specimen(panelB) })))).toEqual([]);
  });

  it("accepts disclosed rows with optional single media in split or stacked frames", () => {
    for (const layout of ["stacked", "split-start", "split-end"] as const) {
      expect(rules(docWith(section("a", { layout, block: faqBlock })))).toEqual([]);
      expect(rules(docWith(section("a", { layout, block: faqBlock, media: specimen(panelB) })))).toEqual([]);
    }
  });

  it("lets a faq section opt into the split layout, stacked staying the default", () => {
    const faq = (extra: Record<string, unknown>) => docWith({ id: "q", kind: "faq", heading: ref("acme.q.heading"), items: (faqBlock as { items: { id: string; heading: CopyRef; description: CopyRef }[] }).items.map((entry) => ({ id: entry.id, question: entry.heading, answer: entry.description })), ...extra } as SectionedViewSection);
    expect(rules(faq({}))).toEqual([]);
    expect(rules(faq({ layout: "stacked" }))).toEqual([]);
    expect(rules(faq({ layout: "split" }))).toEqual([]);
    expect(rules(faq({ layout: "grid" }))).toEqual(["sectioned-view-faq-layout"]);
    expect(rules(faq({ layout: "split", mediaSide: "start" }))).toEqual(["sectioned-view-section-keys"]);
  });

  it("allows canonical eyebrow copy and enforces recipe-specific slots", () => {
    for (const treatment of ["plain", "rule", "plate"] as const) expect(rules(blockDoc({ type: "items", recipe: "features", columns: 2, treatment, items: [item("a", { eyebrow: ref("acme.e") }), item("b")] }))).toEqual([]);
    expect(rules(blockDoc({ type: "items", recipe: "features", columns: 2, items: [item("a", { eyebrow: "Area" }), item("b")] }))).toContain("sectioned-view-copy-ref-shape");
    expect(rules(blockDoc({ type: "items", recipe: "topics", items: [item("a", { eyebrow: ref("acme.e") }), item("b")] }))).toContain("recipe-slot");
    expect(rules(blockDoc({ type: "items", recipe: "cards", items: [item("a", { eyebrow: ref("acme.e") }), item("b")] }))).toEqual([]);
  });

  it("refuses keys outside the canonical frame, block and item contracts", () => {
    expect(rules(docWith({ ...section("a"), className: "x" } as SectionedViewSection))).toEqual(["sectioned-view-section-keys"]);
    expect(rules(blockDoc({ ...topicsBlock, className: "x" }))).toContain("sectioned-view-content-block-shape");
    expect(rules(blockDoc({ type: "items", arrangement: "rows", items: [item("a", { url: "/x" }), item("b")] }))).toContain("sectioned-view-item-shape");
    expect(rules(blockDoc({ type: "slider", items: [] }))).toEqual(["sectioned-view-content-block-type"]);
  });

  it("names canonical block types in an unknown-block refusal", () => {
    const message = validateSectionedViewDocument(blockDoc({ type: "slider" }))[0]?.message ?? "";
    expect(message).toBe('sections.0.block.type "slider" must be items, matrix or prose.');
  });

  it("refuses the retired module key and never reads it as a block alias", () => {
    for (const block of [undefined, topicsBlock]) {
      const findings = validateSectionedViewDocument(docWith({ ...section("a", { block }), module: topicsBlock } as unknown as SectionedViewSection));
      expect(findings).toContainEqual(expect.objectContaining({ rule: "sectioned-view-content-module-retired", path: "sections.0.module" }));
      expect(findings.find((entry) => entry.rule === "sectioned-view-content-module-retired")?.message).toContain("block");
      expect(findings.find((entry) => entry.rule === "sectioned-view-content-module-retired")?.message).toContain("items, matrix or prose");
    }
  });

  it("refuses old raw block types with replacement recipes, without prototype lookup", () => {
    for (const [retired, recipe] of [["feature-grid", "features"], ["card-grid", "cards"], ["topic-list", "topics"], ["ordered-step-sequence", "steps"], ["faq", "faq"], ["comparison", "comparison"]]) {
      const findings = validateSectionedViewDocument(blockDoc({ type: retired, items: [item("a"), item("b")] }));
      expect(findings).toContainEqual(expect.objectContaining({ rule: "sectioned-view-content-block-retired", path: "sections.0.block.type" }));
      expect(findings[0]?.message).toContain(recipe!);
    }
    expect(rules(blockDoc({ type: "constructor" }))).toEqual(["sectioned-view-content-block-type"]);
  });

  it("holds columns to complete rows and statement emphasis to exactly three unadorned items", () => {
    for (const count of [1, 4, 5]) expect(rules(blockDoc({ type: "items", arrangement: "columns", items: Array.from({ length: count }, (_, i) => item(`f${i}`)) }))).toContain("sectioned-view-content-count");
    expect(rules(blockDoc({ type: "items", recipe: "statement", items: [item("a"), item("b"), item("c")] }))).toEqual([]);
    expect(rules(blockDoc({ type: "items", recipe: "statement", items: [item("a", { icon: "globe" }), item("b"), item("c")] }))).toContain("recipe-slot");
    expect(rules(blockDoc({ type: "items", recipe: "features", columns: 2, treatment: "rule", items: [item("a", { icon: "globe" }), item("b")] }))).toEqual([]);
    expect(rules(blockDoc({ type: "items", arrangement: "columns", columns: 4, items: [item("a"), item("b")] }))).toContain("sectioned-view-content-columns");
  });

  it("holds card spans to whole rows: two-thirds + third, three thirds, two halves, or one full card", () => {
    const cards = (...spans: string[]) => blockDoc({ type: "items", arrangement: "bento", items: spans.map((span, index) => ({ ...item(`c${index}`), span })) });
    expect(rules(cards("third", "two-thirds"))).toEqual([]);
    expect(rules(cards("half", "half", "full"))).toEqual([]);
    expect(rules(cards("half", "third", "third"))).toEqual(["sectioned-view-content-card-spans"]);
    expect(rules(cards("third", "third"))).toEqual(["sectioned-view-content-card-spans"]);
    expect(rules(cards("full"))).toEqual(["sectioned-view-content-count"]);
    expect(rules(cards("third", "third", "third", "third", "third", "third", "half", "half"))).toEqual(["sectioned-view-content-count"]);
    expect(rules(cards("third", "wide" as never, "third"))).toEqual(["sectioned-view-content-card-spans"]);
  });

  it("holds a card's visual to one part of at most 5 rows", () => {
    expect(rules(blockDoc({ type: "items", arrangement: "bento", items: [{ ...item("a"), span: "half", visual: fieldsPart("v", 6) }, { ...item("b"), span: "half" }] }))).toEqual(["sectioned-view-content-count"]);
  });

  it("holds matrix sides to exactly one shared form and equal point counts", () => {
    const side = (id: string, extra: Record<string, unknown>) => ({ id, label: ref("acme.side.label"), heading: ref("acme.side.heading"), ...extra });
    const points = (count: number) => Array.from({ length: count }, (_, index) => ref(`acme.point.${index}`));
    const matrix = (before: Record<string, unknown>, after: Record<string, unknown>) => blockDoc({ type: "matrix", sides: [side("before", before), side("after", after)] });
    expect(rules(matrix({ description: ref("acme.d") }, { description: ref("acme.d") }))).toContain("sectioned-view-content-matrix-form");
    expect(rules(matrix({ visual: panelB }, { visual: panelC }))).toEqual([]);
    expect(rules(matrix({ description: ref("acme.d") }, { points: points(2) }))).toContain("sectioned-view-content-matrix-form");
    expect(rules(matrix({ points: points(2) }, { points: points(3) }))).toContain("sectioned-view-content-matrix-form");
    expect(rules(matrix({ points: points(5) }, { points: points(5) }))).toEqual(["sectioned-view-content-count", "sectioned-view-content-count"]);
    expect(rules(matrix({ description: ref("acme.d"), visual: panelB }, { description: ref("acme.d") }))).toContain("sectioned-view-content-matrix-form");
    expect(rules(matrix({}, { description: ref("acme.d") }))).toContain("sectioned-view-content-matrix-form");
  });

  it("holds rows, connected sequences and disclosures to canonical count bounds", () => {
    const rows = (count: number, columns = 1) => blockDoc({ type: "items", arrangement: "rows", columns, items: Array.from({ length: count }, (_, index) => item(`t${index}`)) });
    expect(rules(rows(3, 2))).toContain("sectioned-view-content-count"); expect(rules(rows(3))).toEqual([]); expect(rules(rows(9))).toContain("sectioned-view-content-count");
    expect(rules(blockDoc({ ...stepsBlock, items: stepsBlock.type === "items" ? stepsBlock.items.slice(0, 2) : [] }))).toContain("sectioned-view-content-count");
    expect(rules(blockDoc({ ...faqBlock, items: faqBlock.type === "items" ? faqBlock.items.slice(0, 3) : [] }))).toContain("sectioned-view-content-count");
  });

  it("refuses retired multi-panel arrangements and accepts exactly one panel", () => {
    expect(rules(docWith(section("a", { media: specimen(panelB) })))).toEqual([]);
    for (const media of [{ type: "specimen", label: ref("acme.specimen.label"), panels: [panelB, panelC], arrangement: "row" }, { ...specimen(panelB), connector: ref("acme.connector") }, { ...specimen(panelB), panel: [panelB] }]) expect(rules(docWith(section("a", { media: media as never })))).not.toEqual([]);
    expect(rules(docWith(section("a", { media: { ...specimen(panelB), type: "video" as never } })))).toEqual(["sectioned-view-content-media-type"]);
  });

  it("holds a panel to 1-3 parts and a footer to an assignee, a note, or both", () => {
    const panel = (extra: Record<string, unknown>) => docWith(section("a", { media: specimen({ ...panelB, ...extra } as SectionedViewSpecimenPanel) }));
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
    expect(rules(meter({ direction: "up" }))).toEqual(["sectioned-view-specimen-part-option"]);
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

describe("content-section — actions and footnote", () => {
  const action = (id: string, extra: Record<string, unknown> = {}) => ({ id, label: ref(`acme.action.${id}`), href: `/${id}`, ...extra });
  const footnote = (extra: Record<string, unknown> = {}) => ({ text: ref("acme.note.text"), link: { label: ref("acme.note.link"), href: "/guide" }, ...extra });

  it("accepts one or two actions with at most one primary, and a footnote with or without its one link", () => {
    expect(rules(docWith(section("a", { actions: [action("one")] })))).toEqual([]);
    expect(rules(docWith(section("a", { actions: [action("one", { emphasis: "primary" }), action("two", { emphasis: "secondary" })] })))).toEqual([]);
    expect(rules(docWith(section("a", { actions: [action("one", { emphasis: "secondary" }), action("two")] })))).toEqual([]);
    expect(rules(docWith(section("a", { footnote: footnote() })))).toEqual([]);
    expect(rules(docWith(section("a", { footnote: { text: ref("acme.note.text") } })))).toEqual([]);
  });

  it("refuses a third action, a second primary, and an unknown emphasis", () => {
    expect(rules(docWith(section("a", { actions: [action("one"), action("two"), action("three")] })))).toEqual(["sectioned-view-content-actions-count"]);
    expect(rules(docWith(section("a", { actions: [action("one", { emphasis: "primary" }), action("two", { emphasis: "primary" })] })))).toEqual(["sectioned-view-content-primary-count"]);
    expect(rules(docWith(section("a", { actions: [action("one", { emphasis: "tertiary" })] })))).toEqual([]);
    expect(rules(docWith(section("a", { actions: [action("one", { emphasis: "link" })] })))).toEqual(["sectioned-view-content-action-emphasis"]);
    expect(rules(docWith(section("a", { actions: [action("one", { style: "link" })] })))).toEqual(["sectioned-view-action-shape"]);
  });

  it("accepts primary emphasis on hero actions", () => {
    expect(rules(docWith({ id: "welcome", kind: "hero", heading: ref("acme.hero.heading"), actions: [action("one", { emphasis: "primary" })] } as SectionedViewSection))).toEqual([]);
  });

  it("refuses a footnote that is not closed, has no visible field, holds more than one link, or links outside the sanctioned hrefs", () => {
    expect(rules(docWith(section("a", { footnote: "Already keep records elsewhere?" as never })))).toEqual(["sectioned-view-content-footnote-shape"]);
    expect(rules(docWith(section("a", { footnote: {} as never })))).toEqual(["sectioned-view-content-footnote-shape"]);
    expect(rules(docWith(section("a", { footnote: footnote({ links: [] }) as never })))).toEqual(["sectioned-view-content-footnote-shape"]);
    expect(rules(docWith(section("a", { footnote: footnote({ link: [{ label: ref("acme.note.link"), href: "/guide" }] }) as never })))).toEqual(["sectioned-view-content-footnote-shape"]);
    expect(rules(docWith(section("a", { footnote: footnote({ link: { label: ref("acme.note.link") } }) as never })))).toEqual(["sectioned-view-content-footnote-shape"]);
    expect(rules(docWith(section("a", { footnote: footnote({ link: { label: ref("acme.note.link"), href: "javascript:alert(1)" } }) })))).toEqual(["sectioned-view-content-footnote-href"]);
    expect(rules(docWith(section("a", { footnote: { text: "plain" as never } })))).toEqual(["sectioned-view-copy-ref-shape"]);
  });

  it("resolves emphasis unchanged and the footnote after the media, text before the link label", () => {
    const doc = docWith(
      section("closing", {
        description: ref("acme.closing.description"),
        actions: [action("start", { emphasis: "primary" }), action("faq")],
        layout: "split-end",
        media: specimen(panelB),
        footnote: footnote(),
      }),
    );
    const resolved = resolveSectionedViewDocument(doc, createCopyResolver(registryFor(copyIds)));
    const closing = resolved.sections[0] as ResolvedSectionedViewContentSection;
    expect(closing.actions).toEqual([
      { id: "start", label: "Text for acme.action.start", href: "/start", emphasis: "primary" },
      { id: "faq", label: "Text for acme.action.faq", href: "/faq" },
    ]);
    expect(closing.footnote).toEqual({ text: "Text for acme.note.text", link: { label: "Text for acme.note.link", href: "/guide" } });
    const ids = resolved.resolutions.map((resolution) => resolution.ref.id);
    expect(ids.slice(-2)).toEqual(["acme.note.text", "acme.note.link"]);
    expect(ids.indexOf("acme.specimen.label")).toBeLessThan(ids.indexOf("acme.note.text"));
    expect(Object.hasOwn(resolveSectionedViewDocument(docWith(section("bare")), createCopyResolver(registryFor(copyIds))).sections[0]!, "footnote")).toBe(false);
  });
});

describe("content-section — the stacked-action rule and card links", () => {
  const action = (id: string, extra: Record<string, unknown> = {}) => ({ id, label: ref(`acme.action.${id}`), href: `/${id}`, ...extra });
  const footnote = () => ({ text: ref("acme.note.text"), link: { label: ref("acme.note.link"), href: "/guide" } });
  const linked = (block: SectionedViewContentBlock, hrefs: readonly (string | undefined)[]): SectionedViewContentBlock =>
    ({ ...block, items: (block as { items: Record<string, unknown>[] }).items.map((entry, index) => (hrefs[index] === undefined ? entry : { ...entry, href: hrefs[index] })) }) as SectionedViewContentBlock;
  const topics = (count: number): SectionedViewContentBlock => ({ type: "items", arrangement: "rows", columns: 2, items: Array.from({ length: count }, (_, index) => item(`t${index}`)) });

  it("refuses actions on a stacked band whose intro is followed by a block or media", () => {
    expect(rules(docWith(section("a", { actions: [action("one")], block: topicsBlock })))).toEqual(["sectioned-view-content-stacked-actions"]);
    expect(rules(docWith(section("a", { actions: [action("one")], block: featuresBlock })))).toEqual(["sectioned-view-content-stacked-actions"]);
    expect(rules(docWith(section("a", { actions: [action("one")], media: specimen(panelB) })))).toEqual(["sectioned-view-content-stacked-actions"]);
    expect(rules(docWith(section("a", { layout: "stacked", actions: [action("one")], block: stepsBlock, media: specimen(panelB) })))).toEqual(["sectioned-view-content-stacked-actions"]);
    const message = validateSectionedViewDocument(docWith(section("a", { actions: [action("one")], block: topicsBlock })))[0]?.message ?? "";
    expect(message).toContain("Link the cards themselves (item `href`), or put one link in the footnote.");
  });

  it("keeps actions on a header-only band and in a split's text column", () => {
    expect(rules(docWith(section("a", { actions: [action("one", { emphasis: "primary" }), action("two")] })))).toEqual([]);
    expect(rules(docWith(section("a", { layout: "split-end", actions: [action("one")], media: specimen(panelB) })))).toEqual([]);
    expect(rules(docWith(section("a", { layout: "split-end", actions: [action("one")], block: topicsBlock })))).toEqual([]);
    expect(rules(docWith(section("a", { layout: "split-end", actions: [action("one")], block: topicsBlock, media: specimen(panelB), footnote: footnote() })))).toEqual([]);
    expect(rules(docWith(section("a", { block: topicsBlock, footnote: footnote() })))).toEqual([]);
  });

  it("refuses a footnote after the actions of a header-only band: nothing follows an action", () => {
    expect(rules(docWith(section("a", { actions: [action("one", { emphasis: "primary" })], footnote: footnote() })))).toEqual(["sectioned-view-content-actions-footnote"]);
    expect(rules(docWith(section("a", { footnote: footnote() })))).toEqual([]);
  });

  it("accepts href on every item of a feature-grid, card-grid, topic-list or ordered-step-sequence", () => {
    expect(rules(blockDoc(linked(featuresBlock, ["/one", "/two", "/three"])))).toEqual([]);
    expect(rules(blockDoc(linked({ ...featuresBlock, columns: 2, treatment: "rule", items: [item("a"), item("b")] } as SectionedViewContentBlock, ["/one", "#two"])))).toEqual([]);
    expect(rules(blockDoc(linked(cardsBlock, ["/a", "/b", "/c", "/d", "https://example.com/e"])))).toEqual([]);
    expect(rules(blockDoc(linked(topicsBlock, ["/a", "/b", "/c", "mailto:team@example.com"])))).toEqual([]);
    expect(rules(blockDoc(linked(stepsBlock, ["/one", "/two", "/three"])))).toEqual([]);
  });

  it("refuses an href outside the sanctioned forms", () => {
    expect(rules(blockDoc(linked(topicsBlock, ["/a", "/b", "/c", "javascript:alert(1)"])))).toEqual(["sectioned-view-content-item-href"]);
    expect(rules(blockDoc(linked(stepsBlock, ["/one", "//elsewhere.example/two", "/three"])))).toEqual(["sectioned-view-content-item-href"]);
    expect(rules(blockDoc(linked(cardsBlock, ["/a", "/b", "/c", "/d", 5 as never])))).toEqual(["sectioned-view-content-item-href"]);
  });

  it("refuses a block that links some items and not others", () => {
    expect(rules(blockDoc(linked(featuresBlock, ["/one", "/two"])))).toEqual(["sectioned-view-content-link-partial"]);
    expect(rules(blockDoc(linked(cardsBlock, ["/a"])))).toEqual(["sectioned-view-content-link-partial"]);
    expect(rules(blockDoc(linked(stepsBlock, [undefined, "/two", "/three"])))).toEqual(["sectioned-view-content-link-partial"]);
  });

  it("refuses more than six linked items in one block, and accepts six", () => {
    const hrefs = (count: number) => Array.from({ length: count }, (_, index) => `/topic-${index}`);
    expect(rules(blockDoc(linked(topics(6), hrefs(6))))).toEqual([]);
    expect(rules(blockDoc(linked(topics(8), hrefs(8))))).toEqual(["sectioned-view-content-link-count"]);
    expect(rules(blockDoc(topics(8)))).toEqual([]);
  });

  it("refuses one destination linked twice, comparing without the fragment and the trailing slash", () => {
    expect(rules(blockDoc(linked(topicsBlock, ["/a", "/b", "/c", "/a"])))).toEqual(["sectioned-view-content-link-duplicate"]);
    expect(rules(blockDoc(linked(topicsBlock, ["/a", "/b/", "/c", "/b"])))).toEqual(["sectioned-view-content-link-duplicate"]);
    expect(rules(blockDoc(linked(topicsBlock, ["/a#one", "/b", "/c", "/a#two"])))).toEqual(["sectioned-view-content-link-duplicate"]);
    expect(rules(blockDoc(linked(topicsBlock, ["#a", "#b", "/", "/c"])))).toEqual([]);
    expect(rules(blockDoc(linked(stepsBlock, ["/product", "/product", "/product"])))).toEqual(["sectioned-view-content-link-duplicate"]);
  });

  it("refuses links on statements, matrix sides and the FAQ recipe", () => {
    const statement = { type: "items", recipe: "statement", items: [item("a"), item("b"), item("c")] } as SectionedViewContentBlock;
    const statementFindings = validateSectionedViewDocument(blockDoc(linked(statement, ["/a", "/b", "/c"])));
    expect(statementFindings.filter((entry) => entry.rule === "sectioned-view-content-link-statement").map((entry) => entry.path)).toEqual([0, 1, 2].map((index) => `sections.0.block.items.${index}.href`));
    const matrix = comparisonBlock as { type: "matrix"; sides: Record<string, unknown>[] };
    expect(rules(blockDoc({ ...matrix, sides: [{ ...matrix.sides[0], href: "/a" }, matrix.sides[1]] }))).toContain("sectioned-view-item-shape");
    const faqFindings = validateSectionedViewDocument(blockDoc({ ...faqBlock, recipe: "faq", treatment: "rule", items: (faqBlock as { items: Record<string, unknown>[] }).items.map((row, index) => ({ ...row, href: `/q${index}` })) }));
    expect(faqFindings.filter((entry) => entry.rule === "recipe-slot").map((entry) => entry.path)).toEqual([0, 1, 2, 3].map((index) => `sections.0.block.items.${index}.href`));
  });

  it("resolves href unchanged on items, cards and steps, and leaves it absent when unset", () => {
    const doc = docWith(
      section("topics", { block: linked(topicsBlock, ["/a", "/b", "/c", "/d"]) }),
      section("cards", { block: linked(cardsBlock, ["/a", "/b", "/c", "/d", "/e"]) }),
      section("steps", { block: linked(stepsBlock, ["/one", "/two", "/three"]) }),
      section("plain", { block: topicsBlock }),
    );
    const resolver = createCopyResolver(registryFor(copyIds));
    const resolved = resolveSectionedViewDocument(doc, resolver).sections as ResolvedSectionedViewContentSection[];
    const hrefs = (index: number) => ((resolved[index]!.block as { items: { href?: string }[] }).items).map((entry) => entry.href);
    expect(hrefs(0)).toEqual(["/a", "/b", "/c", "/d"]);
    expect(hrefs(1)).toEqual(["/a", "/b", "/c", "/d", "/e"]);
    expect(hrefs(2)).toEqual(["/one", "/two", "/three"]);
    expect((resolved[3]!.block as { items: object[] }).items.every((entry) => !Object.hasOwn(entry, "href"))).toBe(true);
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
    expect(evidence.layout).toBe("split-start");
    const media = evidence.media!;
    expect(media.label).toBe("A sample panel showing its labeled parts");
    const meter = media.panel.parts[2]!;
    expect(meter).toEqual({ id: "ratio", type: "meter", label: "Text for acme.ratio.label", value: 3.4, scaleMax: 5, limit: 3, direction: "max", tone: "danger", valueText: "Text for acme.ratio.value", limitText: "Text for acme.ratio.limit", status: { tone: "danger", label: "Text for acme.status.outside" }, note: "Text for acme.ratio.note" });
    expect(((resolved.sections[7] as ResolvedSectionedViewContentSection).block as { items: { visual: unknown }[] }).items[0]!.visual).toEqual({ id: "matrix", type: "table", caption: "Text for acme.matrix.caption", columns: [{ id: "name", label: "Text for acme.matrix.col.name" }, { id: "state", label: "Text for acme.matrix.col.state" }], rows: [{ id: "q1", cells: [{ text: "Text for acme.matrix.q1.name" }, { status: { tone: "info", label: "Text for acme.status.received" } }] }] });
    expect(media.panel.footer).toEqual({ assignee: { initials: "Text for acme.assignee.initials", name: "Text for acme.assignee.name", note: "Text for acme.assignee.note" }, note: "Text for acme.footer.note" });

    const principles = resolved.sections[2] as ResolvedSectionedViewContentSection;
    expect(Object.hasOwn(principles, "eyebrow")).toBe(false);
    expect(Object.hasOwn(principles, "media")).toBe(false);
    expect(principles.block).toEqual({
      type: "items", arrangement: "columns",
      columns: 3,
      treatment: "plate",
      order: "none", reveal: "all", scale: "item",
      items: [
        { id: "a", icon: "landmark", heading: "Text for acme.item.a.heading", description: "Text for acme.item.a.description" },
        { id: "b", icon: "scale", heading: "Text for acme.item.b.heading", description: "Text for acme.item.b.description" },
        { id: "c", heading: "Text for acme.item.c.heading", description: "Text for acme.item.c.description" },
      ],
    });
    const cards = (resolved.sections[3] as ResolvedSectionedViewContentSection).block;
    expect(cards?.type === "items" && cards.items[0]!.visual?.type).toBe("fields");
    expect(cards?.type === "items" && cards.items[0]!.eyebrow).toBe("Text for acme.item.wide.eyebrow");
    const intro = resolved.sections[6] as ResolvedSectionedViewContentSection;
    expect(intro.actions).toEqual([{ id: "more", label: "Text for acme.intro.more", href: "/more" }]);
    expect(Object.hasOwn(intro, "block")).toBe(false);
  });

  it("carries a feature-grid item's icon through resolution", () => {
    const resolved = resolveSectionedViewDocument(fullDocument, resolver);
    const legacy = resolved.sections[8]!;
    expect(legacy.kind === "feature-grid" && legacy.items[0]).toEqual({ id: "one", icon: "globe", heading: "Text for acme.legacy.one.heading", description: undefined });
  });

  it("records one resolution per CopyRef, in field order, ready for provenance", () => {
    const small = docWith(section("small", { eyebrow: ref("acme.small.eyebrow"), description: ref("acme.small.description"), block: { type: "items", arrangement: "rows", columns: 1, items: [item("x"), item("y")] } }));
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
      expect((error as Error).message).toContain("sections.1.media.panel.parts.2.valueText");
    }
  });

  it("resolves a feature-grid item eyebrow and holds it to the eyebrow budget", () => {
    expect(CONTENT_ITEM_EYEBROW_MAX_CHARACTERS).toBe(32);
    const features = (eyebrowId: string) => docWith(section("bounded", { block: { type: "items", arrangement: "columns", columns: 2, items: [item("ea", { eyebrow: ref(eyebrowId) }), item("eb")] } }));
    const short = features("acme.e.short");
    const resolved = resolveSectionedViewDocument(short, createCopyResolver(registryFor(copyIds)));
    const block = (resolved.sections[0] as ResolvedSectionedViewContentSection).block;
    expect(block?.type === "items" && block.items[0]!.eyebrow).toBe("Text for acme.e.short");
    expect(block?.type === "items" && Object.hasOwn(block.items[1]!, "eyebrow")).toBe(false);
    // "Text for " plus a 24-character id is 33 characters: one over.
    const long = features("acme.e.twenty-four-chars");
    try {
      resolveSectionedViewDocument(long, createCopyResolver(registryFor(copyIds)));
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(SectionedViewResolutionError);
      expect((error as SectionedViewResolutionError).reason).toBe("invalid-document");
      expect((error as Error).message).toContain("sections.0.block.items.0.eyebrow resolves to 33 characters");
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
    const findings = warnings(section("a", { block: topicsBlock }), section("b", { block: topicsBlock }));
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.every((entry) => entry.severity === "warning")).toBe(true);
  });

  it("leaves validation unchanged: a page with variety warnings still validates", () => {
    const repetitive = docWith(hero, section("a", { block: topicsBlock }), section("b", { block: topicsBlock }));
    expect(validateSectionedViewDocument(repetitive)).toEqual([]);
    expect(checkSectionVariety(repetitive).length).toBeGreaterThan(0);
  });

  it("warns when neighbouring bands share layout, block and visual", () => {
    expect(ruleList(section("a", { block: topicsBlock }), section("b", { block: { ...topicsBlock, columns: 1, items: topicsBlock.items.slice(0, 3) } as SectionedViewContentBlock }))).toEqual(["sectioned-view-variety-repeat"]);
    expect(ruleList(section("a"), section("b"))).toEqual(["sectioned-view-variety-repeat"]);
  });

  it("warns on a split after a split with the same side, and on three splits in a row", () => {
    const split = (id: string, side: "start" | "end", block: SectionedViewContentBlock) => section(id, { layout: side === "start" ? "split-start" : "split-end", block, media: specimen(panelB) });
    expect(ruleList(split("a", "end", topicsBlock), section("gap", { block: featuresBlock }), split("b", "end", faqBlock))).toEqual([]);
    expect(ruleList(split("a", "end", topicsBlock), split("b", "end", faqBlock))).toEqual(["sectioned-view-variety-split-side", "sectioned-view-variety-density"]);
    expect(ruleList(split("a", "end", topicsBlock), split("b", "start", faqBlock), split("c", "end", featuresBlock))).toEqual([
      "sectioned-view-variety-density",
      "sectioned-view-variety-split-run",
      "sectioned-view-variety-density",
    ]);
  });

  it("warns when a dense band follows a dense band", () => {
    expect(ruleList(section("a", { block: cardsBlock }), section("b", { block: stepsBlock }))).toEqual(["sectioned-view-variety-density"]);
    expect(ruleList(section("a", { block: cardsBlock }), section("b", { block: faqBlock }), section("c", { block: stepsBlock }))).toEqual([]);
  });

  it("warns on a specimen on an inverse ground and on a second inverse body band", () => {
    expect(ruleList(section("a", { ground: "inverse", media: specimen(panelB) }))).toEqual(["sectioned-view-variety-specimen-ground"]);
    expect(ruleList(section("a", { ground: "inverse" }), section("b", { block: faqBlock }), section("c", { ground: "inverse", block: topicsBlock }))).toEqual(["sectioned-view-variety-inverse-bands"]);
    expect(checkSectionVariety(docWith({ ...hero, ground: "inverse" }, section("a", { ground: "inverse" }))).map((entry) => entry.rule)).toEqual([]);
  });

  it("warns on a second band of four or more cards and on a second comparison", () => {
    expect(ruleList(section("a", { block: cardsBlock }), section("gap", { block: faqBlock }), section("b", { block: cardsBlock }))).toEqual(["sectioned-view-variety-card-bands", "sectioned-view-variety-treatment"]);
    const plainComparison: SectionedViewContentBlock = { type: "matrix", sides: [{ id: "before", label: ref("acme.b"), heading: ref("acme.b.heading"), description: ref("acme.d") }, { id: "after", label: ref("acme.a"), heading: ref("acme.a.heading"), description: ref("acme.d") }] };
    expect(ruleList(section("a", { block: plainComparison }), section("gap", { block: faqBlock }), section("b", { block: plainComparison }))).toEqual(["sectioned-view-variety-comparison-count"]);
  });

  it("warns when one block type repeats with the same treatment, not with a different one", () => {
    const rule: SectionedViewContentBlock = { ...featuresBlock, treatment: "rule", items: featuresBlock.type === "items" ? featuresBlock.items.map(({ icon: _icon, ...rest }) => rest) : [] };
    expect(ruleList(section("a", { block: featuresBlock }), section("gap", { block: faqBlock }), section("b", { block: rule }))).toEqual([]);
    expect(ruleList(section("a", { block: featuresBlock }), section("gap", { block: faqBlock }), section("b", { block: featuresBlock }))).toEqual(["sectioned-view-variety-treatment"]);
  });

  it("reads a text-only split as a split without a visual, and a split legacy FAQ as a split on the end side", () => {
    const textSplit = section("t", { layout: "split-end", block: topicsBlock });
    // Not dense (no specimen), so it may sit beside a dense band; still a split for the side rules.
    expect(ruleList(section("a", { block: cardsBlock }), textSplit)).toEqual([]);
    const faqSplit: SectionedViewSection = { id: "q", kind: "faq", layout: "split", heading: ref("acme.q.heading"), items: (faqBlock as { items: { id: string; heading: CopyRef; description: CopyRef }[] }).items.map((entry) => ({ id: entry.id, question: entry.heading, answer: entry.description })) };
    expect(ruleList(textSplit, faqSplit)).toEqual(["sectioned-view-variety-split-side"]);
    expect(ruleList(section("t2", { layout: "split-start", block: topicsBlock }), faqSplit)).toEqual([]);
    const stackedFaq: SectionedViewSection = { ...faqSplit, layout: "stacked" };
    expect(ruleList(textSplit, stackedFaq)).toEqual([]);
    expect(ruleList(section("a", { layout: "split-end", media: specimen(panelB) }), section("b", { layout: "split-start", block: topicsBlock }), faqSplit)).toEqual(["sectioned-view-variety-split-run"]);
  });

  it("warns on a second band holding a primary action, not on secondary-only bands", () => {
    const withActions = (id: string, emphasis?: "primary" | "secondary") => section(id, { actions: [{ id: "go", label: ref("acme.go"), href: "/go", ...(emphasis === undefined ? {} : { emphasis }) }] });
    // Actions sit on header-only bands and in split text columns: a stacked band with a block takes none.
    const textSplit = { layout: "split-end", block: topicsBlock } as const;
    const mediaSplit = { layout: "split-start", block: featuresBlock, media: specimen(panelB) } as const;
    expect(ruleList({ ...withActions("a", "primary"), ...textSplit }, withActions("b"), { ...withActions("c", "secondary"), ...mediaSplit })).toEqual([]);
    expect(ruleList({ ...withActions("a", "primary"), ...textSplit }, withActions("b", "primary"))).toEqual(["sectioned-view-variety-primary-actions"]);
    expect(warnings({ ...withActions("a", "primary"), ...textSplit }, withActions("b", "primary"))[0]!.path).toBe("sections.2");
    expect(validateSectionedViewDocument(docWith(hero, { ...withActions("a", "primary"), ...textSplit }, withActions("b"), { ...withActions("c", "secondary"), ...mediaSplit }))).toEqual([]);
  });

  it("warns on a split whose block links its items and that also carries actions", () => {
    const linkedTopics = { ...topicsBlock, items: (topicsBlock as { items: Record<string, unknown>[] }).items.map((entry, index) => ({ ...entry, href: `/topic-${index}` })) } as SectionedViewContentBlock;
    const action = [{ id: "go", label: ref("acme.go"), href: "/go" }];
    expect(ruleList(section("a", { layout: "split-end", block: linkedTopics, actions: action }))).toEqual(["sectioned-view-variety-link-competing"]);
    expect(ruleList(section("a", { layout: "split-end", block: linkedTopics }))).toEqual([]);
    expect(ruleList(section("a", { layout: "split-end", block: topicsBlock, actions: action }))).toEqual([]);
    expect(ruleList(section("a", { block: linkedTopics }))).toEqual([]);
  });

  it("reads several documents as one page and names each finding's document", () => {
    const first = docWith(hero, section("a", { block: topicsBlock }));
    const second: SectionedViewDocument = { id: "acme-two", sectionGroundRhythm: "view", sections: [section("b", { block: topicsBlock })] };
    const findings = checkSectionVariety([first, second]);
    expect(findings.map((entry) => [entry.rule, entry.path])).toEqual([
      ["sectioned-view-variety-repeat", "documents.1.sections.0"],
      ["sectioned-view-variety-treatment", "documents.1.sections.0"],
    ]);
  });
});


it("validates closed hero emphases and effective primary constraints", () => {
  const action = (id: string, emphasis?: string) => ({ id, label: ref("acme.action"), href: "/start", ...(emphasis === undefined ? {} : { emphasis }) });
  const page = (actions: unknown[]) => docWith({ id: "hero", kind: "hero", heading: ref("acme.heading"), actions } as SectionedViewSection);
  for (const second of ["secondary", "quiet"]) expect(rules(page([action("first"), action("second", second)]))).toEqual([]);
  expect(rules(page([action("first", "quiet"), action("second", "primary")]))).toEqual([]);
  for (const emphasis of ["secondary", "quiet", "tertiary", "link"]) expect(rules(page([action("first", emphasis)])).length).toBeGreaterThan(0);
  expect(rules(page([action("first"), action("second", "primary")]))).toContain("sectioned-view-hero-primary-count");
  expect(rules(page([action("first"), action("second"), action("third")]))).toContain("sectioned-view-hero-actions-count");
});
