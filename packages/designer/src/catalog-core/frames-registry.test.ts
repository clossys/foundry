import { describe, expect, it } from "vitest";
import placementData from "../catalog/ia/frames.json" with { type: "json" };
import globalRetired from "../catalog/retired.json" with { type: "json" };
import aliases from "../catalog/retired/frames.json" with { type: "json" };
import slotData from "../catalog/slots/frames.json" with { type: "json" };
import tokenSlots from "../catalog/slots/tokens.json" with { type: "json" };
import type { FrameContract } from "./frames-contract.js";
import { isValidId, MEMBER_ID, SLOT_ID } from "./ids.js";
import type { Placement, PlacementNode } from "./types.js";

interface FrameSlot {
  id: string;
  layer: "frames";
  status: "draft";
  signoff?: unknown;
  requires: readonly string[];
  contract: FrameContract;
}
const slots = slotData as unknown as readonly FrameSlot[];
const placement = placementData as unknown as Placement;
const expected = ["site-shell", "app-shell", "site-header", "app-header", "app-sidebar", "inspector", "site-footer", "sheet", "command"];
const byId = (id: string): FrameContract => {
  const found = slots.find(slot => slot.id === `frames.${id}`);
  if (!found) throw new Error(`Missing frame ${id}`);
  return found.contract;
};

// Registry-only assertions: these do not measure a rendered frame or implement FK checks.
function placementFindings(tree: Placement, ids: readonly string[]): string[] {
  const counts = new Map<string, number>();
  const nodeIds = new Set<string>();
  const findings: string[] = [];
  const walk = (nodes: readonly PlacementNode[], depth: number): void => {
    for (const node of nodes) {
      if (nodeIds.has(node.id)) findings.push(`duplicate node ${node.id}`);
      nodeIds.add(node.id);
      if ("children" in node) walk(node.children, depth + 1);
      else for (const id of node.leaves) {
        counts.set(id, (counts.get(id) ?? 0) + 1);
        if (depth + 1 > 3) findings.push(`too deep ${id}`);
        if (!ids.includes(id)) findings.push(`unknown ${id}`);
      }
    }
  };
  walk(tree.nodes, 1);
  for (const id of ids) if (counts.get(id) !== 1) findings.push(`placement ${id}: ${counts.get(id) ?? 0}`);
  return findings.sort();
}

function compositionFindings(input: readonly FrameSlot[]): string[] {
  const frames = new Map(input.map(slot => [slot.id, slot]));
  const active = new Set<string>();
  const visited = new Set<string>();
  const findings = new Set<string>();
  const walk = (id: string): void => {
    if (active.has(id)) { findings.add(`cycle ${id}`); return; }
    if (visited.has(id)) return;
    const frame = frames.get(id);
    if (!frame) { findings.add(`missing ${id}`); return; }
    active.add(id);
    for (const target of frame.contract.composes ?? []) if (target.startsWith("frames.")) walk(target);
    active.delete(id);
    visited.add(id);
  };
  for (const id of frames.keys()) walk(id);
  return [...findings].sort();
}

