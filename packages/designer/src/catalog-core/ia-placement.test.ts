import { describe, expect, it } from "vitest";
import tokens from "../catalog/ia/tokens.json" with { type: "json" };
import assets from "../catalog/ia/assets.json" with { type: "json" };
import components from "../catalog/ia/components.json" with { type: "json" };
import sections from "../catalog/ia/sections.json" with { type: "json" };
import frames from "../catalog/ia/frames.json" with { type: "json" };
import { checkIAPlacement, assertIAPlacements, loadBuildCatalog, loadCatalog, type Placement } from "./index.js";

const fixtures = [tokens, assets, components, sections, frames];
const counts = { tokens: [7, 20, 53], assets: [4, 10, 48], components: [6, 22, 58], sections: [6, 22, 45], frames: [3, 8, 9] };
const leafIds = (tree: Placement): string[] => tree.nodes.flatMap(group => "children" in group ? group.children.flatMap(family => "leaves" in family ? family.leaves : []) : []);

describe("IA1 exact three levels and IA2 unmixed nodes", () => {
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
        if (layer === "tokens" || layer === "assets") expect(() => loadCatalog()).toThrow("IA1");
      } finally { Object.assign(input, { nodes: original }); }
      expect(loadBuildCatalog().slots).toHaveLength(214);
    });
  }

  it("places consent under Respond > Messages", () => {
    const respond = sections.nodes.find(node => node.id === "respond")!;
    const messages = respond.children.find(node => node.id === "respond-messages")!;
    expect(messages.leaves).toEqual(["sections.notices", "sections.consent"]);
  });

  it("rejects deeper nesting, missing trees, empty families and facet branches", () => {
    const placement = { layer: "tokens", nodes: [{ id: "color", label: "Color", children: [{ id: "role", label: "Role", children: [{ id: "nested", label: "Nested", leaves: ["tokens.accent-color"] }] }] }] };
    expect(checkIAPlacement(placement).some(finding => finding.code === "IA1")).toBe(true);
    expect(() => assertIAPlacements([], [{ id: "tokens.accent-color", layer: "tokens" }])).toThrow("IA1");
    expect(checkIAPlacement({ layer: "tokens", nodes: [{ id: "color", label: "Color", children: [{ id: "empty", label: "Empty", leaves: [] }] }] }).some(finding => finding.code === "IA1")).toBe(true);
  });
});
