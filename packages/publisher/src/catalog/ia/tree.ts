import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import composition from "./composition.json" with { type: "json" };
import directory from "./directory.json" with { type: "json" };
import release from "./release.json" with { type: "json" };
import retiredList from "../retired.json" with { type: "json" };

/**
 * The Publisher slot tree (ia-target/publisher.md section 2): three L0s, Composition, Directory and Release, one file
 * each. A node id is `<l0>/<l1>[/<l2>]`; L3 leaves are slot ids. A `parked` node parks every leaf under it; there are no
 * other-live Publisher L3s, so every live leaf is a starter leaf. Each file also holds the slot contract of its leaves
 * (`slots`): a layout's frame and roles, a chrome unit and its copy record, a page's path and allowed layouts, a release's
 * exports and gates. Publisher assembles only: no contract holds words or styling.
 */
export type PublisherL0 = "composition" | "directory" | "release";
export const L0_ORDER: readonly PublisherL0[] = ["composition", "directory", "release"];

export interface TreeNode {
  id: string;
  label: string;
  parked?: boolean;
  publication?: string;
  children?: readonly TreeNode[];
  leaves?: readonly string[];
}

export interface RoleContract { kinds: readonly string[]; required: boolean }
export interface LayoutSlot { kind: "layout"; purpose: string; parked?: boolean; frame?: string; chrome?: readonly string[]; roles?: Readonly<Record<string, RoleContract>> }
export interface ChromeSlot { kind: "chrome"; purpose: string; frame: string; unit: string; parts?: readonly string[]; within?: string; copy: string; publications: readonly string[] }
export interface PageSlot {
  kind: "page"; publication: string; parked?: boolean; path?: string; status?: number; collection?: string;
  layouts: readonly string[]; records?: { pattern: string; meta: string };
}
export interface ReleaseSlot { kind: "release"; publication: string; parked?: boolean; exports?: readonly { kind: string; pages?: readonly string[] }[]; gates?: readonly string[]; signoff?: { by: string; raise: string } }
export type SlotContract = LayoutSlot | ChromeSlot | PageSlot | ReleaseSlot;

export interface L0Tree {
  schema: string;
  l0: PublisherL0;
  label: string;
  owns: string;
  nodes: readonly TreeNode[];
  slots: Readonly<Record<string, SlotContract>>;
  retired?: readonly string[];
}
export interface RetiredEntry { id: string; retiredAt: string; replacedBy?: string; decidedBy?: string; reason?: string }

export const PUBLISHER_TREES: readonly L0Tree[] = [composition, directory, release] as unknown as readonly L0Tree[];
export const PUBLISHER_RETIRED: readonly RetiredEntry[] = retiredList as readonly RetiredEntry[];

/** The slot-id prefixes each L0 owns. */
export const L0_PREFIXES: Readonly<Record<PublisherL0, readonly string[]>> = {
  composition: ["layout.", "chrome."], directory: ["page."], release: ["release."],
};
export const SLOT_ID = /^[a-z][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*){1,3}$/;

export interface PlacedLeaf { id: string; l0: PublisherL0; l1: string; l2: string; parked: boolean }

/** Every leaf, with the node path that places it and whether a parked node parks it. */
export function placedLeaves(trees: readonly L0Tree[] = PUBLISHER_TREES): PlacedLeaf[] {
  const out: PlacedLeaf[] = [];
  for (const tree of trees) for (const l1 of tree.nodes) for (const l2 of l1.children ?? []) for (const id of l2.leaves ?? []) {
    out.push({ id, l0: tree.l0, l1: l1.id, l2: l2.id, parked: Boolean(l1.parked || l2.parked) });
  }
  return out;
}

export interface LiveParked { live: number; parked: number }
export interface L0Counts { l1: LiveParked; l2: LiveParked; l3: LiveParked }
export interface TreeCounts { l0: number; total: L0Counts; byL0: Record<PublisherL0, L0Counts> }

