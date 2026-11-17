/**
 * Designer slot tree recut (foundry-build-0018): three L0s (Theme, Art, Interface) over the five layer files.
 * Target from ia-target/designer.md section 2 is 3 / 10 / 38 / 208. This unit reaches 3 / 10 / 37 / 205 live; the gap is
 * recorded as SELF-AMENDs in the build-0018 receipt:
 * - the 8 NEW themes leaves (success, warning, info, font-size, breakpoint, container, ease, duration) need slot
 *   registrations outside this unit, so Theme has 42 leaves, 11 L2 (Motion > Timing has no leaf yet);
 * - components.icon and components.logo stay live: every frame composes them, so their merge into Art needs a frame
 *   repoint first;
 * - components.navigation-tree stays live: frames.app-sidebar's tree slot now accepts components.sidebar, but the
 *   AppNavigation fill still renders NavigationTree, so the frame truthfully composes both until that render moves
 *   (Interface 114 before Slides, not 109);
 * - frames.sheet and frames.command stay live (review r1 P1): app-shell, app-sidebar and inspector compose them, so their
 *   merge into components.sheet and components.command waits for the same frame repoint.
 *
 * foundry-build-0032 (owner 2026-11-16, "go with your recommendation"; ia-audit 2026-11-16 P3, P9, P12) re-pins:
 * - frames.deck is registered in the frames layer (frames 11 placed -> 12; still 11 live, since it was already counted
 *   through the Slides extension), and the six sections.slide-* retire in place into medium configs of their live twins
 *   (sections 51 live -> 45; sections stay 66 placed);
 * - assets.icon-business and assets.icon-institution retire into configs of assets.icon-organization (assets 49 -> 47);
 * - so live L3 is 212 -> 204 and retirements 41 -> 49; placed stays 253. Sections starters drop the six slides (31 -> 25).
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import frameSlots from "./slots/frames.json" with { type: "json" };
import sectionSlots from "./slots/sections.json" with { type: "json" };
import framesIa from "./ia/frames.json" with { type: "json" };
import themesIa from "./ia/themes.json" with { type: "json" };
import assetsIa from "./ia/assets.json" with { type: "json" };
import componentsIa from "./ia/components.json" with { type: "json" };
import sectionsIa from "./ia/sections.json" with { type: "json" };
import slotDefaults from "./slot-defaults.json" with { type: "json" };
import {
  DESIGNER_RETIRED, DESIGNER_SLIDES, DESIGNER_TREES, STUDIO_KILLED, checkTree, countTree, extensionDefaultFindings, extensionRetiredFindings, extendTrees,
  literalCopyFindings, placedLeaves, retiredFrameReferences, slotDefaultFindings, starterLeaves,
  type DefaultFile, type IAExtension, type LayerTree, type MediumSlot, type RetiredEntry,
} from "./ia/tree.js";

const here = dirname(fileURLToPath(import.meta.url));
/**
 * Package defaults (build-0027, fix-0027-r1): `src/catalog/defaults/<slot-id>/<name>-v1.json`, keyed by slot id. This is
 * the folder the package ships (`files` lists `src`) and the one Producer's resolver reads for Designer.
 */
const packageRoot = join(here, "..", "..");
const defaultsDir = join(here, "defaults");
/** The seven Slides defaults, by their path in the package. */
const SLIDES_DEFAULT_PATHS = [
  "src/catalog/defaults/frames.deck/canvas-v1.json",
  ...["title", "agenda", "statement", "two-column", "quote", "closing"].map(kind => `src/catalog/defaults/sections.slide-${kind}/standard-v1.json`),
];
const packageDefaults = new Map<string, DefaultFile[]>((existsSync(defaultsDir) ? readdirSync(defaultsDir) : []).sort().map(id => [id,
  readdirSync(join(defaultsDir, id)).filter(name => name.endsWith(".json")).sort().map(name => JSON.parse(readFileSync(join(defaultsDir, id, name), "utf8")) as DefaultFile)]));
