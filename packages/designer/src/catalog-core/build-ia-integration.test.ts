import { describe, expect, it } from "vitest";
import frameRetired from "../catalog/retired/frames.json" with { type: "json" };
import framePlacement from "../catalog/ia/frames.json" with { type: "json" };
import frameSlots from "../catalog/slots/frames.json" with { type: "json" };
import { loadSectionRegistry, loadBuildCatalog, loadCatalog, type SectionContract, type FrameContract, type LandmarkSpec, type PlacementNode } from "./index.js";

const nodes = (rows: readonly PlacementNode[]): PlacementNode[] => rows.flatMap(node => "children" in node ? [node, ...nodes(node.children)] : [node]);

describe("combined five-layer build IA", () => {
  it("exposes all 252 owner-signed draft build slots alongside the 91 runtime leaves", () => {
    // The owner-signed IA as loaded (ia-placement.test.ts OWNER_SIGNED_LEAVES = 252); the runtime leaves are its 42
    // themes and 49 assets leaves, after the 2026-11-16 IA audit dedupe (foundry-build-0032).
    const build = loadBuildCatalog();
    expect(build.registryStatus).toBe("build-unfrozen");
    expect(build.slots.filter(slot => !["assets.icon-panel-left", ...["command", "dropdown-menu", "empty", "item", "scroll-area", "sheet", "sidebar"].map(leaf => `components.${leaf}`)].includes(slot.id))).toHaveLength(244);
    expect(Object.fromEntries(["themes", "assets", "components", "sections", "frames"].map(layer => [layer, build.slots.filter(slot => slot.layer === layer).length]))).toEqual({ themes: 42, assets: 49, components: 78, sections: 71, frames: 12 });
    expect(build.slots.filter(slot => slot.layer === "sections")).toEqual(loadSectionRegistry().slots);
    expect(build.placements.find(placement => placement.layer === "sections")).toEqual(loadSectionRegistry().placement);
    expect(build.slots.filter(slot => slot.layer === "frames")).toEqual(frameSlots);
    expect(build.slots.filter(slot => slot.layer === "components")).toHaveLength(78);
    expect(build.slots.every(slot => slot.status === "draft" && slot.signoff === undefined)).toBe(true);
    expect(build.placements.find(placement => placement.layer === "frames")).toEqual(framePlacement);
    expect(build.fills).toEqual(loadCatalog().fills);
    expect(loadCatalog().slots).toHaveLength(91);
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
    // planner:C5-DREC: 13 owner retirements (D2/LAD-1/LAD-2); foundry-build-0018 adds 22 studio-killed and 6 recut ids (frames.sheet and frames.command stay live, review r1 P1);
    // foundry-build-0032 (audit P12) adds assets.icon-business and assets.icon-institution (into assets.icon-organization).
    // Frames and sections migration aliases stay separate from this global registry.
    expect(build.retired).toHaveLength(43);
    expect(build.retired.filter(entry => entry.id.startsWith("frames.")).map(entry => entry.id)).toEqual(["frames.document"]);
    expect(build.retiredByLayer.frames).toEqual(frameRetired);
    expect(build.retiredByLayer.frames).toHaveLength(4);
    expect(build.retiredByLayer.sections).toEqual(loadSectionRegistry().retired);
    expect(build.retiredByLayer.sections).toHaveLength(58);
    expect(build.aliases).toHaveLength(67);
    expect(new Set(build.aliases.map(alias => alias.id)).size).toBe(67);
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
    expect(build.placements.find(placement => placement.layer === "frames")!.nodes.map(node => node.id)).toEqual(["frames"]);
  });
});