/** Counts per publisher.md section 2 "Counts": live and parked per level; a leaf under a parked node is parked. */
export function countTree(trees: readonly L0Tree[] = PUBLISHER_TREES): TreeCounts {
  const zero = (): L0Counts => ({ l1: { live: 0, parked: 0 }, l2: { live: 0, parked: 0 }, l3: { live: 0, parked: 0 } });
  const byL0 = Object.fromEntries(L0_ORDER.map(l0 => [l0, zero()])) as Record<PublisherL0, L0Counts>;
  for (const tree of trees) {
    const counts = byL0[tree.l0];
    for (const l1 of tree.nodes) {
      counts.l1[l1.parked ? "parked" : "live"] += 1;
      for (const l2 of l1.children ?? []) {
        const parked = Boolean(l1.parked || l2.parked);
        counts.l2[parked ? "parked" : "live"] += 1;
        counts.l3[parked ? "parked" : "live"] += (l2.leaves ?? []).length;
      }
    }
  }
  const total = zero();
  for (const l0 of L0_ORDER) for (const level of ["l1", "l2", "l3"] as const) {
    total[level].live += byL0[l0][level].live;
    total[level].parked += byL0[l0][level].parked;
  }
  return { l0: L0_ORDER.filter(l0 => byL0[l0].l3.live > 0).length, total, byL0 };
}

/** Live (starter) leaves: placed, not parked, not retired. */
export function starterLeaves(trees: readonly L0Tree[] = PUBLISHER_TREES, retired: readonly RetiredEntry[] = PUBLISHER_RETIRED): string[] {
  const gone = new Set(retired.map(entry => entry.id));
  return placedLeaves(trees).filter(leaf => !leaf.parked && !gone.has(leaf.id)).map(leaf => leaf.id);
}

/** The contract of one slot id, from whichever L0 file holds it. */
export function slotContract(id: string, trees: readonly L0Tree[] = PUBLISHER_TREES): SlotContract | undefined {
  for (const tree of trees) if (Object.hasOwn(tree.slots, id)) return tree.slots[id];
  return undefined;
}

/** Soundness of the tree: ids, prefixes, node ids, one contract per leaf, parked marks agree, retired ids never placed. */
export function checkTree(trees: readonly L0Tree[] = PUBLISHER_TREES, retired: readonly RetiredEntry[] = PUBLISHER_RETIRED): string[] {
  const findings: string[] = [];
  for (const l0 of L0_ORDER) if (trees.filter(tree => tree.l0 === l0).length !== 1) findings.push(`${l0}: expected one L0 file`);
  const seen = new Set<string>();
  const gone = new Set(retired.map(entry => entry.id));
  for (const tree of trees) {
    for (const l1 of tree.nodes) {
      if (!l1.id.startsWith(`${tree.l0}/`) || l1.id.split("/").length !== 2) findings.push(`${l1.id}: L1 node id is not ${tree.l0}/<l1>`);
      if (l1.leaves) findings.push(`${l1.id}: an L1 holds L2 nodes, not leaves`);
      for (const l2 of l1.children ?? []) {
        if (!l2.id.startsWith(`${l1.id}/`) || l2.id.split("/").length !== 3) findings.push(`${l2.id}: L2 node id is not ${l1.id}/<l2>`);
        if (l2.children) findings.push(`${l2.id}: an L2 holds leaves, not nodes`);
      }
    }
    const placedHere = new Set<string>();
    for (const leaf of placedLeaves([tree])) {
      if (!SLOT_ID.test(leaf.id)) findings.push(`${leaf.id}: not a slot id`);
      if (!L0_PREFIXES[tree.l0].some(prefix => leaf.id.startsWith(prefix))) findings.push(`${leaf.id}: placed in ${tree.l0}, outside its id prefix`);
      if (seen.has(leaf.id)) findings.push(`${leaf.id}: placed more than once`);
      if (gone.has(leaf.id)) findings.push(`${leaf.id}: retired id placed in the tree; retired ids are never reused`);
      seen.add(leaf.id);
      placedHere.add(leaf.id);
      const contract = tree.slots[leaf.id];
      if (!contract) { findings.push(`${leaf.id}: placed with no slot contract`); continue; }
      if (Boolean(contract.parked) !== leaf.parked) findings.push(`${leaf.id}: contract parked=${Boolean(contract.parked)} but its node parked=${leaf.parked}`);
      const kind = leaf.id.slice(0, leaf.id.indexOf("."));
      if (contract.kind !== kind) findings.push(`${leaf.id}: contract kind ${contract.kind} is not ${kind}`);
    }
    for (const id of Object.keys(tree.slots)) if (!placedHere.has(id)) findings.push(`${id}: slot contract in ${tree.l0} but not placed in its tree`);
  }
  return findings;
}

