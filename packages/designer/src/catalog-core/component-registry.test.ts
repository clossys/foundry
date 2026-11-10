import { describe, expect, it } from "vitest";
import retired from "../catalog/retired.json" with { type: "json" };
import { componentRegistryFindings, loadBuildCatalog, loadCatalog, loadComponentRegistry, isValidId, type ComponentComposedOrigin, type ComposeOperation, type PlacementNode, type Source } from "./index.js";

// Independent audit inventory: permanent ids are separate from the editable IA view.
const families: Record<string, readonly string[]> = {
  "actions-buttons": ["button", "native-action", "toggle-button"],
  "actions-menus": ["menu", "command", "dropdown-menu"],
  "actions-toolbars": ["toolbar"],
  "inputs-form": ["field", "form"],
  "inputs-text": ["text-field", "search-field"],
  "inputs-choice": ["checkbox", "radio-group", "switch", "select", "combo-box", "toggle-group"],
  "inputs-tags": ["tag-group"],
  "inputs-number": ["number-field", "slider"],
  "inputs-date": ["date-field", "date-picker", "calendar"],
  "inputs-color": ["color-picker"],
  "inputs-files": ["file-trigger"],
  "display-data": ["table", "grid-list", "tree", "meter"],
  "display-labels": ["badge", "keyboard"],
  "display-content": ["semantic-content", "rich-text", "item"],
  "display-specimens": ["specimen-swatch", "specimen-ladder", "specimen-player", "specimen-grid", "specimen-matrix", "specimen-viewport", "specimen-passage", "specimen-copy-in-context"],
  "display-media": ["avatar", "media-player"],
  "display-assets": ["icon", "logo"],
  "charts-core": ["chart-bar", "chart-line", "chart-area"],
  "charts-compact": ["chart-sparkline", "chart-status-strip"],
  "charts-analytic": ["chart-scatter", "chart-heatmap", "chart-range", "chart-waterfall"],
  "feedback-messages": ["banner", "toast", "empty"],
  "feedback-indicators": ["status-mark"],
  "feedback-progress": ["progress-bar", "spinner", "skeleton"],
  "navigation-links": ["link", "breadcrumbs"],
  "navigation-panels": ["tabs"],
  "navigation-trees": ["navigation-tree", "sidebar"],
  "containment-structure": ["card", "separator", "disclosure", "resize-handle", "scroll-area"],
  "containment-overlays": ["dialog", "popover", "tooltip", "sheet"],
};
const roots: Record<string, string> = {
  command: "Autocomplete", sheet: "Dialog+Modal+ModalOverlay", "dropdown-menu": "Menu",
  button: "Button", "toggle-button": "ToggleButton", menu: "Menu", toolbar: "Toolbar",
  field: "Label+Text+FieldError", form: "Form", "text-field": "TextField", "search-field": "SearchField",
  checkbox: "Checkbox", "radio-group": "RadioGroup", switch: "Switch", select: "Select", "combo-box": "ComboBox",
  "toggle-group": "ToggleButtonGroup", "tag-group": "TagGroup", "number-field": "NumberField", slider: "Slider",
  "date-field": "DateField", "date-picker": "DatePicker", calendar: "Calendar", "color-picker": "ColorPicker",
  "file-trigger": "FileTrigger", table: "Table", "grid-list": "GridList", tree: "Tree", meter: "Meter", keyboard: "Keyboard",
  toast: "UNSTABLE_Toast", "progress-bar": "ProgressBar", spinner: "ProgressBar", link: "Link", breadcrumbs: "Breadcrumbs",
  tabs: "Tabs", "navigation-tree": "NavigationTree", separator: "Separator", disclosure: "Disclosure", dialog: "Dialog",
  popover: "Popover", tooltip: "Tooltip",
};
const specimens = ["specimen-swatch", "specimen-ladder", "specimen-player", "specimen-grid", "specimen-matrix", "specimen-viewport", "specimen-passage", "specimen-copy-in-context"];
const presentational = ["badge", "avatar", "icon", "logo", "status-mark", "skeleton", "card", "banner", "semantic-content", "sidebar", "empty", "item", "scroll-area", "rich-text", "media-player", ...specimens];
const fullId = (leaf: string) => `components.${leaf}`;
const inventory = Object.values(families).flat().map(fullId).sort();
// Appended in amendment order: components.leaf-amendments.json, then the owner-signed 2026-11-05
// specimen leaves (components.specimen-leaf-amendments.json).
const addedInventory = ["sidebar", "command", "sheet", "empty", "item", "scroll-area", "dropdown-menu", "rich-text", "media-player", ...specimens].map(fullId);
const leafNodes = (nodes: readonly PlacementNode[]): PlacementNode[] => nodes.flatMap(node => "leaves" in node ? [node] : leafNodes(node.children));

