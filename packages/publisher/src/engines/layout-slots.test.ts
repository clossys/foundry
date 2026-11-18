import { describe, expect, it } from "vitest";
import { checkPageOption, type LayoutContract, type PageOptionContent } from "../check/page-sections-instance.js";
import { loadDefaults, loadDesignerCatalog, placedLeaves, slotContract, type PageSlot } from "../catalog/ia/tree.js";
import { LAYOUT_ENGINES, checkLayoutRegistry, getEffectiveLayoutContract } from "./index.js";
import { ENGINE_KEYS } from "./keys.js";
import { LAYOUT_ENGINE_MAP, checkLayoutEngineMap, layoutEngineFor, pageLayoutEngine, type LayoutEngineMap } from "./layout-slots.js";

const designer = loadDesignerCatalog();
const liveLayouts = placedLeaves().filter(leaf => leaf.id.startsWith("layout.") && !leaf.parked).map(leaf => leaf.id);
const homePage = () => structuredClone(loadDefaults().get("page.home/starter-v1.json")!.content) as PageOptionContent & { layout: string };
const without = (slot: string): LayoutEngineMap => {
  const layouts = { ...LAYOUT_ENGINE_MAP.layouts };
  delete layouts[slot];
  return { ...LAYOUT_ENGINE_MAP, layouts };
};

describe("layout.* slots select the render engine through one data map", () => {
  it("covers every live layout.* slot exactly once and names only live engines and registered configs", () => {
    expect(liveLayouts.length).toBeGreaterThan(10);
    expect(checkLayoutEngineMap(liveLayouts)).toEqual([]);
    expect(LAYOUT_ENGINE_MAP.paged).toEqual(["layout.deck"]);
  });

  it("changing a page's layout.* pin changes the engine the page renders with", () => {
    const page = homePage();
    expect(page.layout).toBe("publisher/layout.marketing-home");
    const before = pageLayoutEngine(page)!;
    expect(before).toEqual({ slot: "layout.marketing-home", engine: "stack", config: "stack.landing" });
    page.layout = "publisher/layout.docs-guide";
    const after = pageLayoutEngine(page)!;
    expect(after).toEqual({ slot: "layout.docs-guide", engine: "sidebar-content", config: "sidebar-content.docs" });
    // The engine contract the page is laid out with follows the pin: different engine, different slots.
    const slotsOf = (choice: typeof before) => getEffectiveLayoutContract(choice.engine, choice.config).slots.map(slot => slot.id);
    expect(slotsOf(after)).not.toEqual(slotsOf(before));
    page.layout = "publisher/layout.app-settings";
    expect(pageLayoutEngine(page)).toEqual({ slot: "layout.app-settings", engine: "sidebar-content", config: "sidebar-content.record" });
    page.layout = "publisher/layout.deck";
    expect(pageLayoutEngine(page)).toBeNull();
  });

  it("refuses a layout.* slot with no map entry instead of rendering a default engine", () => {
    expect(() => layoutEngineFor("layout.docs-guide", without("layout.docs-guide"))).toThrow("layout.docs-guide has no render engine");
    expect(checkLayoutEngineMap(liveLayouts, without("layout.docs-guide"))).toEqual(["layout.docs-guide: has no render engine entry"]);
    expect(() => layoutEngineFor("stack")).toThrow("is not a layout.* slot");
    const held = { ...LAYOUT_ENGINE_MAP, layouts: { ...LAYOUT_ENGINE_MAP.layouts, "layout.about": { engine: "staggered-grid", config: "staggered-grid.default" } } };
    expect(checkLayoutEngineMap(liveLayouts, held)).toEqual(["layout.about: engine staggered-grid is held"]);
    const foreign = { ...LAYOUT_ENGINE_MAP, layouts: { ...LAYOUT_ENGINE_MAP.layouts, "layout.about": { engine: "split", config: "stack.landing" } } };
    expect(checkLayoutEngineMap(liveLayouts, foreign)).toEqual(["layout.about: config stack.landing is not registered on engine split"]);
    const extra = { ...LAYOUT_ENGINE_MAP, layouts: { ...LAYOUT_ENGINE_MAP.layouts, "layout.one-pager": { engine: "stack", config: "stack.document" } } };
    expect(checkLayoutEngineMap(liveLayouts, extra)).toEqual(["layout.one-pager: is not a live layout.* slot"]);
  });

  it("the page check resolves the pinned layout's engine, so a page whose layout has no engine fails", () => {
    const page = homePage();
    const contract = slotContract("page.home") as PageSlot;
    const layout = slotContract("layout.marketing-home") as LayoutContract;
    expect(checkPageOption("page.home", page, contract, layout, designer).filter(finding => finding.check === "page.layout-engine")).toEqual([]);
    // A page slot that allows a layout.* slot with no map entry: the page check refuses it rather than rendering a default.
    const orphan = { ...page, layout: "publisher/layout.help" };
    const allows = { ...contract, layouts: [...contract.layouts, "publisher/layout.help"] };
    expect(checkPageOption("page.home", orphan, allows, layout, designer).filter(finding => finding.check === "page.layout-engine").map(finding => finding.message))
      .toEqual(["page.home: layout.help has no render engine: it has no entry in the layout engine map"]);
  });

  it("engines are internal render primitives: no slot identity, and no engine key is a slot id", () => {
    for (const engine of LAYOUT_ENGINES) {
      expect(Object.keys(engine).sort()).toEqual(["contract", "engine", "requires", "status"]);
      expect(slotContract(engine.engine)).toBeUndefined();
    }
    const placed = new Set(placedLeaves().map(leaf => leaf.id));
    for (const key of ENGINE_KEYS) expect(placed.has(key)).toBe(false);
    for (const entry of Object.values(LAYOUT_ENGINE_MAP.layouts)) expect(entry.engine).not.toMatch(/\./);
    const rows = structuredClone(LAYOUT_ENGINES) as unknown as Record<string, unknown>[];
    rows[0] = { ...rows[0], layer: "layouts" };
    expect(checkLayoutRegistry([], rows as never).some(finding => finding.message.includes("slot identity"))).toBe(true);
  });
});
