import { describe, expect, it } from "vitest";
import frameRetired from "../catalog/retired/frames.json" with { type: "json" };
import framePlacement from "../catalog/ia/frames.json" with { type: "json" };
import frameSlots from "../catalog/slots/frames.json" with { type: "json" };
import { loadSectionRegistry, loadBuildCatalog, loadCatalog, type SectionContract, type FrameContract, type LandmarkSpec, type PlacementNode } from "./index.js";

const nodes = (rows: readonly PlacementNode[]): PlacementNode[] => rows.flatMap(node => "children" in node ? [node, ...nodes(node.children)] : [node]);

describe("combined five-layer build IA", () => {
  it("exposes all 211 draft build slots alongside the 98 runtime leaves", () => {
    const build = loadBuildCatalog();
    expect(build.registryStatus).toBe("build-unfrozen");
    expect(build.slots).toHaveLength(211);
    expect(Object.fromEntries(["tokens", "assets", "components", "sections", "frames"].map(layer => [layer, build.slots.filter(slot => slot.layer === layer).length]))).toEqual({ tokens: 53, assets: 45, components: 59, sections: 45, frames: 9 });
    expect(build.slots.filter(slot => slot.layer === "sections")).toEqual(loadSectionRegistry().slots);
    expect(build.placements.find(placement => placement.layer === "sections")).toEqual(loadSectionRegistry().placement);
    expect(build.slots.filter(slot => slot.layer === "frames")).toEqual(frameSlots);
    expect(build.slots.filter(slot => slot.layer === "components")).toHaveLength(59);
    expect(build.slots.every(slot => slot.status === "draft" && slot.signoff === undefined)).toBe(true);
    expect(build.placements.find(placement => placement.layer === "frames")).toEqual(framePlacement);
    expect(build.fills).toEqual(loadCatalog().fills);
    expect(loadCatalog().slots).toHaveLength(98);
  });

  it("exports the section contract while preserving unresolved band rhythm", () => {
    const band = loadBuildCatalog().slots.find(slot => slot.id === "sections.band")!;
    if (band.contract.kind !== "section") throw new Error("expected section contract");
    const contract: SectionContract = band.contract;
    expect(contract.unresolvedMemberAxes).toContain("rhythm");
    expect(contract.members.names.some(name => name.startsWith("rhythm."))).toBe(false);
  });

  it("exports typed frame contracts and landmarks for admin inspection", () => {
    const shell = loadBuildCatalog().slots.find(slot => slot.id === "frames.site-shell")!;
    if (shell.contract.kind !== "frame") throw new Error("expected frame contract");
    const contract: FrameContract = shell.contract;
    const main: LandmarkSpec = contract.landmarks.find(landmark => landmark.role === "main")!;
    expect(main.id).toBe(contract.skipTarget);
    expect(contract.rendering).toBe("server");
  });

  it("keeps frame migration evidence owned and separate from global retirements", () => {
    const build = loadBuildCatalog();
    expect(build.retired).toEqual([]);
    expect(build.retiredByLayer.frames).toEqual(frameRetired);
    expect(build.retiredByLayer.frames).toHaveLength(4);
    expect(build.retiredByLayer.sections).toEqual(loadSectionRegistry().retired);
    expect(build.retiredByLayer.sections).toHaveLength(57);
    expect(build.aliases).toHaveLength(66);
    expect(new Set(build.aliases.map(alias => alias.id)).size).toBe(66);
    const ids = new Set(build.slots.map(slot => slot.id));
    expect(build.aliases.every(alias => ids.has(alias.target) && !ids.has(alias.id))).toBe(true);
    const frame = build.slots.find(slot => slot.layer === "frames")!;
    frame.id = "frames.changed";
    const mapping = build.retiredByLayer.frames![0]!;
    mapping.replacedBy = "frames.changed";
    expect(loadBuildCatalog().slots.some(slot => slot.id === "frames.changed")).toBe(false);
    expect(loadBuildCatalog().retiredByLayer.frames).toEqual(frameRetired);
  });

  it("organizes all five layers by domain without tier, library or lifecycle branches", () => {
    const build = loadBuildCatalog();
    const forbidden = new Set(["scale", "role", "tier", "library", "libraries", "foundry", "shadcn", "lifecycle", "draft", "stable", "adopted", "authored", "composed", "derived"]);
    for (const placement of build.placements) {
      for (const node of nodes(placement.nodes)) {
        expect(forbidden.has(node.id.toLowerCase()), `${placement.layer}.${node.id}`).toBe(false);
        expect(forbidden.has(node.label.toLowerCase()), `${placement.layer}.${node.label}`).toBe(false);
      }
    }
    expect(build.placements.find(placement => placement.layer === "frames")!.nodes.map(node => node.id)).toEqual(["page-shells", "regions", "overlay-shells"]);
  });
});
