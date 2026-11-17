import { describe, expect, it } from "vitest";
import tokens from "../catalog/ia/themes.json" with { type: "json" };
import assets from "../catalog/ia/assets.json" with { type: "json" };
import components from "../catalog/ia/components.json" with { type: "json" };
import sections from "../catalog/ia/sections.json" with { type: "json" };
import frames from "../catalog/ia/frames.json" with { type: "json" };
import { checkIAPlacement, assertIAPlacements, loadBuildCatalog, loadCatalog, type Placement } from "./index.js";

type CrossReference = { node: string; leaves: string[] };
type WithReferences = Placement & { crossReferences?: CrossReference[] };

const fixtures = [tokens, assets, components, sections, frames];
// G6 (GATES-RED round 4): the restore checks compare against the owner-signed tree, not a stale
// literal. The owner re-sign of 2026-11-02 (leaf-freeze.test.ts) signs 236 canonical leaves;
// the build catalog measured before any mutation must be that tree, and every guarded
// mutation below must leave it exactly as loaded. The owner sign of 2026-11-05 adds the eight
// components.specimen-* leaves (ia/components.specimen-leaf-amendments.json): 236 + 8 = 244.
const OWNER_SIGNED_LEAVES = 244;
const BUILD_SLOTS = loadBuildCatalog().slots.map(slot => slot.id);
// Group/family/leaf counts of the committed IA trees (components and sections re-measured in GATES-RED round 4;
// both were already 68 and 7/24/66 at 35c58c51f, so the old literals failed there too). Components
// re-measured at d42a35110: the owner-signed display-specimens family holds the eight specimen leaves.
// foundry-build-0018 recut (designer.md): each layer is one L1 under the Theme/Art/Interface L0; retired leaves stay placed.
const counts = { themes: [4, 11, 42], assets: [3, 10, 49], components: [1, 8, 78], sections: [1, 6, 66], frames: [1, 3, 12] };
// foundry-build-0032 (audit P3): frames.deck registers in a third frames family (Deck): frames 1/2/11 -> 1/3/12.
const leafIds = (tree: Placement): string[] => tree.nodes.flatMap(group => "children" in group ? group.children.flatMap(family => "leaves" in family ? family.leaves : []) : []);

