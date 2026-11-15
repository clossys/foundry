/**
 * Designer slot tree recut (foundry-build-0018): three L0s (Theme, Art, Interface) over the five layer files.
 * Target from ia-target/designer.md section 2 is 3 / 10 / 38 / 208. This unit reaches 3 / 10 / 37 / 202 live; the gap is
 * recorded as SELF-AMENDs in the build-0018 receipt:
 * - the 8 NEW themes leaves (success, warning, info, font-size, breakpoint, container, ease, duration) need slot
 *   registrations outside this unit, so Theme has 42 leaves, 11 L2 (Motion > Timing has no leaf yet);
 * - components.icon and components.logo stay live: every frame composes them, so their merge into Art needs a frame
 *   repoint first (Interface 111, not 109).
 */
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import frameSlots from "./slots/frames.json" with { type: "json" };
import {
  DESIGNER_RETIRED, DESIGNER_TREES, STUDIO_KILLED, checkTree, countTree, placedLeaves, retiredFrameReferences, starterLeaves,
  type LayerTree, type RetiredEntry,
} from "./ia/tree.js";

const here = dirname(fileURLToPath(import.meta.url));
const clone = <T>(value: T): T => structuredClone(value);
const tree = (trees: LayerTree[], layer: string) => trees.find(candidate => candidate.layer === layer)!;

const STUDIO_IDS = [
  ...["swatch", "ladder", "player", "grid", "matrix", "viewport", "passage", "copy-in-context"].map(name => `components.specimen-${name}`),
  ...["swatch", "color-ramp", "type-ladder", "spacing-ladder", "radius-ladder", "motion-player", "asset-grid", "icon-grid", "variant-matrix",
    "section-viewports", "frame-viewports", "rich-passage", "copy-in-context", "page-viewports"].map(name => `sections.specimen-${name}`),
];

describe("Designer tree counts (3 L0)", () => {
  const counts = countTree(DESIGNER_TREES, DESIGNER_RETIRED);

  it("has 3 L0, 10 L1, 37 L2 and 202 live L3 (designer.md 3/10/38/208 less the self-amended gap)", () => {
    expect({ l0: counts.l0, l1: counts.l1, l2: counts.l2, l3: counts.l3 }).toEqual({ l0: 3, l1: 10, l2: 37, l3: 202 });
  });

  it("counts per L0 in owner order: Theme, Art, Interface", () => {
    expect(counts.byL0).toEqual({
      theme: { l1: 4, l2: 11, l3: 42 },
      art: { l1: 3, l2: 10, l3: 49 },
      interface: { l1: 3, l2: 16, l3: 111 },
    });
    expect(counts.byLayer).toEqual({ themes: 42, assets: 49, components: 58, sections: 45, frames: 8 });
  });

  it("keeps every one of the 246 placed ids; 44 retire in place", () => {
    expect(counts.placed).toBe(246);
    expect(new Set(placedLeaves(DESIGNER_TREES)).size).toBe(246);
    expect(counts.retired).toBe(44);
    expect(counts.placed - counts.retired).toBe(counts.l3);
  });

  it("has no single-leaf L2 outside the three Theme families waiting on NEW leaves", () => {
    expect(counts.singleLeafL2).toEqual(["themes/colors/colors-status", "themes/typography/typography-scale", "themes/layout/layout-space"]);
  });

  it("labels the L1s by the target tree", () => {
    const labels = DESIGNER_TREES.map(layer => layer.nodes.map(node => node.label));
    expect(labels).toEqual([["Color", "Typography", "Layout", "Motion"], ["Logos", "Imagery", "Icons"], ["Components"], ["Sections"], ["Frames"]]);
  });
});

