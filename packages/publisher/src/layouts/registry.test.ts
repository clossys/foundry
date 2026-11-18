import { describe, expect, it } from "vitest";
import {
  ARRANGEMENT_MODELS, LAYOUT_CONFIG_ID, LAYOUT_ID, LAYOUT_IDS, LAYOUT_LEAVES,
  checkLayoutRegistry, getEffectiveLayoutContract, getLayoutLeaf, isLayoutId,
} from "./index.js";
import type { LayoutConfig, LayoutLeaf } from "./index.js";

// An injected registry fixture: acceptance is validated against permanent leaf IDs,
// independently of mutable section IA grouping. Retired Designer sections (foundry-build-0036, audit P9) are not
// registered, so no layout slot may accept them.
const sectionLeaves = `band section-header pagination hero page-header content article features
  testimonials logo-cloud people media gallery faq steps timeline call-to-action resource-list
  task-list comparison pricing stats status-list usage data-table data-grid activity-feed
  audit-log form wizard settings column-mapper access-matrix chat link-index table-of-contents
  explorer filter-builder empty-state error-state notices`.split(/\s+/).map((id) => `sections.${id}`);
const copy = () => structuredClone(LAYOUT_LEAVES) as LayoutLeaf[];
function withConfig(config: LayoutConfig): LayoutLeaf[] {
  const rows = copy();
  rows[0] = { ...rows[0]!, contract: { ...rows[0]!.contract, configs: [config] } };
  return rows;
}
const issues = (registry: readonly LayoutLeaf[]) => checkLayoutRegistry(sectionLeaves, registry);

