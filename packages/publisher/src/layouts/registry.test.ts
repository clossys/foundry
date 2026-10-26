import { describe, expect, it } from "vitest";
import {
  ARRANGEMENT_MODELS, LAYOUT_CONFIG_ID, LAYOUT_ID, LAYOUT_IDS, LAYOUT_IA, LAYOUT_LEAVES,
  RETIRED_LAYOUTS, checkLayoutRegistry, getEffectiveLayoutContract, getLayoutLeaf, isLayoutId,
} from "./index.js";
import type { LayoutConfig, LayoutLeaf, LayoutIA } from "./index.js";

// An injected registry fixture: acceptance is validated against permanent leaf IDs,
// independently of mutable section IA grouping.
const sectionLeaves = `band section-header pagination hero page-header content article features
  testimonials logo-cloud people media gallery faq steps timeline call-to-action cards resource-list
  task-list comparison pricing stats status-list usage data-table data-grid record-detail activity-feed
  audit-log form newsletter wizard settings column-mapper access-matrix chat link-index table-of-contents
  explorer filter-builder empty-state error-state notices`.split(/\s+/).map((id) => `sections.${id}`);
const copy = () => structuredClone(LAYOUT_LEAVES) as LayoutLeaf[];
function withConfig(config: LayoutConfig): LayoutLeaf[] {
  const rows = copy();
  rows[0] = { ...rows[0]!, contract: { ...rows[0]!.contract, configs: [config] } };
  return rows;
}
const issues = (registry: readonly LayoutLeaf[]) => checkLayoutRegistry(sectionLeaves, registry, LAYOUT_IA, {});