// ---------- Package defaults and starters (outside src/, read from the package root) ----------

/** The package root: three directories above this file, from src/catalog/ia/ and dist/catalog/ia/ alike. */
export const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
export const STARTER_IDS = ["site", "docs", "app"] as const;
export type StarterId = (typeof STARTER_IDS)[number];

export interface CandidateFile<C = Record<string, unknown>> { clossys: Record<string, unknown> & { id: string; slot: string; source: { kind: string } }; content: C }
export interface PlacedSection { role: string; use: string; variant?: Record<string, string>; copy: string; links?: Record<string, string> }
export interface PageOption { path?: string; status?: number; collection?: string; layout: string; sections: PlacedSection[]; meta: { copy: string; indexing: string } }
export interface LayoutOption { frame: string; chrome: string[]; order: string[]; required: string[] }
export interface StarterPublication {
  schema: string; id: StarterId; node: string; root: string; pages: string[]; layouts: string[]; chrome: string[];
  release: string; redirects: unknown[]; defaults: string[];
}

const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, "utf8")) as T;

/** Every package default: `defaults/<slot-id>/<name>-v1.json`, keyed `<slot-id>/<name>`. */
export function loadDefaults(root: string = PACKAGE_ROOT): Map<string, CandidateFile> {
  const out = new Map<string, CandidateFile>();
  const dir = join(root, "defaults");
  if (!existsSync(dir)) return out;
  for (const slot of readdirSync(dir).sort()) for (const name of readdirSync(join(dir, slot)).sort()) {
    if (name.endsWith(".json")) out.set(`${slot}/${name}`, readJson<CandidateFile>(join(dir, slot, name)));
  }
  return out;
}

export function loadStarter(id: StarterId, root: string = PACKAGE_ROOT): StarterPublication {
  return readJson<StarterPublication>(join(root, "starters", id, "publication.json"));
}

// ---------- The live Designer catalog ----------

export interface DesignerCatalog { placed: ReadonlySet<string>; retired: ReadonlySet<string>; live: ReadonlySet<string> }

/** The installed `@clossys/designer` package directory, found the way Node finds a dependency. */
export function designerPackageDir(from: string = PACKAGE_ROOT): string {
  for (let dir = from; ; dir = dirname(dir)) {
    const candidate = join(dir, "node_modules", "@clossys", "designer");
    if (existsSync(join(candidate, "package.json"))) return realpathSync(candidate);
    if (dirname(dir) === dir) throw new Error("@clossys/designer is not installed");
  }
}

/** Designer's placed, retired and live slot ids, read from its shipped `src/catalog` tree (the live catalog). */
export function loadDesignerCatalog(dir: string = designerPackageDir()): DesignerCatalog {
  const catalog = join(dir, "src", "catalog");
  const leavesOf = (nodes: readonly TreeNode[]): string[] => nodes.flatMap(node => node.leaves ? [...node.leaves] : leavesOf(node.children ?? []));
  const placed = new Set<string>();
  for (const layer of ["themes", "assets", "components", "sections", "frames"]) {
    for (const id of leavesOf(readJson<{ nodes: TreeNode[] }>(join(catalog, "ia", `${layer}.json`)).nodes)) placed.add(id);
  }
  const retired = new Set(readJson<RetiredEntry[]>(join(catalog, "retired.json")).map(entry => entry.id));
  return { placed, retired, live: new Set([...placed].filter(id => !retired.has(id))) };
}