// These prove shape only; component execution belongs to later implementation units.
describe("component build IA registry", () => {
  it("records the consumed-only parked charts in IA data and rejects a parked id that is not placed (register H4c)", () => {
    const registry = loadComponentRegistry();
    expect(registry.placement.parked?.map(entry => entry.leaf)).toEqual(["components.chart-area", "components.chart-bar", "components.chart-line"]);
    for (const entry of registry.placement.parked ?? []) expect(entry.basis).toMatch(/H4c/);
    const forged = { ...registry, placement: { ...registry.placement, parked: [...registry.placement.parked!, { leaf: "components.unplaced", basis: "x" }] } };
    expect(componentRegistryFindings(forged)).toEqual(["parked: components.unplaced is not a placed component leaf"]);
  });


  it("registers the 57 signed ids and two explicit local drafts once as draft contracts without a freeze claim", () => {
    const registry = loadComponentRegistry();
    expect(registry.status).toBe("build-unfrozen");
    expect(registry.slots).toHaveLength(76);
    expect(registry.slots.map(slot => slot.id)).toEqual([...inventory.filter(id => !addedInventory.includes(id)), ...addedInventory]);
    expect(new Set(registry.slots.map(slot => slot.id)).size).toBe(76);
    expect(registry.slots.every(slot => isValidId("slot", slot.id) && slot.layer === "components" && slot.status === "draft" && slot.signoff === undefined)).toBe(true);
    expect(componentRegistryFindings(registry)).toEqual([]);
  });

  it("places every id once under six L1 groups and twenty-eight L2 families", () => {
    const registry = loadComponentRegistry();
    expect(registry.placement.nodes.map(node => node.id)).toEqual(["actions", "inputs", "display", "feedback", "navigation", "containment"]);
    expect(registry.placement.nodes.flatMap(node => "children" in node ? node.children : [])).toHaveLength(28);
    const nodes = leafNodes(registry.placement.nodes);
    expect(Object.fromEntries(nodes.map(node => [node.id, "leaves" in node ? node.leaves : []]))).toEqual(Object.fromEntries(Object.entries(families).map(([id, leaves]) => [id, leaves.map(fullId)])));
    expect(nodes.flatMap(node => "leaves" in node ? node.leaves : []).sort()).toEqual(inventory);
    // Sheet, drawer and command placement stay outside this primitive layer.
    expect(registry.slots.find(slot => slot.id === "components.dialog")?.contract.members).toEqual({ mode: "closed", names: ["role.modal", "dismissable"] });
  });

  // R2F-11: the amended rich-text, media-player and owner-signed specimen leaves declare typed props; every other leaf declares none.
  const specimenProps = ["items", "axes", "context", "need", "renderParts", "expanded", "labels"];
  const declaredProps: Record<string, readonly string[]> = {
    "semantic-content": ["as"],
    "rich-text": ["value", "readOnly", "onChange", "className", "id", "dir", "aria-label", "aria-labelledby"],
    "media-player": ["video", "poster", "passage", "captions", "muted", "autoplay", "loop", "controls", "className", "decorative"],
    ...Object.fromEntries(["swatch", "ladder", "grid", "viewport"].map(leaf => [`specimen-${leaf}`, [...specimenProps, "variant"]])),
    ...Object.fromEntries(["player", "matrix", "passage", "copy-in-context"].map(leaf => [`specimen-${leaf}`, specimenProps])),
  };
  it("records all audited runtime roots: 42 React Aria, 23 presentational, eleven without an engine", () => {
    const registry = loadComponentRegistry();
    for (const slot of registry.slots) {
      const leaf = slot.id.slice("components.".length);
      const expected = roots[leaf] ? `rac:${roots[leaf]}` : presentational.includes(leaf) ? "presentational" : "engine:none";
      expect(slot.contract.root, slot.id).toBe(expected);
      expect(slot.contract.kind).toBe("component");
      expect(slot.contract.members.mode).toBe("closed");
      expect(slot.contract.props, slot.id).toEqual(declaredProps[leaf] ?? []);
    }
    expect(registry.slots.filter(slot => slot.contract.root.startsWith("rac:"))).toHaveLength(42);
    expect(registry.slots.filter(slot => slot.contract.root === "presentational")).toHaveLength(23);
    expect(registry.slots.filter(slot => slot.contract.root === "engine:none")).toHaveLength(11);
  });

  it("keeps leaf reads resolvable and same-layer composition acyclic", () => {
    const build = loadBuildCatalog();
    const registry = loadComponentRegistry();
    const ids = new Set(build.slots.map(slot => slot.id));
    const slots = new Map(registry.slots.map(slot => [slot.id, slot]));
    const walk = (id: string, path: readonly string[]): void => {
      expect(path.includes(id), `composition cycle ${[...path, id].join(" -> ")}`).toBe(false);
      for (const target of slots.get(id)?.contract.composes ?? []) {
        expect(slots.has(target), `${id} composes ${target}`).toBe(true);
        walk(target, [...path, id]);
      }
    };
    for (const slot of registry.slots) {
      for (const id of slot.contract.allowedReads.themes) expect(id.startsWith("themes.") && ids.has(id), `${slot.id} reads ${id}`).toBe(true);
      for (const id of slot.contract.allowedReads.assets) expect(id.startsWith("assets.") && ids.has(id), `${slot.id} reads ${id}`).toBe(true);
      walk(slot.id, []);
    }
    expect(slots.get("components.date-picker")?.contract.composes).toEqual(["components.date-field", "components.popover", "components.calendar"]);
  });

  it("exposes fresh build IA while retaining all 90 runtime leaves and their existing fills", () => {
    const runtime = loadCatalog();
    const build = loadBuildCatalog();
    // 42 themes (shadcn theme leaves since 736153e72) + 49 assets, less the panel icon.
    expect(runtime.slots.filter(slot => slot.id !== "assets.icon-panel-left")).toHaveLength(90);
    expect(build.slots.filter(slot => slot.layer === "themes" || slot.layer === "assets" || slot.layer === "components")).toHaveLength(167);
    expect(build.registryStatus).toBe("build-unfrozen");
    expect(build.slots.filter(slot => slot.layer === "themes" || slot.layer === "assets")).toEqual(runtime.slots);
    expect(build.fills).toEqual(runtime.fills);
    expect(build.fills.every(fill => !fill.$extensions["com.clossys.fill"].slot.startsWith("components."))).toBe(true);
    expect(build.placements.filter(row => row.layer === "themes" || row.layer === "assets")).toEqual(runtime.placements);
    expect(build.retired).toEqual(retired);
    expect(retired).toEqual([]);
    const component = build.slots.find(slot => slot.layer === "components")!;
    component.id = "components.changed";
    expect(loadBuildCatalog().slots.some(slot => slot.id === "components.changed")).toBe(false);
  });

  it("maps historical component names to current leaves without changing retirement evidence", () => {
    const registry = loadComponentRegistry();
    expect(Object.fromEntries(registry.aliases.map(alias => [alias.id, alias.target]))).toEqual({
      "components.icon-button": "components.button", "components.textarea": "components.text-field",
      "components.chip": "components.tag-group", "components.logomark": "components.logo", "components.accordion": "components.disclosure",
    });
    expect(registry.aliases.find(alias => alias.id === "components.icon-button")?.memberMap).toEqual({ shape: "shape.icon-only" });
    expect(registry.aliases.find(alias => alias.id === "components.textarea")?.memberMap).toEqual({ line: "line.multiline" });
    expect(loadBuildCatalog().retired).toEqual([]);
  });

  it("reports duplicate placement rather than concealing it in a set", () => {
    const registry = loadComponentRegistry();
    const node = leafNodes(registry.placement.nodes)[0]!;
    if (!("leaves" in node)) throw new Error("expected action leaves");
    node.leaves = [...node.leaves, "components.button"];
    expect(componentRegistryFindings(registry)).toContain("placement: components.button appears 2 times");
  });

  it("reports a missing leaf id and an unknown placement id independently", () => {
    const registry = loadComponentRegistry();
    const node = leafNodes(registry.placement.nodes)[0]!;
    if (!("leaves" in node)) throw new Error("expected action leaves");
    node.leaves = node.leaves.map(id => id === "components.button" ? "components.unknown" : id);
    expect(componentRegistryFindings(registry)).toEqual(["placement: missing component slot components.button", "placement: unknown component slot components.unknown"]);
  });

  it("rejects malformed slot ids and duplicate slot definitions", () => {
    const registry = loadComponentRegistry();
    registry.slots = [...registry.slots, { ...registry.slots[0]!, id: "components.chart-bar.extra" }, registry.slots[0]!];
    expect(componentRegistryFindings(registry)).toContain("id: invalid component slot components.chart-bar.extra");
    expect(componentRegistryFindings(registry)).toContain(`id: duplicate component slot ${registry.slots[0]!.id}`);
  });

  it("rejects aliases targeting unregistered leaves and members", () => {
    const registry = loadComponentRegistry();
    registry.aliases = [{ id: "components.legacy", target: "components.unknown" }, { id: "components.old-button", target: "components.button", memberMap: { shape: "shape.unknown" } }];
    expect(componentRegistryFindings(registry)).toEqual(["alias: unknown member components.button.shape.unknown", "alias: unknown target components.unknown"]);
  });

  it("exposes package-export pins and composition shapes without enabling compose in the value engine", () => {
    const pin: Source["pin"] = { package: "@clossys/designer", version: "0.12.0", export: "./components#Button" };
    const origin: ComponentComposedOrigin = { kind: "composed", reads: ["components.date-field", "components.popover", "components.calendar"], rule: "compose:date-picker@1" };
    const operation: ComposeOperation = { op: "compose", slot: "components.date-picker", rule: origin.rule };
    expect(pin.export).toBe("./components#Button");
    expect(operation.rule).toBe(origin.rule);
  });
});