describe("page layout registry", () => {
  it("registers exactly five leaves, four available and staggered-grid held, and nine configs", () => {
    expect(sectionLeaves).toHaveLength(41);
    expect(LAYOUT_LEAVES.map((leaf) => leaf.id)).toEqual(LAYOUT_IDS);
    expect(LAYOUT_LEAVES.filter((leaf) => leaf.status !== "held")).toHaveLength(4);
    expect(getLayoutLeaf("staggered-grid")?.status).toBe("held");
    expect(LAYOUT_LEAVES.flatMap((leaf) => leaf.contract.configs).map((config) => config.id)).toEqual([
      "stack.landing", "stack.document", "stack.focus", "stack.index", "stack.workspace", "split.default", "sidebar-content.record", "sidebar-content.docs", "bento.default",
    ]);
    expect(checkLayoutRegistry(sectionLeaves)).toEqual([]);
  });
  it("refuses promotion of the held layout in a caller registry", () => {
    const rows = copy();
    const index = rows.findIndex(leaf => leaf.id === "staggered-grid");
    rows[index] = { ...rows[index]!, status: "draft" };
    expect(issues(rows)).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "contract", subject: "staggered-grid", message: "staggered-grid is held" }),
    ]));
    expect(() => getEffectiveLayoutContract("staggered-grid")).toThrow();
  });
  it("workspace keeps inherited body bounds and existing defaults while closing page chrome slots", () => {
    const original = getLayoutLeaf("stack")!;
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
  it("admits consumed band/header Sections only in the stack body, retaining native registration and part restrictions", () => {
    const stack = getEffectiveLayoutContract("stack", "stack.workspace"), body = stack.slots.find(slot => slot.id === "body")!;
    expect(body.accepts).toEqual(expect.arrayContaining(["sections.band", "sections.section-header"]));
    expect(body).toMatchObject({ min: 1, max: 24 });
    expect(issues(copy())).toEqual([]);
    const rows = copy(), split = rows.findIndex(row => row.id === "split");
    rows[split] = { ...rows[split]!, contract: { ...rows[split]!.contract, slots: rows[split]!.contract.slots.map((slot, index) => index ? slot : { ...slot, accepts: ["sections.band", "sections.section-header"] }) } };
    expect(issues(rows).some(finding => finding.code === "section" && finding.subject.startsWith("split/"))).toBe(true);
    expect(checkLayoutRegistry(sectionLeaves.filter(id => id !== "sections.band")).some(finding => finding.code === "section")).toBe(true);
  });
  it("uses closed permanent layout ids and closed config segments", () => {
    for (const id of LAYOUT_IDS) expect(LAYOUT_ID.test(id)).toBe(true);
    for (const leaf of LAYOUT_LEAVES) for (const config of leaf.contract.configs) expect(LAYOUT_CONFIG_ID.test(config.id)).toBe(true);
    for (const id of ["layouts.future", "layouts.page.stack", "layouts.Stack", "layouts.stack_", "stack\n", "sections.hero", "layouts.stаck"]) {
      expect(isLayoutId(id)).toBe(false);
      expect(getLayoutLeaf(id)).toBeUndefined();
    }
  });
  it("keeps the four arrangement models with only page populated", () => {
    expect(ARRANGEMENT_MODELS).toEqual(["page", "canvas", "paged", "panes"]);
    expect(LAYOUT_LEAVES.every((leaf) => leaf.contract.arrangement === "page")).toBe(true);
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
    const document = getEffectiveLayoutContract("stack", "stack.document");
    expect(document.memberValues.measure).toBe("prose");
    expect(document.slots.find((slot) => slot.id === "body")?.accepts).toEqual(["sections.article"]);
    const landing = getEffectiveLayoutContract("stack", "stack.landing");
    expect(landing.slots[0]).toMatchObject({ id: "lead", min: 1, max: 1, accepts: ["sections.hero"] });
    for (const config of ["stack.focus", "stack.index"]) expect(getEffectiveLayoutContract("stack", config).slots[1]?.max).toBe(1);
    expect(getEffectiveLayoutContract("sidebar-content", "sidebar-content.docs").slots[2]?.accepts).toEqual(["sections.table-of-contents"]);
    expect(getEffectiveLayoutContract("sidebar-content", "sidebar-content.record").reflow).toEqual([{ at: "md", columns: 2 }]);
    expect(getEffectiveLayoutContract("sidebar-content").reflow).toEqual([{ at: "lg", columns: 2 }]);
    expect(getLayoutLeaf("stack")?.contract.slots[0]?.min).toBe(0);
    expect(Object.isFrozen(document.slots)).toBe(true);
  });
  it("resolves explicit split and bento default configs without altering their contracts", () => {
    for (const id of ["split", "bento"] as const) {
      const leaf = getLayoutLeaf(id)!;
      const config = `${id}.default`;
      expect(leaf.contract.configs).toEqual([{ id: config, members: {} }]);
      expect(getEffectiveLayoutContract(id, config)).toEqual({ ...leaf.contract, memberValues: {} });
      expect(() => getEffectiveLayoutContract(id, "default")).toThrow("Unknown layout config");
    }
  });
  it("refuses held, unknown, foreign config and open member values", () => {
    for (const id of ["staggered-grid", "layouts.future"]) expect(() => getEffectiveLayoutContract(id)).toThrow();
    for (const id of ["stack.missing", "sidebar-content.docs", ""]) expect(() => getEffectiveLayoutContract("stack", id)).toThrow("Unknown layout config");
    expect(() => getEffectiveLayoutContract("stack", undefined, { measure: "unlimited" })).toThrow("Unknown layout member");
    expect(() => getEffectiveLayoutContract("stack", undefined, { invented: "start" })).toThrow("Unknown layout member");
    expect(() => getEffectiveLayoutContract("stack", "stack.focus", { measure: "wide" })).toThrow("conflicts with config");
    expect(getEffectiveLayoutContract("split", undefined, { collapse: "end-first" }).memberValues).toEqual({ collapse: "end-first" });
  });
  it("pins acceptance, count, shape and adaptive tile semantics", () => {
    const stack = getLayoutLeaf("stack")!.contract;
    expect(stack.slots.map(({ id, min, max, position }) => ({ id, min, max, position }))).toEqual([
      { id: "lead", min: 0, max: 1, position: "first" }, { id: "body", min: 1, max: 24, position: "any" }, { id: "close", min: 0, max: 1, position: "last" },
    ]);
    // 42 -> 39: foundry-build-0036 P9 drops three retired Designer sections from layouts.json.
    expect(stack.slots[1]?.accepts).toHaveLength(39);
    expect(stack.slots[1]?.accepts).not.toContain("sections.table-of-contents");
    expect(getLayoutLeaf("bento")!.contract).toMatchObject({ requiresSection: { container: "adaptive" }, slots: [{ id: "lead" }, { id: "tiles", min: 3, max: 12, tile: { spans: ["1x1", "2x1", "1x2", "2x2"] } }] });
    expect(getLayoutLeaf("bento")!.contract.reflow.map((step) => step.columns)).toEqual([2, 3, 4]);
    expect(getLayoutLeaf("sidebar-content")!.contract.members.breakpoint).toEqual(["md", "lg"]);
  });
  it("rejects duplicate ids and unsafe contract metadata", () => {
    const duplicated = [...copy(), copy()[0]!];
    expect(issues(duplicated).some((finding) => finding.code === "id")).toBe(true);
    const rows = copy();
    rows[1] = { ...rows[1]!, contract: { ...rows[1]!.contract, reflow: [{ at: "tokens.breakpoint.unknown" as never, columns: 2 }] } };
    expect(issues(rows).some((finding) => finding.code === "contract")).toBe(true);
  });
});