describe("Designer tree soundness", () => {
  it("passes on the committed tree", () => {
    expect(checkTree(DESIGNER_TREES, DESIGNER_RETIRED)).toEqual([]);
  });

  it("retires the 22 Studio specimen ids in place with reason studio-killed", () => {
    const byId = new Map(DESIGNER_RETIRED.map(entry => [entry.id, entry]));
    expect(STUDIO_IDS).toHaveLength(22);
    for (const id of STUDIO_IDS) {
      expect(byId.get(id)?.reason, id).toBe(STUDIO_KILLED);
      expect(placedLeaves(DESIGNER_TREES), id).toContain(id);
    }
  });

  it("mutation: a Studio id not marked retired fails", () => {
    const retired = DESIGNER_RETIRED.filter(entry => entry.id !== "sections.specimen-swatch");
    const trees = clone(DESIGNER_TREES) as LayerTree[];
    const sections = tree(trees, "sections");
    (sections as { retired: string[] }).retired = sections.retired!.filter(id => id !== "sections.specimen-swatch");
    expect(checkTree(trees, retired)).toContain("sections.specimen-swatch: Studio specimen leaf is not retired");
  });

  it("mutation: a Studio id retired for another reason fails", () => {
    const retired = clone(DESIGNER_RETIRED) as RetiredEntry[];
    retired.find(entry => entry.id === "components.specimen-grid")!.reason = "other";
    expect(checkTree(DESIGNER_TREES, retired)).toContain('components.specimen-grid: Studio specimen leaf must retire with reason "studio-killed"');
  });

  it("mutation: a retired.json id not flagged in its layer file fails", () => {
    const trees = clone(DESIGNER_TREES) as LayerTree[];
    const components = tree(trees, "components");
    (components as { retired: string[] }).retired = components.retired!.filter(id => id !== "components.dropdown-menu");
    expect(checkTree(trees, DESIGNER_RETIRED)).toContain("components.dropdown-menu: retired in retired.json but not flagged in ia/components.json");
  });

  it("mutation: a retired id removed from the tree fails (ids are never reused)", () => {
    const trees = clone(DESIGNER_TREES) as LayerTree[];
    const drop = (nodes: LayerTree["nodes"]): void => {
      for (const node of nodes) if ("leaves" in node) (node as { leaves: string[] }).leaves = node.leaves.filter(id => id !== "sections.cards"); else drop(node.children);
    };
    drop(tree(trees, "sections").nodes);
    expect(checkTree(trees, DESIGNER_RETIRED)).toEqual(expect.arrayContaining(["sections.cards: retired but not placed; a retired leaf stays placed"]));
  });

  it("mutation: a leaf placed under another layer fails", () => {
    const trees = clone(DESIGNER_TREES) as LayerTree[];
    const family = (tree(trees, "themes").nodes[0] as { children: { leaves: string[] }[] }).children[0]!;
    family.leaves = [...family.leaves, "assets.lockup"];
    expect(checkTree(trees, DESIGNER_RETIRED)).toEqual(expect.arrayContaining(["assets.lockup: placed in themes, outside its id prefix"]));
  });
});

describe("starter leaves resolve to a package default", () => {
  const fills = new Set(readdirSync(join(here, "fills")).flatMap(source => readdirSync(join(here, "fills", source)).filter(name => name.endsWith(".json")).map(name => name.slice(0, -5))));

  it("lists 131 starter leaves (themes 35, assets 29, components 35, sections 25, frames 7)", () => {
    expect(DESIGNER_TREES.map(layer => [layer.layer, layer.starter?.length ?? 0])).toEqual([["themes", 35], ["assets", 29], ["components", 35], ["sections", 25], ["frames", 7]]);
  });

  it("every starter leaf, including steps, pricing, table-of-contents and consent, has a default fill", () => {
    const starters = starterLeaves(DESIGNER_TREES);
    for (const id of ["sections.steps", "sections.pricing", "sections.table-of-contents", "sections.consent"]) expect(starters).toContain(id);
    expect(starters.filter(id => !fills.has(id))).toEqual([]);
  });

  it("mutation: a starter leaf with no default fails", () => {
    const starters = [...starterLeaves(DESIGNER_TREES), "sections.timeline-missing"];
    expect(starters.filter(id => !fills.has(id))).toEqual(["sections.timeline-missing"]);
  });
});

describe("frames never point at a retired component", () => {
  it("app-sidebar composes components.sidebar, not components.navigation-tree", () => {
    const sidebar = frameSlots.find(slot => slot.id === "frames.app-sidebar")!;
    expect(sidebar.contract.composes).toContain("components.sidebar");
    expect(JSON.stringify(sidebar.contract)).not.toContain("components.navigation-tree");
    expect(retiredFrameReferences(frameSlots as never, DESIGNER_RETIRED)).toEqual([]);
  });

  it("mutation: a frame composing a retired component fails", () => {
    const frames = clone(frameSlots) as { id: string; contract: { composes?: string[] } }[];
    frames.find(slot => slot.id === "frames.app-sidebar")!.contract.composes!.push("components.navigation-tree");
    expect(retiredFrameReferences(frames as never, DESIGNER_RETIRED)).toEqual(["frames.app-sidebar: composes retired components.navigation-tree"]);
  });

  it("site-shell consent slot accepts sections.consent only, in a named region landmark", () => {
    const shell = frameSlots.find(slot => slot.id === "frames.site-shell")!.contract as unknown as {
      slots: { id: string; accepts: string }[]; landmarks: { slot: string; role: string; nameRequired: boolean }[];
    };
    expect(shell.slots.find(slot => slot.id === "consent")?.accepts).toBe("sections.consent");
    expect(shell.slots.some(slot => slot.accepts === "sections.*")).toBe(false);
    expect(shell.landmarks.find(landmark => landmark.slot === "consent")).toMatchObject({ role: "region", nameRequired: true });
  });
});
