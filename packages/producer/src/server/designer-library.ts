/**
 * PROOF-2 Designer library projection: the Studio gallery (`/designer`) and leaf detail
 * (`/designer/<leaf>`) read element records only through the slot engine's loaders
 * (`../records`), grouped by the Designer IA (L0 layer, L1-L2 placement nodes, L3 leaf).
 *
 * REPLACE: this module and its two API routes are the minimal route table PROOF-2 allows
 * while the Publisher content-map projection has not landed; the projection supersedes it.
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { loadBuildCatalog, type BuildCatalogData, type PlacementNode } from "@clossys/designer/catalog";
import { listVersions, readElementVersion, verifyElementVersion } from "../records/library.js";
import { emptySelection, latestRelease, SELECTION_FILE } from "../records/selection.js";
import { workspaceSlotStatus, type SlotStatus } from "../records/status.js";
import type { ElementRecord, Release, Selection } from "../records/types.js";
import { loadSelection } from "../records/validate.js";

export interface DesignerCard {
  readonly slot: string;
  readonly slug: string;
  readonly name: string;
  readonly layer: string;
  readonly status: SlotStatus;
  /** The pinned version (or the newest one when the slot has no pin). */
  readonly element?: string;
  readonly version?: number;
  readonly pinned: boolean;
  /** Specimen id for `/__specimen?element=` (`<slot>/<element>`). */
  readonly specimen?: string;
}
export interface DesignerSection {
  /** Anchor id, unique on the page. */
  readonly id: string;
  readonly label: string;
  /** 0 = layer, 1-2 = IA placement groups. */
  readonly level: 0 | 1 | 2;
  readonly cards: readonly DesignerCard[];
}
export interface DesignerGallery { readonly sections: readonly DesignerSection[]; readonly count: number }

export interface DesignerVersionRow {
  readonly version: number;
  readonly hash: string;
  readonly createdAt: string;
  readonly reason: string;
  readonly lineage: string;
  readonly pinned: boolean;
  readonly released: boolean;
  readonly verified: boolean;
}
export interface DesignerLeaf {
  readonly card: DesignerCard;
  readonly trail: readonly string[];
  readonly statusDetail: readonly string[];
  readonly record?: { readonly kind: string; readonly package: string; readonly license: string; readonly creator: string; readonly reason: string; readonly createdAt: string; readonly hash: string };
  readonly contract: {
    readonly kind?: string;
    readonly root?: string;
    readonly inputs: readonly { readonly name: string; readonly type: string; readonly required: boolean }[];
    readonly composes: readonly string[];
    readonly copyKeys: readonly string[];
    readonly themeVars: readonly string[];
    readonly dependencies: readonly string[];
  };
  readonly lineage: readonly { readonly version: number; readonly mode: string; readonly parent?: number; readonly source?: string }[];
  readonly versions: readonly DesignerVersionRow[];
}

const SEGMENT = /^[a-z0-9][a-z0-9.-]*$/;
const isDir = (path: string) => { try { return statSync(path).isDirectory(); } catch { return false; } };
const humanize = (value: string) => value.replace(/[-_.]+/g, " ").replace(/^\w/, letter => letter.toUpperCase());
const LAYER_LABELS: Record<string, string> = { themes: "Themes", assets: "Assets", components: "Components", sections: "Sections", frames: "Frames" };

let catalog: BuildCatalogData | undefined;
function buildCatalog(): BuildCatalogData { return catalog ??= loadBuildCatalog(); }

interface Workspace { root: string; library: string; selection: Selection; release?: Release; slots: string[] }

function readWorkspace(root: string): Workspace {
  const library = join(root, "library");
  const selectionPath = join(root, SELECTION_FILE);
  const selection = existsSync(selectionPath) ? loadSelection(selectionPath) : emptySelection();
  const release = latestRelease(root);
  const slots = new Set(Object.keys(selection.pins));
  if (isDir(library)) {
    for (const slot of readdirSync(library).filter(name => SEGMENT.test(name) && isDir(join(library, name)))) {
      if (readdirSync(join(library, slot)).some(element => SEGMENT.test(element) && listVersions(library, slot, element).length)) slots.add(slot);
    }
  }
  return { root, library, selection, ...(release ? { release } : {}), slots: [...slots].sort() };
}