describe("page layout registry", () => {
  it("registers exactly five leaves, four available and staggered-grid held, and nine configs", () => {
    expect(sectionLeaves).toHaveLength(44);
    expect(LAYOUT_LEAVES.map((leaf) => leaf.id)).toEqual(LAYOUT_IDS);
    expect(LAYOUT_LEAVES.filter((leaf) => leaf.status !== "held")).toHaveLength(4);
    expect(getLayoutLeaf("layouts.staggered-grid")?.status).toBe("held");
    expect(LAYOUT_LEAVES.flatMap((leaf) => leaf.contract.configs).map((config) => config.id)).toEqual([
      "stack.landing", "stack.document", "stack.focus", "stack.index", "stack.workspace", "split.default", "sidebar-content.record", "sidebar-content.docs", "bento.default",
    ]);
    expect(checkLayoutRegistry(sectionLeaves)).toEqual([]);
  });
  it("refuses promotion of the held layout in a caller registry", () => {
    const rows = copy();
    const index = rows.findIndex(leaf => leaf.id === "layouts.staggered-grid");
    rows[index] = { ...rows[index]!, status: "draft" };
    expect(issues(rows)).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "contract", subject: "layouts.staggered-grid", message: "staggered-grid is held" }),
    ]));
    expect(() => getEffectiveLayoutContract("layouts.staggered-grid")).toThrow();
  });
  it("workspace keeps inherited body bounds and existing defaults while closing page chrome slots", () => {
    const original = getLayoutLeaf("layouts.stack")!;
    const baseBody = original.contract.slots.find(slot => slot.id === "body")!;
    const workspace = getEffectiveLayoutContract(original, "stack.workspace");
    const body = workspace.slots.find(slot => slot.id === "body")!;
    expect({ min: body.min, max: body.max }).toEqual({ min: baseBody.min, max: baseBody.max });
    expect(workspace.slots.find(slot => slot.id === "lead")?.max).toBe(0);
    expect(workspace.slots.find(slot => slot.id === "close")?.max).toBe(0);
    expect(body.accepts).not.toContain("sections.page-header");
    expect(body.accepts).not.toContain("sections.content");
    expect(getEffectiveLayoutContract(original).memberValues).toEqual({});
    expect(getEffectiveLayoutContract(original, "stack.focus").slots.find(slot => slot.id === "body")?.max).toBe(1);
  });
  it("uses closed permanent layout ids and closed config segments", () => {
    for (const id of LAYOUT_IDS) expect(LAYOUT_ID.test(id)).toBe(true);
    for (const leaf of LAYOUT_LEAVES) for (const config of leaf.contract.configs) expect(LAYOUT_CONFIG_ID.test(config.id)).toBe(true);
    for (const id of ["layouts.future", "layouts.page.stack", "layouts.Stack", "layouts.stack_", "layouts.stack\n", "sections.hero", "layouts.stаck"]) {
      expect(isLayoutId(id)).toBe(false);
      expect(getLayoutLeaf(id)).toBeUndefined();
    }
  });
  it("keeps the four arrangement models with only page populated", () => {
    expect(ARRANGEMENT_MODELS).toEqual(["page", "canvas", "paged", "panes"]);
    expect(LAYOUT_IA.nodes.map((node) => node.id)).toEqual(ARRANGEMENT_MODELS);
    expect(LAYOUT_IA.nodes[0]).toEqual({
      id: "page", label: "Page", children: [
        { id: "flow", label: "Flow", leaves: ["layouts.stack"] },
        { id: "columns", label: "Partition", leaves: ["layouts.split", "layouts.sidebar-content"] },
        { id: "grid", label: "Tiling", leaves: ["layouts.bento", "layouts.staggered-grid"] },
      ],
    });
    expect(LAYOUT_IA.nodes.slice(1).every((node) => node.children.length === 0)).toBe(true);
    expect(LAYOUT_IA.nodes.flatMap((node) => node.children.flatMap((group) => group.leaves))).toEqual(LAYOUT_IDS);
  });
  it("rejects unknown sections and section parts even when present in the section registry", () => {
    const rows = copy();
    rows[0] = { ...rows[0]!, contract: { ...rows[0]!.contract, slots: rows[0]!.contract.slots.map((slot) => slot.id === "lead" ? { ...slot, accepts: ["sections.unknown"] } : slot) } };
    expect(issues(rows)).toEqual(expect.arrayContaining([expect.objectContaining({ code: "section", message: expect.stringContaining("sections.unknown") })]));
    expect(checkLayoutRegistry(sectionLeaves.filter((id) => id !== "sections.hero"))).toEqual(expect.arrayContaining([expect.objectContaining({ code: "section" })]));
    for (const part of ["sections.band", "sections.section-header", "sections.pagination"] as const) {
      rows[0] = { ...rows[0]!, contract: { ...rows[0]!.contract, slots: rows[0]!.contract.slots.map((slot) => slot.id === "lead" ? { ...slot, accepts: [part] } : slot) } };
      expect(issues(rows).some((finding) => finding.code === "section")).toBe(true);
    }
  });
  it("rejects config acceptance widening, count widening and unknown slots", () => {
    const overrides: NonNullable<LayoutConfig["slotOverrides"]>[] = [
      { lead: { accepts: ["sections.hero", "sections.form"] } },
      { lead: { accepts: ["sections.future"] } },
      { body: { min: 0 } }, { lead: { max: 2 } }, { body: { min: 5, max: 2 } },
      { body: { min: 1.5 } }, { body: { accepts: [] } }, { missing: { max: 1 } },
    ];
    for (const slotOverrides of overrides) {
      const rows = withConfig({ id: "stack.test", members: {}, slotOverrides });
      expect(issues(rows).some((finding) => finding.code === "config")).toBe(true);
      expect(() => getEffectiveLayoutContract(rows[0]!, "stack.test")).toThrow("Invalid layout config");
    }
    const valid = withConfig({ id: "stack.test", members: { measure: "prose" }, slotOverrides: { body: { accepts: ["sections.article"], min: 2, max: 4 } } });
    expect(issues(valid)).toEqual([]);
  });
  it("resolves registered config overrides without mutating the leaf", () => {
    const document = getEffectiveLayoutContract("layouts.stack", "stack.document");
    expect(document.memberValues.measure).toBe("prose");
    expect(document.slots.find((slot) => slot.id === "body")?.accepts).toEqual(["sections.article"]);
    const landing = getEffectiveLayoutContract("layouts.stack", "stack.landing");
    expect(landing.slots[0]).toMatchObject({ id: "lead", min: 1, max: 1, accepts: ["sections.hero"] });
    for (const config of ["stack.focus", "stack.index"]) expect(getEffectiveLayoutContract("layouts.stack", config).slots[1]?.max).toBe(1);
    expect(getEffectiveLayoutContract("layouts.sidebar-content", "sidebar-content.docs").slots[2]?.accepts).toEqual(["sections.table-of-contents"]);
    expect(getEffectiveLayoutContract("layouts.sidebar-content", "sidebar-content.record").reflow).toEqual([{ at: "tokens.breakpoint.tablet", columns: 2 }]);
    expect(getEffectiveLayoutContract("layouts.sidebar-content").reflow).toEqual([{ at: "tokens.breakpoint.tablet-lg", columns: 2 }]);
    expect(getLayoutLeaf("layouts.stack")?.contract.slots[0]?.min).toBe(0);
    expect(Object.isFrozen(document.slots)).toBe(true);
  });
  it("resolves explicit split and bento default configs without altering their contracts", () => {
    for (const id of ["layouts.split", "layouts.bento"] as const) {
      const leaf = getLayoutLeaf(id)!;
      const config = `${id.slice("layouts.".length)}.default`;
      expect(leaf.contract.configs).toEqual([{ id: config, members: {} }]);
      expect(getEffectiveLayoutContract(id, config)).toEqual({ ...leaf.contract, memberValues: {} });
      expect(() => getEffectiveLayoutContract(id, "default")).toThrow("Unknown layout config");
    }
  });
  it("refuses held, unknown, foreign config and open member values", () => {
    for (const id of ["layouts.staggered-grid", "layouts.future"]) expect(() => getEffectiveLayoutContract(id)).toThrow();
    for (const id of ["stack.missing", "sidebar-content.docs", ""]) expect(() => getEffectiveLayoutContract("layouts.stack", id)).toThrow("Unknown layout config");
    expect(() => getEffectiveLayoutContract("layouts.stack", undefined, { measure: "unlimited" })).toThrow("Unknown layout member");
    expect(() => getEffectiveLayoutContract("layouts.stack", undefined, { invented: "start" })).toThrow("Unknown layout member");
    expect(() => getEffectiveLayoutContract("layouts.stack", "stack.focus", { measure: "wide" })).toThrow("conflicts with config");
    expect(getEffectiveLayoutContract("layouts.split", undefined, { collapse: "end-first" }).memberValues).toEqual({ collapse: "end-first" });
  });
  it("pins acceptance, count, shape and adaptive tile semantics", () => {
    const stack = getLayoutLeaf("layouts.stack")!.contract;
    expect(stack.slots.map(({ id, min, max, position }) => ({ id, min, max, position }))).toEqual([
      { id: "lead", min: 0, max: 1, position: "first" }, { id: "body", min: 1, max: 24, position: "any" }, { id: "close", min: 0, max: 1, position: "last" },
    ]);
    expect(stack.slots[1]?.accepts).toHaveLength(40);
    expect(stack.slots[1]?.accepts).not.toContain("sections.table-of-contents");
    expect(getLayoutLeaf("layouts.bento")!.contract).toMatchObject({ requiresSection: { container: "adaptive" }, slots: [{ id: "lead" }, { id: "tiles", min: 3, max: 12, tile: { spans: ["1x1", "2x1", "1x2", "2x2"] } }] });
    expect(getLayoutLeaf("layouts.bento")!.contract.reflow.map((step) => step.columns)).toEqual([2, 3, 4]);
    expect(getLayoutLeaf("layouts.sidebar-content")!.contract.members.breakpoint).toEqual(["tablet", "tablet-lg"]);
  });
  it("rejects duplicate ids, invalid placement and unsafe contract metadata", () => {
    const duplicated = [...copy(), copy()[0]!];
    expect(issues(duplicated).some((finding) => finding.code === "id")).toBe(true);
    const tree = structuredClone(LAYOUT_IA) as LayoutIA;
    const badTree = { ...tree, nodes: tree.nodes.map((node) => node.id === "canvas" ? { ...node, children: [{ id: "flow", label: "Flow", leaves: ["layouts.stack" as const] }] } : node) };
    expect(checkLayoutRegistry(sectionLeaves, LAYOUT_LEAVES, badTree).some((finding) => finding.code === "ia")).toBe(true);
    const rows = copy();
    rows[1] = { ...rows[1]!, contract: { ...rows[1]!.contract, reflow: [{ at: "tokens.breakpoint.unknown" as never, columns: 2 }] } };
    expect(issues(rows).some((finding) => finding.code === "contract")).toBe(true);
  });
  it("requires exactly three placement levels and unique nonempty child groups", () => {
    const rejectsIA = (node: unknown) => {
      const tree = { ...LAYOUT_IA, nodes: [node, ...LAYOUT_IA.nodes.slice(1)] } as LayoutIA;
      expect(checkLayoutRegistry(sectionLeaves, LAYOUT_LEAVES, tree).some((finding) => finding.code === "ia")).toBe(true);
    };
    rejectsIA({ id: "page", label: "Page", leaves: LAYOUT_IDS });
    rejectsIA({ id: "page", label: "Page", children: [], leaves: LAYOUT_IDS });
    rejectsIA({ id: "page", label: "Page", children: [{ id: "flow", label: "Flow", children: [{ id: "nested", label: "Nested", leaves: LAYOUT_IDS }] }] });
    rejectsIA({ id: "page", label: "Page", children: [{ id: "flow", label: "Flow", leaves: LAYOUT_IDS, children: [] }] });
    rejectsIA({ id: "page", label: "Page", children: [{ id: "flow", label: "Flow", leaves: [] }] });
    rejectsIA({ id: "page", label: "Page", children: [{ id: "flow", label: "Flow", leaves: LAYOUT_IDS }, { id: "flow", label: "Flow", leaves: ["layouts.stack"] }] });
    rejectsIA({ id: "page", label: "Page", children: [{ id: "grid", label: "Grid", leaves: [...LAYOUT_IDS, "layouts.staggered-grid"] }] });
  });
  it("resolves retired view identifiers to active layouts and configs", () => {
    expect(RETIRED_LAYOUTS.LandingView).toEqual({ replacedBy: "layouts.stack", config: "stack.landing" });
    expect(RETIRED_LAYOUTS["DetailsView.main-aside"]).toEqual({ replacedBy: "layouts.sidebar-content", config: "sidebar-content.record" });
    for (const alias of Object.values(RETIRED_LAYOUTS)) expect(() => getEffectiveLayoutContract(alias.replacedBy, alias.config)).not.toThrow();
    expect(checkLayoutRegistry(sectionLeaves, LAYOUT_LEAVES, LAYOUT_IA, { Old: { replacedBy: "layouts.stack", config: "stack.unknown" } }).some((finding) => finding.code === "retired")).toBe(true);
  });
});
