import themes from "./themes.json" with { type: "json" };
import assets from "./assets.json" with { type: "json" };
import components from "./components.json" with { type: "json" };
import sections from "./sections.json" with { type: "json" };
import frames from "./frames.json" with { type: "json" };
import slides from "./slides.json" with { type: "json" };
import retiredList from "../retired.json" with { type: "json" };

/**
 * The Designer slot tree as three L0s (owner order: Theme, Art, Interface). The five layer files stay the storage
 * the catalog engine loads; each file maps to one L0, and its top nodes are that L0's L1s. Interface spans three files
 * (components, sections, frames), each one L1 of it. A retired leaf stays placed so its id is never reused (owner
 * D2, `catalog-core/retired-leaves.ts`); its layer file flags it in `retired`, retired.json records why, and the live
 * tree drops it. `starter` lists the leaves a v0 site, docs or app starter consumes.
 */
export type DesignerL0 = "theme" | "art" | "interface";
export type DesignerLayer = "themes" | "assets" | "components" | "sections" | "frames";
export const LAYER_L0: Readonly<Record<DesignerLayer, DesignerL0>> = {
  themes: "theme", assets: "art", components: "interface", sections: "interface", frames: "interface",
};
export const L0_ORDER: readonly DesignerL0[] = ["theme", "art", "interface"];
export const LAYER_ORDER: readonly DesignerLayer[] = ["themes", "assets", "components", "sections", "frames"];

export type TreeNode = { id: string; label: string; children: readonly TreeNode[] } | { id: string; label: string; leaves: readonly string[] };
export interface LayerTree {
  layer: DesignerLayer;
  nodes: readonly TreeNode[];
  retired?: readonly string[];
  starter?: readonly string[];
}
export interface RetiredEntry { id: string; retiredAt: string; replacedBy?: string; decidedBy?: string; reason?: string }

/** Studio is killed (owner decision 8): its specimen slots retire in place with this reason. */
export const STUDIO_SPECIMEN = /^(?:components|sections)\.specimen-[a-z0-9-]+$/;
export const STUDIO_KILLED = "studio-killed";

/**
 * An additive IA extension (`ia/slides.json`, foundry-build-0027): families merged under an existing L1 of one layer,
 * with their starter leaves and slot contracts. The five layer files stay untouched, so the engine's registered slots
 * (src/catalog/slots) are unchanged until a later unit registers the new leaves there.
 */
export interface IAFamily { layer: DesignerLayer; l1: string; node: { id: string; label: string; leaves: readonly string[] }; starter?: readonly string[] }
export interface ExtensionSlot { kind: "frame" | "section"; variants?: Readonly<Record<string, readonly string[]>>; [key: string]: unknown }
export interface IAExtension { schema: string; id: string; owns: string; families: readonly IAFamily[]; slots: Record<string, ExtensionSlot> }

/** The layer trees with each extension family appended under its L1 and its starter leaves added. */
export function extendTrees(trees: readonly LayerTree[], extension: IAExtension): LayerTree[] {
  return trees.map(tree => {
    const families = extension.families.filter(family => family.layer === tree.layer);
    if (!families.length) return tree;
    const nodes = tree.nodes.map(node => {
      const here = families.filter(family => family.l1 === node.id);
      return here.length && !("leaves" in node) ? { ...node, children: [...node.children, ...here.map(family => family.node)] } : node;
    });
    for (const family of families) if (!tree.nodes.some(node => node.id === family.l1)) throw new Error(`${extension.id}: ${tree.layer} L1 ${family.l1} not found`);
    return { ...tree, nodes, starter: [...(tree.starter ?? []), ...families.flatMap(family => family.starter ?? [])] };
  });
}

export const DESIGNER_SLIDES: IAExtension = slides as unknown as IAExtension;
export const DESIGNER_TREES: readonly LayerTree[] = extendTrees([themes, assets, components, sections, frames] as unknown as readonly LayerTree[], DESIGNER_SLIDES);
export const DESIGNER_RETIRED: readonly RetiredEntry[] = retiredList as readonly RetiredEntry[];

const leavesOf = (nodes: readonly TreeNode[]): string[] => nodes.flatMap(node => "leaves" in node ? [...node.leaves] : leavesOf(node.children));

