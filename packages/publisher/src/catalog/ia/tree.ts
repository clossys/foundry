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
export interface ChromeSlot { kind: "chrome"; purpose: string; parked?: boolean; frame: string; unit: string; parts?: readonly string[]; within?: string; copy: string; publications: readonly string[] }
export interface PageSlot {
  kind: "page"; publication: string; parked?: boolean; path?: string; status?: number; collection?: string;
  layouts: readonly string[]; records?: { pattern: string; meta: string };
}
export interface ReleaseSlot { kind: "release"; publication: string; parked?: boolean; exports?: readonly { kind: string; pages?: readonly string[]; per?: string }[]; gates?: readonly string[]; signoff?: { by: string; raise: string } }
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
/** The contract of a slot, by bare id (`layout.docs`) or by ref (`publisher/layout.docs`). */
export function slotContract(id: string, trees: readonly L0Tree[] = PUBLISHER_TREES): SlotContract | undefined {
  const bare = id.startsWith("publisher/") ? id.slice("publisher/".length) : id;
  for (const tree of trees) if (Object.hasOwn(tree.slots, bare)) return tree.slots[bare];
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
      else if (!(l1.children ?? []).length) findings.push(`${l1.id}: an L1 holds at least one L2; drop an empty L1 until a leaf exists`);
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
export const STARTER_IDS = ["site", "docs", "app", "slides"] as const;
export type StarterId = (typeof STARTER_IDS)[number];

export interface CandidateFile<C = Record<string, unknown>> { clossys: Record<string, unknown> & { id: string; slot: string; source: { kind: string } }; content: C }
export interface PlacedSection { role: string; use: string; variant?: Record<string, string>; copy: string; links?: Record<string, string> }
export interface PageOption { path?: string; status?: number; collection?: string; layout: string; sections: PlacedSection[]; meta: { copy: string; indexing: string } }
export interface LayoutOption { frame: string; chrome: string[]; order: string[]; required: string[] }
export interface StarterPublication {
  schema: string; id: StarterId; node: string; root: string; pages: string[]; layouts: string[]; chrome: string[];
  release: string; redirects: unknown[]; defaults: string[];
  /** Slides only: the deck names, one route per slide at `<root>/<deck>/<n>`. */
  decks?: string[];
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

/** `withDefault`: slot ids with a Designer fill (`src/catalog/fills/<source>/<id>.json`) or a package default (`src/catalog/defaults/<id>/`). */
export interface DesignerCatalog {
  placed: ReadonlySet<string>; retired: ReadonlySet<string>; live: ReadonlySet<string>; withDefault: ReadonlySet<string>;
  /** Section ids whose registered contract (`slots/sections.json`) declares the `slide` medium; absent when not read. */
  slideMedium?: ReadonlySet<string>;
}

/** The installed `@clossys/designer` package directory, found the way Node finds a dependency. */
export function designerPackageDir(from: string = PACKAGE_ROOT): string {
  for (let dir = from; ; dir = dirname(dir)) {
    const candidate = join(dir, "node_modules", "@clossys", "designer");
    if (existsSync(join(candidate, "package.json"))) return realpathSync(candidate);
    if (dirname(dir) === dir) throw new Error("@clossys/designer is not installed");
  }
}

// ---------- The live Writer Copy catalog ----------

/** The installed `@clossys/writer` package directory, found the way Node finds a dependency. */
export function writerPackageDir(from: string = PACKAGE_ROOT): string {
  for (let dir = from; ; dir = dirname(dir)) {
    const candidate = join(dir, "node_modules", "@clossys", "writer");
    if (existsSync(join(candidate, "package.json"))) return realpathSync(candidate);
    if (dirname(dir) === dir) throw new Error("@clossys/writer is not installed");
  }
}

/** Writer's Copy L0 slot ids (`<unit>.copy`), read from its shipped `src/catalog/ia/copy.json`. */
export function loadWriterCopySlots(dir: string = writerPackageDir()): ReadonlySet<string> {
  const leavesOf = (nodes: readonly TreeNode[]): string[] => nodes.flatMap(node => node.leaves ? [...node.leaves] : leavesOf(node.children ?? []));
  return new Set(leavesOf(readJson<{ nodes: TreeNode[] }>(join(dir, "src", "catalog", "ia", "copy.json")).nodes));
}

/** The Writer copy slot a `writer/<slot>#<record>` ref names, or undefined when the ref is malformed. */
export function writerCopySlot(ref: string): string | undefined {
  return /^writer\/([a-z][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*)+)#[a-z0-9][a-z0-9.-]*$/.exec(ref)?.[1];
}

/** Where Designer ships its package defaults: `src/catalog/defaults/<slot-id>/<name>-v1.json` (the package `files` ship `src`). */
export const designerDefaultsDir = (dir: string = designerPackageDir()): string => join(dir, "src", "catalog", "defaults");

/** One Designer slot's package defaults, read from the folder the package ships; empty when the slot has none. */
export function loadDesignerPackageDefaults(id: string, dir: string = designerPackageDir()): CandidateFile[] {
  const slot = join(designerDefaultsDir(dir), id);
  if (!existsSync(slot)) return [];
  return readdirSync(slot).filter(name => name.endsWith(".json")).sort().map(name => readJson<CandidateFile>(join(slot, name)));
}

/**
 * A Designer frame contract, read from its registered slot record (`src/catalog/slots/frames.json`): root element, slide
 * slots and the closed aspect member. The contract names the aspect only; the print page box is a release concern, so
 * the pixel canvas is the aspect at Publisher's print base width (`DECK_PRINT_WIDTH`).
 */
export interface DesignerFrameContract {
  kind: "frame"; root: string; aspect: string; canvas: { aspect: string; width: number; height: number };
  slots: readonly { id: string; accepts: string; required?: boolean; max?: number }[];
}
/** The print base width of a deck page box, in CSS pixels; the height follows the frame contract's aspect. */
export const DECK_PRINT_WIDTH = 1920;
interface DesignerSlotRecord { id: string; layer: string; contract?: { kind?: string; root?: string; slots?: DesignerFrameContract["slots"]; members?: { names?: readonly string[] } } }
export function loadDesignerFrameContract(id: string, dir: string = designerPackageDir()): DesignerFrameContract {
  const record = readJson<DesignerSlotRecord[]>(join(dir, "src", "catalog", "slots", "frames.json")).find(entry => entry.id === id);
  const contract = record?.contract;
  if (record?.layer !== "frames" || contract?.kind !== "frame" || !contract.root) throw new Error(`designer: ${id} is not a registered frame in slots/frames.json`);
  const member = (contract.members?.names ?? []).map(name => /^aspect\.(\d+)-(\d+)$/.exec(name)).find(Boolean);
  if (!member) throw new Error(`designer: frame ${id} declares no aspect member (aspect.<w>-<h>)`);
  const [w, h] = [Number(member[1]), Number(member[2])];
  const aspect = `${w}:${h}`;
  return { kind: "frame", root: contract.root, aspect, canvas: { aspect, width: DECK_PRINT_WIDTH, height: Math.round(DECK_PRINT_WIDTH * h / w) }, slots: contract.slots ?? [] };
}

/**
 * Designer's placed, retired and live slot ids, read from its shipped `src/catalog` tree (the live catalog), with the
 * families and in-place retirements of its additive IA extension (`ia/slides.json`) merged in, and the ids that ship a
 * package default.
 */
export function loadDesignerCatalog(dir: string = designerPackageDir()): DesignerCatalog {
  const catalog = join(dir, "src", "catalog");
  const leavesOf = (nodes: readonly TreeNode[]): string[] => nodes.flatMap(node => node.leaves ? [...node.leaves] : leavesOf(node.children ?? []));
  const placed = new Set<string>();
  for (const layer of ["themes", "assets", "components", "sections", "frames"]) {
    for (const id of leavesOf(readJson<{ nodes: TreeNode[] }>(join(catalog, "ia", `${layer}.json`)).nodes)) placed.add(id);
  }
  const extension = join(catalog, "ia", "slides.json");
  if (existsSync(extension)) for (const family of readJson<{ families: { node: TreeNode }[] }>(extension).families) for (const id of leavesOf([family.node])) placed.add(id);
  const retired = new Set(readJson<RetiredEntry[]>(join(catalog, "retired.json")).map(entry => entry.id));
  // An extension retires its own leaves in place (foundry-build-0032: the six sections.slide-* became slide-medium configs of their twins).
  if (existsSync(extension)) for (const entry of readJson<{ retired?: RetiredEntry[] }>(extension).retired ?? []) retired.add(entry.id);
  const withDefault = new Set<string>();
  const fills = join(catalog, "fills");
  if (existsSync(fills)) for (const source of readdirSync(fills)) for (const name of readdirSync(join(fills, source))) if (name.endsWith(".json")) withDefault.add(name.slice(0, -5));
  const defaults = designerDefaultsDir(dir);
  if (existsSync(defaults)) for (const id of readdirSync(defaults)) if (readdirSync(join(defaults, id)).some(name => name.endsWith(".json"))) withDefault.add(id);
  const slideMedium = new Set<string>();
  const sectionSlots = join(catalog, "slots", "sections.json");
  if (existsSync(sectionSlots)) for (const record of readJson<{ id: string; contract?: { media?: readonly string[] } }[]>(sectionSlots)) if (record.contract?.media?.includes("slide")) slideMedium.add(record.id);
  return { placed, retired, live: new Set([...placed].filter(id => !retired.has(id))), withDefault, slideMedium };
}