const elementsOf = (ws: Workspace, slot: string): string[] => isDir(join(ws.library, slot))
  ? readdirSync(join(ws.library, slot)).filter(element => SEGMENT.test(element) && listVersions(ws.library, slot, element).length).sort() : [];

function slugs(slots: readonly string[]): Map<string, string> {
  const short = new Map<string, number>();
  for (const slot of slots) { const tail = slot.slice(slot.indexOf(".") + 1); short.set(tail, (short.get(tail) ?? 0) + 1); }
  return new Map(slots.map(slot => { const tail = slot.slice(slot.indexOf(".") + 1); return [slot, short.get(tail) === 1 ? tail : slot]; }));
}

function cards(ws: Workspace): Map<string, DesignerCard> {
  const status = new Map(workspaceSlotStatus(ws.root, {
    slots: ws.slots,
    // Upstream drift needs reference manifests the Publisher projection will supply; PROOF-2 trusts the recorded hash.
    referenceHash: source => source.hash,
  }).map(row => [row.slot, row]));
  const slug = slugs(ws.slots);
  return new Map(ws.slots.map(slot => {
    const pin = ws.selection.pins[slot];
    const element = pin?.element ?? elementsOf(ws, slot)[0];
    const version = pin?.version ?? (element ? listVersions(ws.library, slot, element).at(-1) : undefined);
    const card: DesignerCard = {
      slot, slug: slug.get(slot)!, name: humanize(slug.get(slot)!.replace(/^[a-z]+\./, "")), layer: slot.split(".")[0]!,
      status: status.get(slot)?.status ?? "missing", pinned: !!pin,
      ...(element ? { element, specimen: `${slot}/${element}` } : {}), ...(version ? { version } : {}),
    };
    return [slot, card];
  }));
}

/** Placement paths: slot -> labels from the layer down to the leaf's parent group (at most L2). */
function placementPaths(): Map<string, { layer: string; groups: { id: string; label: string }[] }> {
  const paths = new Map<string, { layer: string; groups: { id: string; label: string }[] }>();
  for (const placement of buildCatalog().placements) {
    const walk = (nodes: readonly PlacementNode[], groups: { id: string; label: string }[]) => {
      for (const node of nodes) {
        const next = [...groups, { id: node.id, label: node.label }];
        if ("leaves" in node) for (const leaf of node.leaves) if (!paths.has(leaf)) paths.set(leaf, { layer: placement.layer, groups: next.slice(0, 2) });
        if ("children" in node) walk(node.children, next);
      }
    };
    walk(placement.nodes, []);
  }
  return paths;
}

/** The gallery: one section per non-empty L0 layer and L1/L2 group, in IA order; deeper groups fold into L2. */
export function designerGallery(root: string): DesignerGallery {
  const ws = readWorkspace(root);
  const all = cards(ws);
  const seen = new Set<string>();
  const sections: { id: string; label: string; level: 0 | 1 | 2; cards: DesignerCard[] }[] = [];
  const section = (id: string, label: string, level: 0 | 1 | 2) => {
    let found = sections.find(entry => entry.id === id);
    if (!found) { found = { id, label, level, cards: [] }; sections.push(found); }
    return found;
  };
  const add = (layer: string, id: string, label: string, level: 1 | 2, leaves: readonly string[], parent?: { id: string; label: string }) => {
    const placed = leaves.filter(leaf => all.has(leaf) && !seen.has(leaf));
    if (!placed.length) return;
    section(layer, LAYER_LABELS[layer] ?? humanize(layer), 0);
    if (parent) section(parent.id, parent.label, 1);
    for (const leaf of placed) seen.add(leaf);
    section(id, label, level).cards.push(...placed.map(leaf => all.get(leaf)!));
  };
  const leavesUnder = (node: PlacementNode): string[] => "leaves" in node ? [...node.leaves] : node.children.flatMap(leavesUnder);
  const layers = buildCatalog().placements.map(placement => placement.layer as string);
  for (const placement of buildCatalog().placements) {
    const layer = placement.layer as string;
    // L1 nodes with children become a heading-only L1 section over their L2 sections; deeper levels fold into L2.
    const walk = (nodes: readonly PlacementNode[], level: 1 | 2, parent?: { id: string; label: string }) => {
      for (const node of nodes) {
        const id = `${layer}-${node.id}`;
        if (level === 2 || "leaves" in node) add(layer, id, node.label, level, leavesUnder(node), parent);
        else walk(node.children, 2, { id, label: node.label });
      }
    };
    walk(placement.nodes, 1);
    add(layer, `${layer}-unplaced`, "Not in the IA", 1, [...all.values()].filter(card => card.layer === layer).map(card => card.slot));
  }
  for (const card of all.values()) if (!layers.includes(card.layer)) add(card.layer, `${card.layer}-unplaced`, "Not in the IA", 1, [card.slot]);
  return { sections, count: all.size };
}