describe("IA1 exact three levels and IA2 unmixed nodes", () => {
  it("loads the owner-signed build catalog", () => {
    expect(BUILD_SLOTS).toHaveLength(OWNER_SIGNED_LEAVES);
    expect(new Set(BUILD_SLOTS).size).toBe(OWNER_SIGNED_LEAVES);
  });
  for (const input of fixtures) {
    const placement = input as unknown as Placement;
    const layer = placement.layer;
    const ids = leafIds(placement);
    it(`${layer}: passing fixture has every leaf at L3 once, with real group/family counts`, () => {
      expect(checkIAPlacement(placement, ids)).toEqual([]);
      expect([placement.nodes.length, placement.nodes.flatMap(group => "children" in group ? group.children : []).length, ids.length]).toEqual(counts[layer as keyof typeof counts]);
      expect(new Set(ids).size).toBe(ids.length);
    });
    it(`${layer}: IA1 rejects the former shallow placement shape`, () => {
      const shallow = { layer, nodes: placement.nodes.map(group => ({ id: group.id, label: group.label, leaves: "children" in group ? group.children.flatMap(family => "leaves" in family ? family.leaves : []) : [] })) };
      expect(checkIAPlacement(shallow, ids).some(finding => finding.code === "IA1")).toBe(true);
      expect(() => assertIAPlacements([shallow], ids.map(id => ({ id, layer })))).toThrow("IA1");
    });
    it(`${layer}: IA2 rejects a node containing children and leaves`, () => {
      const mixed = structuredClone(input);
      Object.assign(mixed.nodes[0]!, { leaves: [ids[0]!] });
      expect(checkIAPlacement(mixed, ids).some(finding => finding.code === "IA2")).toBe(true);
      expect(() => assertIAPlacements([mixed], ids.map(id => ({ id, layer })))).toThrow("IA2");
    });
    it(`${layer}: rejects duplicate, missing and unregistered leaf placements`, () => {
      const changed = structuredClone(placement);
      const group = changed.nodes[0]!;
      if (!("children" in group)) throw new Error("expected group");
      const family = group.children[0]!;
      if (!("leaves" in family)) throw new Error("expected family");
      family.leaves = [...family.leaves.slice(1), ids[1]!, `${layer}.unregistered`];
      const findings = checkIAPlacement(changed, ids);
      expect(findings.some(finding => finding.message.includes("missing leaf"))).toBe(true);
      expect(findings.some(finding => finding.message.includes("appears 2 times"))).toBe(true);
      expect(findings.some(finding => finding.message.includes("unregistered leaf"))).toBe(true);
    });
    it(`${layer}: source guard rejects invalid source placement before the build tree is offered`, () => {
      // Mutate the imported source fixture briefly, rather than testing a detached copy only.
      const original = [...input.nodes];
      try {
        Object.assign(input, { nodes: [{ id: "bad", label: "Bad", leaves: ids }] });
        expect(() => loadBuildCatalog()).toThrow("IA1");
        if (layer === "themes" || layer === "assets") expect(() => loadCatalog()).toThrow("IA1");
      } finally { Object.assign(input, { nodes: original }); }
      expect(loadBuildCatalog().slots.map(slot => slot.id)).toEqual(BUILD_SLOTS);
    });
  }

  it("places consent under Sections > States beside notices", () => {
    const root = sections.nodes.find(node => node.id === "sections")!;
    const states = root.children.find(node => node.id === "sections-states")!;
    expect(states.leaves).toEqual(["sections.empty-state", "sections.error-state", "sections.notices", "sections.consent", "sections.boundary-message"]);
  });

  it("rejects deeper nesting, missing trees, empty families and facet branches", () => {
    const placement = { layer: "themes", nodes: [{ id: "color", label: "Color", children: [{ id: "role", label: "Role", children: [{ id: "nested", label: "Nested", leaves: ["themes.primary"] }] }] }] };
    expect(checkIAPlacement(placement).some(finding => finding.code === "IA1")).toBe(true);
    expect(() => assertIAPlacements([], [{ id: "themes.primary", layer: "themes" }])).toThrow("IA1");
    expect(checkIAPlacement({ layer: "themes", nodes: [{ id: "color", label: "Color", children: [{ id: "empty", label: "Empty", leaves: [] }] }] }).some(finding => finding.code === "IA1")).toBe(true);
  });
});