/** Placed leaves of every layer, retired ones included. */
export const placedLeaves = (trees: readonly LayerTree[]): string[] => trees.flatMap(tree => leavesOf(tree.nodes));

/** The tree a consumer is offered: retired leaves removed, and any node left empty dropped. */
export function liveNodes(nodes: readonly TreeNode[], retired: ReadonlySet<string>): TreeNode[] {
  const out: TreeNode[] = [];
  for (const node of nodes) {
    if ("leaves" in node) {
      const leaves = node.leaves.filter(id => !retired.has(id));
      if (leaves.length) out.push({ id: node.id, label: node.label, leaves });
    } else {
      const children = liveNodes(node.children, retired);
      if (children.length) out.push({ id: node.id, label: node.label, children });
    }
  }
  return out;
}

export interface LevelCounts { l1: number; l2: number; l3: number }
export interface TreeCounts extends LevelCounts {
  l0: number;
  placed: number;
  retired: number;
  byL0: Record<DesignerL0, LevelCounts>;
  byLayer: Record<DesignerLayer, number>;
  singleLeafL2: string[];
}

/** Counts of the live tree: L1 = top nodes of each layer file, L2 = their families, L3 = live leaves. */
export function countTree(trees: readonly LayerTree[], retired: readonly RetiredEntry[]): TreeCounts {
  const retiredIds = new Set(retired.map(entry => entry.id));
  const byL0 = Object.fromEntries(L0_ORDER.map(l0 => [l0, { l1: 0, l2: 0, l3: 0 }])) as Record<DesignerL0, LevelCounts>;
  const byLayer = Object.fromEntries(LAYER_ORDER.map(layer => [layer, 0])) as Record<DesignerLayer, number>;
  const singleLeafL2: string[] = [];
  let placed = 0;
  for (const tree of trees) {
    placed += leavesOf(tree.nodes).length;
    const counts = byL0[LAYER_L0[tree.layer]];
    for (const l1 of liveNodes(tree.nodes, retiredIds)) {
      counts.l1 += 1;
      if ("leaves" in l1) continue;
      for (const l2 of l1.children) {
        counts.l2 += 1;
        const n = "leaves" in l2 ? l2.leaves.length : 0;
        counts.l3 += n;
        byLayer[tree.layer] += n;
        if (n === 1) singleLeafL2.push(`${tree.layer}/${l1.id}/${l2.id}`);
      }
    }
  }
  const sum = (key: keyof LevelCounts) => L0_ORDER.reduce((total, l0) => total + byL0[l0][key], 0);
  return {
    l0: L0_ORDER.filter(l0 => byL0[l0].l3 > 0).length,
    l1: sum("l1"), l2: sum("l2"), l3: sum("l3"),
    placed, retired: retiredIds.size, byL0, byLayer, singleLeafL2,
  };
}

/** Soundness of the recut tree beyond the engine's IA1/IA2 and retired-leaf checks. */
export function checkTree(trees: readonly LayerTree[], retired: readonly RetiredEntry[]): string[] {
  const findings: string[] = [];
  const entries = new Map(retired.map(entry => [entry.id, entry]));
  const home = new Map<string, DesignerLayer>();
  for (const tree of trees) for (const id of leavesOf(tree.nodes)) {
    if (!id.startsWith(`${tree.layer}.`)) findings.push(`${id}: placed in ${tree.layer}, outside its id prefix`);
    if (home.has(id)) findings.push(`${id}: placed more than once`);
    home.set(id, tree.layer);
  }
  for (const layer of LAYER_ORDER) if (trees.filter(tree => tree.layer === layer).length !== 1) findings.push(`${layer}: expected one layer file`);
  for (const tree of trees) {
    for (const node of tree.nodes) if ("leaves" in node) findings.push(`${tree.layer}/${node.id}: an L1 holds families, not leaves`);
    const flagged = new Set(tree.retired ?? []);
    if (flagged.size !== (tree.retired ?? []).length) findings.push(`${tree.layer}: retired flag list has duplicates`);
    for (const id of flagged) {
      if (home.get(id) !== tree.layer) findings.push(`${id}: flagged retired in ${tree.layer} but not placed there`);
      if (!entries.has(id)) findings.push(`${id}: flagged retired in ${tree.layer} but missing from retired.json`);
    }
    for (const id of tree.starter ?? []) {
      if (home.get(id) !== tree.layer) findings.push(`${id}: starter leaf not placed in ${tree.layer}`);
      if (entries.has(id)) findings.push(`${id}: a retired leaf cannot be a starter leaf`);
    }
  }
  for (const entry of retired) {
    const layer = home.get(entry.id);
    if (layer === undefined) { findings.push(`${entry.id}: retired but not placed; a retired leaf stays placed`); continue; }
    const tree = trees.find(candidate => candidate.layer === layer);
    if (!(tree?.retired ?? []).includes(entry.id)) findings.push(`${entry.id}: retired in retired.json but not flagged in ia/${layer}.json`);
    if (entry.replacedBy !== undefined && (!home.has(entry.replacedBy) || entries.has(entry.replacedBy))) findings.push(`${entry.id}: replacedBy ${entry.replacedBy} is not a live placed leaf`);
  }
  for (const id of home.keys()) if (STUDIO_SPECIMEN.test(id)) {
    const entry = entries.get(id);
    if (!entry) findings.push(`${id}: Studio specimen leaf is not retired`);
    else if (entry.reason !== STUDIO_KILLED) findings.push(`${id}: Studio specimen leaf must retire with reason "${STUDIO_KILLED}"`);
  }
  return findings;
}