const lineageText = (record: ElementRecord) => record.lineage.source
  ? `${record.lineage.mode} from ${record.lineage.source.registry}/${record.lineage.source.item}@${record.lineage.source.version}`
  : record.lineage.parent ? `${record.lineage.mode}, from v${record.lineage.parent.version}` : record.lineage.mode;

/** One leaf by slug or slot id; undefined when the workspace has no such slot. */
export function designerLeaf(root: string, key: string): DesignerLeaf | undefined {
  const ws = readWorkspace(root);
  const all = cards(ws);
  const card = all.get(key) ?? [...all.values()].find(entry => entry.slug === key);
  if (!card) return undefined;
  const status = workspaceSlotStatus(ws.root, { slots: [card.slot], referenceHash: source => source.hash }).find(row => row.slot === card.slot);
  const placement = placementPaths().get(card.slot);
  const trail = [LAYER_LABELS[card.layer] ?? humanize(card.layer), ...(placement?.groups.map(group => group.label) ?? [])];
  const contract = buildCatalog().slots.find(slot => slot.id === card.slot)?.contract as
    | { kind?: string; root?: string; slots?: readonly { name: string; type: string; required: boolean }[]; props?: readonly { name: string; type?: string; required?: boolean }[]; allowedComposes?: readonly string[] }
    | undefined;
  const versions = card.element ? listVersions(ws.library, card.slot, card.element) : [];
  const records = versions.map(version => ({ version, record: readElementVersion(ws.library, card.slot, card.element!, version).element }));
  const current = records.find(entry => entry.version === card.version)?.record;
  const pin = ws.selection.pins[card.slot];
  const released = ws.release?.pins[card.slot];
  return {
    card, trail, statusDetail: status?.detail ?? [],
    ...(current ? { record: {
      kind: current.kind, package: current.package, license: current.license.spdx,
      creator: current.creator.by ? `${current.creator.agent} (${current.creator.by})` : current.creator.agent,
      reason: current.reason, createdAt: current.createdAt, hash: current.hash,
    } } : {}),
    contract: {
      ...(contract?.kind ? { kind: contract.kind } : {}), ...(contract?.root ? { root: contract.root } : {}),
      inputs: [...(contract?.slots ?? []).map(input => ({ name: input.name, type: input.type, required: input.required })),
        ...(contract?.props ?? []).map(prop => ({ name: prop.name, type: prop.type ?? "prop", required: !!prop.required }))],
      composes: [...(contract?.allowedComposes ?? [])],
      copyKeys: [...(current?.reads.copyKeys ?? [])], themeVars: [...(current?.reads.themeVars ?? [])],
      dependencies: (current?.deps.elements ?? []).map(dep => `${dep.slot}/${dep.element}@v${dep.version}`),
    },
    lineage: records.map(({ version, record }) => ({
      version, mode: record.lineage.mode,
      ...(record.lineage.parent ? { parent: record.lineage.parent.version } : {}),
      ...(record.lineage.source ? { source: `${record.lineage.source.registry}/${record.lineage.source.item}@${record.lineage.source.version}` } : {}),
    })),
    versions: records.map(({ version, record }) => ({
      version, hash: record.hash, createdAt: record.createdAt, reason: record.reason, lineage: lineageText(record),
      pinned: pin?.element === card.element && pin?.version === version,
      released: released?.element === card.element && released?.version === version,
      verified: verifyElementVersion(ws.library, card.slot, card.element!, version).length === 0,
    })).reverse(),
  };
}

/** The pinned theme, as a specimen theme id, when the workspace pins one. */
export function designerDefaultTheme(root: string): string | undefined {
  const selectionPath = join(root, SELECTION_FILE);
  if (!existsSync(selectionPath)) return undefined;
  const pins = loadSelection(selectionPath).pins;
  const slot = Object.keys(pins).sort().find(name => name.startsWith("themes."));
  return slot ? `${slot}/${pins[slot]!.element}` : undefined;
}
