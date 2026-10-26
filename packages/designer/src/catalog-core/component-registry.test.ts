import { describe, expect, it } from "vitest";
import retired from "../catalog/retired.json" with { type: "json" };
import { componentRegistryFindings, loadBuildCatalog, loadCatalog, loadComponentRegistry, isValidId, type ComponentComposedOrigin, type ComposeOperation, type PlacementNode, type Source } from "./index.js";

// Independent audit inventory: permanent ids are separate from the editable IA view.
const families: Record<string, readonly string[]> = {
  "actions-buttons": ["button", "native-action", "toggle-button"],
  "actions-menus": ["menu"],
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
  "display-content": ["semantic-content"],
  "display-media": ["avatar"],
  "display-assets": ["icon", "logo"],
  "charts-core": ["chart-bar", "chart-line", "chart-area"],
  "charts-compact": ["chart-sparkline", "chart-status-strip"],
  "charts-analytic": ["chart-scatter", "chart-heatmap", "chart-range", "chart-waterfall"],
  "feedback-messages": ["banner", "toast"],
  "feedback-indicators": ["status-mark"],
  "feedback-progress": ["progress-bar", "spinner", "skeleton"],
  "navigation-links": ["link", "breadcrumbs"],
  "navigation-panels": ["tabs"],
  "navigation-trees": ["navigation-tree"],
  "containment-structure": ["card", "separator", "disclosure", "resize-handle"],
  "containment-overlays": ["dialog", "popover", "tooltip"],
};
const roots: Record<string, string> = {
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
const presentational = ["badge", "avatar", "icon", "logo", "status-mark", "skeleton", "card", "banner", "semantic-content"];
const fullId = (leaf: string) => `components.${leaf}`;
const inventory = Object.values(families).flat().map(fullId).sort();
const leafNodes = (nodes: readonly PlacementNode[]): PlacementNode[] => nodes.flatMap(node => "leaves" in node ? [node] : leafNodes(node.children));

// These prove shape only; component execution belongs to later implementation units.
describe("component build IA registry", () => {
  it("registers the 57 signed ids and two explicit local drafts once as draft contracts without a freeze claim", () => {
    const registry = loadComponentRegistry();
    expect(registry.status).toBe("build-unfrozen");
    expect(registry.slots).toHaveLength(59);
    expect(registry.slots.map(slot => slot.id)).toEqual(inventory);
    expect(new Set(registry.slots.map(slot => slot.id)).size).toBe(59);
    expect(registry.slots.every(slot => isValidId("slot", slot.id) && slot.layer === "components" && slot.status === "draft" && slot.signoff === undefined)).toBe(true);
    expect(componentRegistryFindings(registry)).toEqual([]);
  });

  it("places every id once under six L1 groups and twenty-seven L2 families", () => {
    const registry = loadComponentRegistry();
    expect(registry.placement.nodes.map(node => node.id)).toEqual(["actions", "inputs", "display", "feedback", "navigation", "containment"]);
    expect(registry.placement.nodes.flatMap(node => "children" in node ? node.children : [])).toHaveLength(27);
    const nodes = leafNodes(registry.placement.nodes);
    expect(Object.fromEntries(nodes.map(node => [node.id, "leaves" in node ? node.leaves : []]))).toEqual(Object.fromEntries(Object.entries(families).map(([id, leaves]) => [id, leaves.map(fullId)])));
    expect(nodes.flatMap(node => "leaves" in node ? node.leaves : []).sort()).toEqual(inventory);
    // Sheet, drawer and command placement stay outside this primitive layer.
    expect(registry.slots.find(slot => slot.id === "components.dialog")?.contract.members).toEqual({ mode: "closed", names: ["role.modal", "dismissable"] });
  });

  it("records all audited runtime roots: 39 React Aria, nine presentational, eleven without an engine", () => {
    const registry = loadComponentRegistry();
    for (const slot of registry.slots) {
      const leaf = slot.id.slice("components.".length);
      const expected = roots[leaf] ? `rac:${roots[leaf]}` : presentational.includes(leaf) ? "presentational" : "engine:none";
      expect(slot.contract.root, slot.id).toBe(expected);
      expect(slot.contract.kind).toBe("component");
      expect(slot.contract.members.mode).toBe("closed");
      expect(slot.contract.props).toEqual(slot.id === "components.semantic-content" ? ["as"] : []);
    }
    expect(registry.slots.filter(slot => slot.contract.root.startsWith("rac:"))).toHaveLength(39);
    expect(registry.slots.filter(slot => slot.contract.root === "presentational")).toHaveLength(9);
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
      for (const id of slot.contract.allowedReads.tokens) expect(id.startsWith("tokens.") && ids.has(id), `${slot.id} reads ${id}`).toBe(true);
      for (const id of slot.contract.allowedReads.assets) expect(id.startsWith("assets.") && ids.has(id), `${slot.id} reads ${id}`).toBe(true);
      walk(slot.id, []);
    }
    expect(slots.get("components.date-picker")?.contract.composes).toEqual(["components.date-field", "components.popover", "components.calendar"]);
  });

  it("exposes fresh build IA while retaining all 98 runtime leaves and their existing fills", () => {
    const runtime = loadCatalog();
    const build = loadBuildCatalog();
    expect(runtime.slots).toHaveLength(98);
    expect(build.slots.filter(slot => slot.layer === "tokens" || slot.layer === "assets" || slot.layer === "components")).toHaveLength(157);
    expect(build.registryStatus).toBe("build-unfrozen");
    expect(build.slots.filter(slot => slot.layer === "tokens" || slot.layer === "assets")).toEqual(runtime.slots);
    expect(build.fills).toEqual(runtime.fills);
    expect(build.fills.every(fill => !fill.$extensions["com.clossys.fill"].slot.startsWith("components."))).toBe(true);
    expect(build.placements.filter(row => row.layer === "tokens" || row.layer === "assets")).toEqual(runtime.placements);
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