describe("draft frame registry", () => {
  it("limits selectable positioning to the two headers without making it a host state port", () => {
    for (const slot of slots) {
      expect(slot.contract.members.names.filter(member => member.startsWith("position."))).toEqual(
        ["frames.site-header", "frames.app-header"].includes(slot.id) ? ["position.sticky", "position.static"] : [],
      );
      expect(slot.contract.statePorts.map(port => port.id)).not.toContain("position");
    }
    expect(byId("site-header").layers).toContain("tokens.z-index.sticky");
    expect(byId("app-header").members.names).toEqual(["surface.glass", "fallback.opaque", "position.sticky", "position.static"]);
    expect(byId("app-header").layers).toEqual(["tokens.z-index.sticky"]);
  });

  it("contains exactly the nine independent, unfrozen leaves", () => {
    expect(slots.map(slot => slot.id)).toEqual(expected.map(id => `frames.${id}`));
    for (const slot of slots) {
      expect(SLOT_ID.test(slot.id)).toBe(true);
      expect(slot.layer).toBe("frames");
      expect(slot.status).toBe("draft");
      expect(slot.signoff).toBeUndefined();
      expect(slot.requires).toEqual([]);
      expect(slot.contract.kind).toBe("frame");
      expect(slot.contract.members.mode).toBe("closed");
      for (const member of slot.contract.members.names) expect(MEMBER_ID.test(`${slot.id}.${member}`)).toBe(true);
      expect(new Set(slot.contract.members.names).size).toBe(slot.contract.members.names.length);
    }
  });

  it("places each leaf once under three groups and eight families", () => {
    expect(placement.layer).toBe("frames");
    expect(placement.nodes.map(node => node.id)).toEqual(["page-shells", "regions", "overlay-shells"]);
    expect(placementData.nodes[1]?.children?.map(node => node.id)).toEqual(["headers", "navigation", "panels", "footers"]);
    expect(placementFindings(placement, slots.map(slot => slot.id))).toEqual([]);
  });

  it("detects a duplicate placement even when every leaf is still present", () => {
    const mutant = structuredClone(placement);
    const group = mutant.nodes[0];
    const first = group && "children" in group ? group.children[0] : undefined;
    if (!first || !("leaves" in first)) throw new Error("Expected shell leaves");
    (first.leaves as string[]).push("frames.site-shell");
    expect(placementFindings(mutant, slots.map(slot => slot.id))).toEqual(["placement frames.site-shell: 2"]);
  });

  it("detects a missing placement", () => {
    const mutant = structuredClone(placement);
    const group = mutant.nodes[0];
    const first = group && "children" in group ? group.children[0] : undefined;
    if (!first || !("leaves" in first)) throw new Error("Expected shell leaves");
    (first.leaves as string[]).splice(0, 1);
    expect(placementFindings(mutant, slots.map(slot => slot.id))).toEqual(["placement frames.site-shell: 0"]);
  });

  it("has an acyclic frame graph and keeps section content in typed slots", () => {
    expect(compositionFindings(slots)).toEqual([]);
    for (const { contract } of slots) {
      for (const target of contract.composes ?? []) {
        expect(isValidId("slot", target)).toBe(true);
        expect(target).toMatch(/^(components|frames)\./);
      }
      expect(new Set(contract.slots.map(slot => slot.id)).size).toBe(contract.slots.length);
      for (const slot of contract.slots) expect(slot.accepts).toMatch(/^(view|host-node|components\.[a-z][a-z0-9-]*|sections\.\*)$/);
    }
    expect(byId("site-shell").slots.find(slot => slot.id === "consent")?.accepts).toBe("sections.*");
    expect(byId("app-header").slots.slice(0, 2).map(slot => slot.id)).toEqual(["brand", "context"]);
    expect(byId("app-header").slots.find(slot => slot.id === "context")?.accepts).toBe("sections.*");
  });

  it("detects cycles and unresolved frame dependencies", () => {
    const mutant = structuredClone(slots) as FrameSlot[];
    mutant.find(slot => slot.id === "frames.site-header")!.contract.composes = ["frames.site-shell"];
    expect(compositionFindings(mutant)).toEqual(["cycle frames.site-shell"]);
    mutant.find(slot => slot.id === "frames.site-header")!.contract.composes = ["frames.missing"];
    expect(compositionFindings(mutant)).toEqual(["missing frames.missing"]);
  });

  it("records roots, server boundaries and ordered shell landmarks", () => {
    expect(slots.map(slot => slot.contract.root)).toEqual(["div", "div", "header", "header", "nav", "aside", "footer", "dialog", "dialog"]);
    expect(slots.filter(slot => slot.contract.rendering === "server").map(slot => slot.id)).toEqual(["frames.site-shell", "frames.site-header", "frames.site-footer"]);
    expect(byId("site-shell").landmarks.map(item => item.role)).toEqual(["banner", "main", "contentinfo", "region"]);
    expect(byId("app-shell").landmarks.map(item => item.role)).toEqual(["banner", "navigation", "main", "complementary", "region"]);
    for (const { contract } of slots) for (const landmark of contract.landmarks) {
      expect(contract.slots.some(slot => slot.id === landmark.slot)).toBe(true);
      if (["banner", "contentinfo"].includes(landmark.role)) expect(landmark.topLevel).toBe(true);
      if (["navigation", "complementary", "region"].includes(landmark.role)) expect(landmark.nameRequired).toBe(true);
    }
    for (const id of ["site-shell", "app-shell"]) {
      const shell = byId(id);
      expect(shell.slots[0]?.id).toBe("skip-link");
      expect(shell.slots[0]?.required).toBe(true);
      expect(shell.slots.at(-1)).toEqual({ id: "toasts", required: false, accepts: "components.toast" });
      const main = shell.landmarks.filter(item => item.role === "main");
      expect(main).toHaveLength(1);
      expect(main[0]?.id).toBe(shell.skipTarget);
      expect(main[0]?.tabIndex).toBe(-1);
      expect(shell.slots.find(slot => slot.id === "main")).toEqual({ id: "main", required: true, accepts: "view" });
    }
    expect(byId("inspector").landmarks[0]?.role).toBe("complementary");
  });

  it("references existing token leaves and declares host state ports", () => {
    const tokenIds = new Set(tokenSlots.map(slot => slot.id));
    for (const { contract } of slots) {
      for (const token of contract.allowedReads.tokens) expect(tokenIds.has(token)).toBe(true);
      for (const member of contract.breakpoints) expect(member).toMatch(/^tokens\.breakpoint\.[a-z][a-z0-9-]*$/);
      for (const member of contract.layers) expect(member).toMatch(/^tokens\.z-index\.[a-z][a-z0-9-]*$/);
      expect(new Set(contract.statePorts.map(port => port.id)).size).toBe(contract.statePorts.length);
      for (const port of contract.statePorts) expect(["boolean", "number", "string"]).toContain(port.type);
    }
    expect(byId("command").layers).toEqual(["tokens.z-index.palette"]);
    expect(byId("sheet").layers).toEqual(["tokens.z-index.modal"]);
    expect(byId("app-shell").statePorts.find(port => port.id === "theme")?.values).toEqual(["system", "light", "dark"]);
  });

  it("keeps legacy aliases separate from the global retired registry", () => {
    expect(globalRetired).toEqual([]);
    expect(aliases.map(alias => [alias.id, alias.replacedBy])).toEqual([
      ["items.page-bar", "frames.app-header"], ["items.app-navigation", "frames.app-sidebar"],
      ["form.command-menu", "frames.command"], ["matrix.drawer", "frames.sheet"],
    ]);
    for (const alias of aliases) {
      expect(slots.some(slot => slot.id === alias.replacedBy)).toBe(true);
      expect(slots.some(slot => slot.id === alias.id)).toBe(false);
      expect(alias.retiredAt).toBe("2026-10-23");
    }
  });
});