/** Live starter leaves, per layer. */
export const starterLeaves = (trees: readonly LayerTree[]): string[] => trees.flatMap(tree => [...(tree.starter ?? [])]);

/** Ids a frame contract names (composes and slot accepts) that are retired component leaves. */
export function retiredFrameReferences(
  frameSlots: readonly { id: string; contract: { composes?: readonly string[]; slots?: readonly { id: string; accepts: string }[] } }[],
  retired: readonly RetiredEntry[],
): string[] {
  const retiredIds = new Set(retired.map(entry => entry.id));
  const findings: string[] = [];
  for (const frame of frameSlots) {
    for (const id of frame.contract.composes ?? []) if (id.startsWith("components.") && retiredIds.has(id)) findings.push(`${frame.id}: composes retired ${id}`);
    for (const slot of frame.contract.slots ?? []) if (slot.accepts.startsWith("components.") && retiredIds.has(slot.accepts)) findings.push(`${frame.id}: slot ${slot.id} accepts retired ${slot.accepts}`);
  }
  return findings;
}

/** A package default, `src/catalog/defaults/<slot-id>/<name>-v1.json`: a clossys.candidate/1 header over a shadcn registry item. */
export interface DefaultFile {
  clossys: { id: string; slot: string; source: { kind: string }; [key: string]: unknown };
  content: { variants?: Readonly<Record<string, readonly string[]>>; files?: readonly { path: string; content: string }[]; [key: string]: unknown };
}

/** Every extension leaf has a slot contract and a package default; every variant value its contract declares is covered by one. */
export function extensionDefaultFindings(extension: IAExtension, defaults: ReadonlyMap<string, readonly DefaultFile[]>): string[] {
  const findings: string[] = [];
  for (const id of extension.families.flatMap(family => family.node.leaves)) {
    const contract = extension.slots[id];
    if (!contract) findings.push(`${id}: placed with no slot contract`);
    const files = defaults.get(id) ?? [];
    if (!files.length) { findings.push(`${id}: no package default`); continue; }
    for (const file of files) if (file.clossys.slot !== `designer/${id}` || file.clossys.source.kind !== "package-default") findings.push(`${file.clossys.id}: not a package default of designer/${id}`);
    for (const [axis, values] of Object.entries(contract?.variants ?? {})) for (const value of values) {
      if (!files.some(file => file.content.variants?.[axis]?.includes(value))) findings.push(`${id}: variant ${axis}=${value} has no package default`);
    }
  }
  return findings;
}

/** JSX text in a default's source: words come from Writer through the `copy` prop, never from the default. */
export function literalCopyFindings(file: DefaultFile): string[] {
  const findings: string[] = [];
  const slot = file.clossys.slot.replace(/^designer\//, "");
  (file.content.files ?? []).forEach((source, index) => {
    for (const match of source.content.matchAll(/>([^<>{}]*[A-Za-z][^<>{}]*)</g)) {
      const text = match[1]!.trim();
      if (text) findings.push(`${slot}: literal text "${text}" in files[${index}]; words come from the copy prop`);
    }
  });
  return findings;
}