const clone = <T>(value: T): T => structuredClone(value);
const tree = (trees: LayerTree[], layer: string) => trees.find(candidate => candidate.layer === layer)!;
const baseTrees = [themesIa, assetsIa, componentsIa, sectionsIa, framesIa] as unknown as readonly LayerTree[];

const STUDIO_IDS = [
  ...["swatch", "ladder", "player", "grid", "matrix", "viewport", "passage", "copy-in-context"].map(name => `components.specimen-${name}`),
  ...["swatch", "color-ramp", "type-ladder", "spacing-ladder", "radius-ladder", "motion-player", "asset-grid", "icon-grid", "variant-matrix",
    "section-viewports", "frame-viewports", "rich-passage", "copy-in-context", "page-viewports"].map(name => `sections.specimen-${name}`),
];

describe("Designer tree counts (3 L0)", () => {
  const counts = countTree(DESIGNER_TREES, DESIGNER_RETIRED);

  it("has 3 L0, 10 L1, 38 L2 and 204 live L3 (39 L2 and 212 L3 before build-0032: six slides and two entity icons retire in place, and the slides L2 holds only retired leaves so it no longer counts)", () => {
    expect({ l0: counts.l0, l1: counts.l1, l2: counts.l2, l3: counts.l3 }).toEqual({ l0: 3, l1: 10, l2: 38, l3: 204 });
  });

  it("counts per L0 in owner order: Theme, Art, Interface", () => {
    expect(counts.byL0).toEqual({
      theme: { l1: 4, l2: 11, l3: 42 },
      art: { l1: 3, l2: 10, l3: 47 },
      interface: { l1: 3, l2: 17, l3: 115 },
    });
    expect(counts.byLayer).toEqual({ themes: 42, assets: 47, components: 59, sections: 45, frames: 11 });
  });

  it("keeps every one of the 253 placed ids; 49 retire in place", () => {
    expect(counts.placed).toBe(253);
    expect(new Set(placedLeaves(DESIGNER_TREES)).size).toBe(253);
    expect(counts.retired).toBe(49);
    expect(counts.placed - counts.retired).toBe(counts.l3);
  });

  it("has no single-leaf L2 outside the three Theme families waiting on NEW leaves and the one deck frame", () => {
    expect(counts.singleLeafL2).toEqual(["themes/colors/colors-status", "themes/typography/typography-sizes", "themes/layout/layout-space", "frames/frames/frames-deck"]);
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
  const fills = new Set([
    ...readdirSync(join(here, "fills")).flatMap(source => readdirSync(join(here, "fills", source)).filter(name => name.endsWith(".json")).map(name => name.slice(0, -5))),
    ...packageDefaults.keys(),
  ]);

  it("lists 132 starter leaves (themes 35, assets 29, components 35, sections 25, frames 8; the six retired slides left)", () => {
    expect(DESIGNER_TREES.map(layer => [layer.layer, layer.starter?.length ?? 0])).toEqual([["themes", 35], ["assets", 29], ["components", 35], ["sections", 25], ["frames", 8]]);
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
  it("app-sidebar's tree slot accepts components.sidebar and the frame composes it", () => {
    const sidebar = frameSlots.find(slot => slot.id === "frames.app-sidebar")!.contract as unknown as { composes: string[]; slots: { id: string; accepts: string }[] };
    expect(sidebar.composes).toContain("components.sidebar");
    expect(sidebar.slots.find(slot => slot.id === "tree")?.accepts).toBe("components.sidebar");
    expect(retiredFrameReferences(frameSlots as never, DESIGNER_RETIRED)).toEqual([]);
  });

  it("mutation: a frame composing a retired component fails", () => {
    const frames = clone(frameSlots) as { id: string; contract: { composes?: string[] } }[];
    frames.find(slot => slot.id === "frames.app-sidebar")!.contract.composes!.push("components.dropdown-menu");
    expect(retiredFrameReferences(frames as never, DESIGNER_RETIRED)).toEqual(["frames.app-sidebar: composes retired components.dropdown-menu"]);
  });

  it("mutation: a frame slot accepting a retired component fails", () => {
    const frames = clone(frameSlots) as { id: string; contract: { slots?: { id: string; accepts: string }[] } }[];
    frames.find(slot => slot.id === "frames.app-sidebar")!.contract.slots!.find(slot => slot.id === "tree")!.accepts = "components.canvas-map";
    expect(retiredFrameReferences(frames as never, DESIGNER_RETIRED)).toEqual(["frames.app-sidebar: slot tree accepts retired components.canvas-map"]);
  });

  it("frames.sheet and frames.command stay live: app-shell, app-sidebar and inspector compose them (review r1 P1)", () => {
    const frames = tree(DESIGNER_TREES as LayerTree[], "frames");
    const retiredIds = new Set(DESIGNER_RETIRED.map(entry => entry.id));
    for (const id of ["frames.sheet", "frames.command"]) {
      expect(retiredIds.has(id), id).toBe(false);
      expect(frames.retired ?? [], id).not.toContain(id);
      expect(placedLeaves(DESIGNER_TREES), id).toContain(id);
    }
    expect(checkTree(DESIGNER_TREES, DESIGNER_RETIRED)).toEqual([]);
  });

  it("mutation: a frame composing a retired leaf of another layer (frames, sections) fails", () => {
    const frames = clone(frameSlots) as { id: string; contract: { composes?: string[]; slots?: { id: string; accepts: string }[] } }[];
    frames.find(slot => slot.id === "frames.app-shell")!.contract.composes!.push("frames.document");
    frames.find(slot => slot.id === "frames.site-shell")!.contract.slots!.find(slot => slot.id === "consent")!.accepts = "sections.cards";
    expect(retiredFrameReferences(frames as never, DESIGNER_RETIRED)).toEqual([
      "frames.site-shell: slot consent accepts retired sections.cards",
      "frames.app-shell: composes retired frames.document",
    ]);
  });

  it("mutation: re-retiring frames.sheet fails the frame reference check", () => {
    const retired: RetiredEntry[] = [...DESIGNER_RETIRED, { id: "frames.sheet", retiredAt: "2026-11-15", decidedBy: "mutation", reason: "mutation" } as RetiredEntry];
    expect(retiredFrameReferences(frameSlots as never, retired)).toEqual([
      "frames.app-shell: composes retired frames.sheet",
      "frames.app-sidebar: composes retired frames.sheet",
      "frames.inspector: composes retired frames.sheet",
    ]);
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

describe("Slides: frames.deck registered, six slide sections retired into their twins (build-0027, build-0032 P3)", () => {
  const SLIDE_SECTIONS = ["title", "agenda", "statement", "two-column", "quote", "closing"].map(kind => `sections.slide-${kind}`);
  const TWINS = {
    "sections.slide-title": "sections.hero", "sections.slide-agenda": "sections.table-of-contents", "sections.slide-statement": "sections.content",
    "sections.slide-two-column": "sections.content", "sections.slide-quote": "sections.testimonials", "sections.slide-closing": "sections.call-to-action",
  };
  const mediumSlots = [...sectionSlots, ...frameSlots] as unknown as MediumSlot[];

  it("places frames.deck in ia/frames.json as a starter and keeps the six slides placed, retired and off the starter list", () => {
    const frames = tree(DESIGNER_TREES as LayerTree[], "frames");
    const sections = tree(DESIGNER_TREES as LayerTree[], "sections");
    expect((framesIa.nodes[0] as { children: { id: string; leaves: string[] }[] }).children.find(node => node.id === "frames-deck")?.leaves).toEqual(["frames.deck"]);
    expect(framesIa.starter).toContain("frames.deck");
    expect(DESIGNER_SLIDES.families.map(family => family.layer)).toEqual(["sections"]);
    expect((sections.nodes[0] as { children: { id: string; leaves: string[] }[] }).children.find(node => node.id === "sections-slides")?.leaves).toEqual(SLIDE_SECTIONS);
    expect(starterLeaves(DESIGNER_TREES)).toContain("frames.deck");
    for (const id of SLIDE_SECTIONS) {
      expect(starterLeaves(DESIGNER_TREES), id).not.toContain(id);
      expect(sections.retired, id).toContain(id);
    }
    expect(frames.retired ?? []).not.toContain("frames.deck");
    expect(Object.fromEntries(DESIGNER_RETIRED.filter(entry => SLIDE_SECTIONS.includes(entry.id)).map(entry => [entry.id, entry.replacedBy]))).toEqual(TWINS);
  });

  it("frames.deck has one registered contract: a main slide region accepting one section, 16:9 only", () => {
    const deck = frameSlots.find(slot => slot.id === "frames.deck")!.contract as unknown as { root: string; slots: { id: string; accepts: string }[]; members: { names: string[] } };
    expect(deck).toMatchObject({ root: "main", slots: [{ id: "slide", required: true, accepts: "sections.*" }], members: { mode: "closed", names: ["aspect.16-9"] } });
    expect(DESIGNER_SLIDES.slots["frames.deck"]).toMatchObject({ kind: "frame", root: "main", canvas: { aspect: "16:9" }, chrome: [], variants: { aspect: ["16:9"] } });
    expect(packageDefaults.get("frames.deck")?.map(file => file.clossys.source.kind)).toEqual(["package-default"]);
  });

  it("each retired slide names a live twin that declares the slide medium", () => {
    expect(extensionRetiredFindings(DESIGNER_SLIDES, DESIGNER_TREES, mediumSlots)).toEqual([]);
    for (const twin of new Set(Object.values(TWINS))) expect(sectionSlots.find(slot => slot.id === twin)?.contract, twin).toMatchObject({ media: ["slide", "web"] });
    for (const id of SLIDE_SECTIONS) expect(DESIGNER_SLIDES.slots[id], id).toMatchObject({ kind: "section", media: ["slide", "web"], variants: { medium: ["web", "slide"] } });
  });

  it("mutation: a twin without the slide medium, a retired twin, a cross-layer twin and a slide left as a starter each fail", () => {
    const flat = clone(mediumSlots);
    delete (flat.find(slot => slot.id === "sections.hero")!.contract as { media?: string[] }).media;
    expect(extensionRetiredFindings(DESIGNER_SLIDES, DESIGNER_TREES, flat)).toEqual(["sections.slide-title: twin sections.hero does not declare medium slide"]);
    const slides = clone(DESIGNER_SLIDES) as IAExtension;
    (slides.retired as RetiredEntry[]).find(entry => entry.id === "sections.slide-agenda")!.replacedBy = "sections.cards";
    (slides.retired as RetiredEntry[]).find(entry => entry.id === "sections.slide-quote")!.replacedBy = "frames.deck";
    const family = slides.families[0] as { starter?: string[] };
    family.starter = [...(family.starter ?? []), "sections.slide-closing"];
    expect(extensionRetiredFindings(slides, DESIGNER_TREES, mediumSlots)).toEqual([
      "sections.slide-agenda: twin sections.cards is retired",
      "sections.slide-agenda: twin sections.cards does not declare medium slide",
      "sections.slide-quote: twin frames.deck is in another layer",
      "sections.slide-quote: twin frames.deck does not declare medium slide",
      "sections.slide-closing: retired but still a starter",
    ]);
  });

  it("mutation: a slide retirement missing from the extension fails the tree check", () => {
    const slides = clone(DESIGNER_SLIDES) as IAExtension;
    (slides as { retired: RetiredEntry[] }).retired = slides.retired!.filter(entry => entry.id !== "sections.slide-quote");
    const trees = extendTrees(baseTrees, slides);
    expect(checkTree(trees, DESIGNER_RETIRED)).toContain("sections.slide-quote: retired in retired.json but not flagged in ia/sections.json");
  });

  it("every Slides leaf and every variant it declares has a package default", () => {
    expect(extensionDefaultFindings(DESIGNER_SLIDES, packageDefaults)).toEqual([]);
    for (const id of ["frames.deck", ...SLIDE_SECTIONS]) expect(packageDefaults.get(id)?.[0]?.clossys.source.kind, id).toBe("package-default");
  });

  it("the packed package ships all seven Slides defaults (npm pack --dry-run)", () => {
    const out = execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], { cwd: packageRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 });
    const packed = new Set((JSON.parse(out) as { files: { path: string }[] }[])[0]!.files.map(file => file.path));
    expect(SLIDES_DEFAULT_PATHS.filter(path => !packed.has(path))).toEqual([]);
    expect([...packageDefaults].flatMap(([id, files]) => files.map(file => `src/catalog/defaults/${id}/${file.clossys.id.split(":").pop()}`)).sort()).toEqual([...SLIDES_DEFAULT_PATHS].sort());
  }, 120_000);

  it("defaults hold no literal copy: words come from Writer through the copy prop", () => {
    for (const [id, files] of packageDefaults) for (const file of files) expect(literalCopyFindings(file), id).toEqual([]);
  });

  it("mutation: a slide medium variant without a default fails", () => {
    const slides = clone(DESIGNER_SLIDES) as IAExtension;
    (slides.slots["sections.slide-title"]!.variants as Record<string, string[]>).medium!.push("print");
    expect(extensionDefaultFindings(slides, packageDefaults)).toEqual(["sections.slide-title: variant medium=print has no package default"]);
  });

  it("mutation: a further extension leaf without a default fails", () => {
    const slides = clone(DESIGNER_SLIDES) as IAExtension;
    (slides.families[0]!.node.leaves as string[]).push("sections.slide-extra");
    slides.slots["sections.slide-extra"] = clone(slides.slots["sections.slide-title"]!);
    expect(extensionDefaultFindings(slides, packageDefaults)).toContain("sections.slide-extra: no package default");
  });

  it("mutation: literal copy in a slide default fails", () => {
    const file = clone(packageDefaults.get("sections.slide-title")![0]!);
    const item = file.content as { files: { content: string }[] };
    item.files[0]!.content = item.files[0]!.content.replace("{copy.heading}", "Welcome to our company");
    expect(literalCopyFindings(file)).toEqual(["sections.slide-title: literal text \"Welcome to our company\" in files[0]; words come from the copy prop"]);
  });

  it("mutation: an extension family under an L1 the layer does not have fails", () => {
    const slides = clone(DESIGNER_SLIDES) as IAExtension;
    slides.families[0]!.l1 = "sections-missing";
    expect(() => extendTrees(DESIGNER_TREES, slides)).toThrow("slides: sections L1 sections-missing not found");
  });
});

describe("slot-defaults.json carries live leaves only (build-0032, audit P9)", () => {
  const rows = (slotDefaults as { slots: Record<string, unknown> }).slots;

  it("has one row per live placed leaf, frames.deck included, and none for a retired leaf", () => {
    expect(Object.keys(rows)).toHaveLength(204);
    expect(rows["frames.deck"]).toEqual({ standard: "frame" });
    expect(slotDefaultFindings(rows, DESIGNER_TREES, DESIGNER_RETIRED)).toEqual([]);
  });

  it("mutation: a row for a retired leaf, a row for an unplaced id and a live leaf with no row each fail", () => {
    const { "sections.hero": _hero, ...rest } = rows;
    const mutated = { ...rest, "sections.cards": { standard: "section.site" }, "sections.unplaced": { standard: "section.site" } };
    expect(slotDefaultFindings(mutated, DESIGNER_TREES, DESIGNER_RETIRED)).toEqual([
      "sections.cards: retired, but slot-defaults.json still has a row",
      "sections.unplaced: slot-defaults.json row for a leaf that is not placed",
      "sections.hero: live leaf with no slot-defaults.json row",
    ]);
  });
});