describe("owner-signed IA moves (ledger #44, 2026-10-26)", () => {
  const family = (tree: Placement, id: string): readonly string[] => {
    for (const group of tree.nodes) if ("children" in group) for (const node of group.children) if (node.id === id && "leaves" in node) return node.leaves;
    throw new Error(`missing family ${id}`);
  };
  const homes = (tree: Placement, id: string): string[] => tree.nodes.flatMap(group => "children" in group ? group.children.filter(node => "leaves" in node && node.leaves.includes(id)).map(node => node.id) : []);
  const build = () => loadBuildCatalog();

  it("places the three animation leaves under Motion > Animations, once each", () => {
    expect(family(tokens as Placement, "motion-animations")).toEqual(["themes.animate-marquee", "themes.animate-marquee-vertical", "themes.animate-shiny-text"]);
    for (const id of ["themes.animate-marquee", "themes.animate-marquee-vertical", "themes.animate-shiny-text"]) expect(homes(tokens as Placement, id)).toHaveLength(1);
  });
  it("keeps tag-group, icon, logo, status-mark and the charts each in one recut component family", () => {
    const tree = components as Placement;
    for (const [id, home] of [["components.tag-group", "components-inputs"], ["components.icon", "components-text-and-media"], ["components.logo", "components-text-and-media"], ["components.status-mark", "components-text-and-media"]] as const) expect(homes(tree, id)).toEqual([home]);
    for (const id of ["components.chart-bar", "components.chart-sparkline", "components.chart-scatter", "components.chart-waterfall"]) expect(homes(tree, id)).toEqual(["components-collections"]);
    for (const old of ["charts-core", "charts-compact", "charts-analytic", "display-charts"]) expect(() => family(tree, old)).toThrow("missing family");
  });
  it("refuses a moved id placed as a leaf in a second layer", () => {
    const { placements, slots } = build();
    const changed = placements.map(tree => structuredClone(tree)) as WithReferences[];
    const assetTree = changed.find(tree => tree.layer === "assets")!;
    const icons = assetTree.nodes.find(group => group.id === "icons")!;
    if (!("children" in icons)) throw new Error("expected group");
    const first = icons.children[0]!;
    if (!("leaves" in first)) throw new Error("expected family");
    (first as { leaves: string[] }).leaves = [...first.leaves, "themes.spacing"];
    expect(checkIAPlacement(assetTree).some(finding => finding.code === "IA1" && finding.message.includes("invalid leaf themes.spacing"))).toBe(true);
    expect(() => assertIAPlacements(changed, slots)).toThrow("IA1");
  });
  for (const [label, edit, message] of [
    ["a second cross-reference to the same id from another layer", (trees: WithReferences[]) => { trees.find(tree => tree.layer === "components")!.crossReferences = [{ node: "display-assets", leaves: ["themes.spacing"] }]; }, "cross-referenced 2 times"],
    ["a duplicate cross-reference inside one tree", (trees: WithReferences[]) => { trees.find(tree => tree.layer === "assets")!.crossReferences!.push({ node: "imagery", leaves: ["themes.spacing"] }); }, "cross-referenced 2 times"],
    ["a cross-reference to its own layer", (trees: WithReferences[]) => { trees.find(tree => tree.layer === "assets")!.crossReferences![0]!.leaves = ["assets.image"]; }, "own layer"],
    ["a cross-reference to an unknown node", (trees: WithReferences[]) => { trees.find(tree => tree.layer === "assets")!.crossReferences![0]!.node = "nowhere"; }, "unknown node"],
    ["a cross-reference to an unregistered slot", (trees: WithReferences[]) => { trees.find(tree => tree.layer === "assets")!.crossReferences![0]!.leaves = ["themes.unregistered"]; }, "unregistered cross-reference"],
    ["an empty cross-reference", (trees: WithReferences[]) => { trees.find(tree => tree.layer === "assets")!.crossReferences![0]!.leaves = []; }, "nonempty"],
  ] as const) it(`refuses ${label}`, () => {
    const { placements, slots } = build();
    const changed = placements.map(tree => structuredClone(tree)) as WithReferences[];
    // No shipped tree carries a cross-reference now, so start from one valid synthetic row.
    changed.find(tree => tree.layer === "assets")!.crossReferences = [{ node: "icons", leaves: ["themes.spacing"] }];
    expect(() => assertIAPlacements(changed, slots)).not.toThrow();
    edit(changed);
    expect(() => assertIAPlacements(changed, slots)).toThrow(message);
  });
  it("source guard refuses a duplicated cross-reference before the catalog is offered", () => {
    const had = Object.hasOwn(assets, "crossReferences");
    const original = structuredClone((assets as WithReferences).crossReferences);
    try {
      (assets as WithReferences).crossReferences = [{ node: "icons", leaves: ["themes.spacing"] }, { node: "imagery", leaves: ["themes.spacing"] }];
      expect(() => loadCatalog()).toThrow("cross-referenced 2 times");
    } finally {
      if (had) Object.assign(assets, { crossReferences: original });
      else delete (assets as WithReferences).crossReferences;
    }
    expect(loadBuildCatalog().slots.map(slot => slot.id)).toEqual(BUILD_SLOTS);
  });
});
