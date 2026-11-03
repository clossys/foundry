/**
 * PROOF-2 Designer library projection: the Studio gallery (`/designer`) and leaf detail
 * (`/designer/<leaf>`) read the Designer slot model only (`agents/designer/<L1>/<L2>/<slot>/`:
 * `candidates/*.json` plus `pin.json`), grouped by the Designer IA.
 *
 * REPLACE: this module and its two API routes are the minimal route table PROOF-2 allows
 * while the Publisher content-map projection has not landed; the projection supersedes it.
 */
import { loadBuildCatalog, type BuildCatalogData, type PlacementNode } from "@clossys/designer/catalog";
import { candidateVersion, hasAgentSlots, slotGallery, type SlotEmptyState } from "./slot-gallery.js";
import { listSlots, readCandidate, readSlot } from "../records/slots.js";
import { validateCandidate } from "../records/slot-model/index.js";
import { workspaceSlotStatus, type SlotStatus } from "../records/status.js";

export interface DesignerCard {
  readonly slot: string;
  readonly slug: string;
  readonly name: string;
  readonly layer: string;
  /** `pending`: nothing is pinned but candidates wait for approval; `missing` means the slot has no candidate at all. */
  readonly status: DesignerStatus;
  /** The pinned candidate's version (or the newest one when the slot has no pin). */
  readonly element?: string;
  readonly version?: number;
  readonly pinned: boolean;
  /** Specimen id for `/__specimen?element=` (`<slot>/<element>`). */
  readonly specimen?: string;
  /** Options pending approval, oldest first: candidates newer than the pin, or every candidate when nothing is pinned. */
  readonly options: readonly number[];
  readonly emptyState?: SlotEmptyState;
  readonly candidate?: string;
}
export type DesignerStatus = SlotStatus | "pending";

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
  /** Always false: the slot model keeps no release snapshots. */
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

let catalog: BuildCatalogData | undefined;
function buildCatalog(): BuildCatalogData { return catalog ??= loadBuildCatalog(); }
const humanize = (value: string) => value.replace(/[-_.]+/g, " ").replace(/^\w/, letter => letter.toUpperCase());
const LAYER_LABELS: Record<string, string> = { themes: "Themes", assets: "Assets", components: "Components", sections: "Sections", frames: "Frames" };
const object = (value: unknown): value is Record<string, any> => typeof value === "object" && value !== null && !Array.isArray(value);

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

/** The gallery: the Designer IA's L1/L2 groups, one card per slot; a consumer without a Designer slot model has none. */
export function designerGallery(root: string): DesignerGallery {
  if (!hasAgentSlots(root, "designer")) return { sections: [], count: 0 };
  const gallery = slotGallery(root, "designer");
  const entries = new Map(listSlots(root, "designer").map(entry => [entry.id, entry]));
  return { count: gallery.count, sections: gallery.sections.map(section => ({ ...section, cards: section.cards.map(card => {
    const entry = entries.get(card.id);
    const pinned = card.status === "active";
    const versions = (entry?.candidates ?? []).map(candidateVersion);
    return {
      slot: card.id, slug: card.slug, name: card.name, layer: card.id.split(".")[0]!,
      status: (pinned ? "pinned" : card.status === "draft" ? "pending" : card.status === "failing" ? "failing" : "missing") as DesignerStatus,
      pinned, options: pinned ? versions.filter(version => version > card.version) : card.status === "draft" ? versions : [],
      ...(card.candidate ? { candidate: card.candidate } : {}),
      ...(card.element ? { element: card.element, specimen: card.specimen } : {}),
      ...(card.version ? { version: card.version } : {}), ...(card.emptyState ? { emptyState: card.emptyState } : {}),
    };
  }) })) };
}

interface CandidateRow { name: string; version: number; sha256: string; valid: boolean; item: Record<string, any> }
/** `meta.source.ref` -> the registry reference it names and the earlier candidate version it derives from. */
function lineageOf(item: Record<string, any>): { mode: string; parent?: number; source?: string } {
  const source = object(item.meta?.source) ? item.meta.source : {};
  let parent: number | undefined, from: string | undefined;
  for (const ref of Array.isArray(source.ref) ? source.ref : []) {
    let value: unknown;
    try { value = typeof ref === "string" && ref.startsWith("{") ? JSON.parse(ref) : undefined; } catch { value = undefined; }
    if (!object(value)) continue;
    if (typeof value.registry === "string" && from === undefined) from = `${value.registry}/${value.item}@${value.version}`;
    else if (value.registry === undefined && Number.isSafeInteger(value.version)) parent = value.version;
  }
  return { mode: typeof source.kind === "string" ? source.kind : "unknown", ...(parent !== undefined ? { parent } : {}), ...(from ? { source: from } : {}) };
}
const lineageText = (row: { mode: string; parent?: number; source?: string }) => row.source
  ? `${row.mode} from ${row.source}` : row.parent !== undefined ? `${row.mode}, from v${row.parent}` : row.mode;

/** One leaf by slug or slot id; undefined when the slot model has no such slot. */
export function designerLeaf(root: string, key: string): DesignerLeaf | undefined {
  const all = designerGallery(root).sections.flatMap(section => section.cards);
  const card = all.find(entry => entry.slot === key) ?? all.find(entry => entry.slug === key);
  if (!card) return undefined;
  const entry = listSlots(root, "designer").find(row => row.id === card.slot)!;
  let kind: string | undefined;
  try { kind = readSlot(root, "designer", card.slot).kind; } catch { kind = undefined; }
  const rows: CandidateRow[] = entry.candidates.flatMap(name => {
    try {
      const candidate = readCandidate(root, "designer", card.slot, name);
      const item = JSON.parse(candidate.bytes);
      if (!object(item)) return [];
      const valid = kind === "element" && !validateCandidate(kind, card.slot, name, candidate.bytes).length;
      return [{ name, version: candidateVersion(name), sha256: candidate.sha256, valid, item }];
    } catch { return []; }
  });
  const status = workspaceSlotStatus(root, { slots: [card.slot], referenceHash: source => source.hash }).find(row => row.slot === card.slot);
  const placement = placementPaths().get(card.slot);
  const trail = [LAYER_LABELS[card.layer] ?? humanize(card.layer), ...(placement?.groups.map(group => group.label) ?? [])];
  const contract = buildCatalog().slots.find(slot => slot.id === card.slot)?.contract as
    | { kind?: string; root?: string; slots?: readonly { name: string; type: string; required: boolean }[]; props?: readonly { name: string; type?: string; required?: boolean }[]; allowedComposes?: readonly string[] }
    | undefined;
  const shown = rows.find(row => row.name === (entry.pin?.candidate ?? card.candidate));
  const current: Record<string, any> = object(shown?.item.meta?.element) ? shown!.item.meta.element : {};
  const deps: readonly Record<string, any>[] = Array.isArray(current.deps?.elements) ? current.deps.elements : [];
  const reads: Record<string, any> = object(current.reads) ? current.reads : {};
  const creator: Record<string, any> = object(current.creator) ? current.creator : {};
  return {
    card, trail,
    statusDetail: card.status === "pending"
      ? [`Nothing is pinned yet; ${card.options.length === 1 ? "1 candidate waits" : `${card.options.length} candidates wait`} for approval.`]
      : status?.detail ?? [],
    ...(shown ? { record: {
      kind: String(current.kind ?? shown.item.type ?? ""), package: String(current.package ?? ""), license: String(current.license?.spdx ?? shown.item.meta?.source?.license ?? ""),
      creator: creator.by ? `${creator.agent} (${creator.by})` : String(creator.agent ?? ""),
      reason: String(current.reason ?? ""), createdAt: String(current.createdAt ?? ""), hash: `sha256:${shown.sha256}`,
    } } : {}),
    contract: {
      ...(contract?.kind ? { kind: contract.kind } : {}), ...(contract?.root ? { root: contract.root } : {}),
      inputs: [...(contract?.slots ?? []).map(input => ({ name: input.name, type: input.type, required: input.required })),
        ...(contract?.props ?? []).map(prop => ({ name: prop.name, type: prop.type ?? "prop", required: !!prop.required }))],
      composes: [...(contract?.allowedComposes ?? [])],
      copyKeys: Array.isArray(reads.copyKeys) ? [...reads.copyKeys] : [], themeVars: Array.isArray(reads.themeVars) ? [...reads.themeVars] : [],
      dependencies: deps.map(dep => `${dep.slot}/${dep.element}@v${dep.version}`),
    },
    lineage: rows.map(row => ({ version: row.version, ...lineageOf(row.item) })),
    versions: rows.map(row => ({
      version: row.version, hash: `sha256:${row.sha256}`, createdAt: String(row.item.meta?.element?.createdAt ?? ""),
      reason: String(row.item.meta?.element?.reason ?? ""), lineage: lineageText(lineageOf(row.item)),
      pinned: entry.pin?.candidate === row.name, released: false,
      verified: row.valid && (entry.pin?.candidate !== row.name || entry.pin.sha256 === row.sha256),
    })).reverse(),
  };
}

/** The pinned theme, as a specimen theme id, when the Designer slot model pins one. */
export function designerDefaultTheme(root: string): string | undefined {
  if (!hasAgentSlots(root, "designer")) return undefined;
  const entries = listSlots(root, "designer").filter(entry => entry.pin && entry.id.startsWith("themes.") && !entry.id.startsWith("themes.font"));
  // The theme slot itself, not the first `themes.*` slot by name.
  const entry = entries.find(row => row.id === "themes.theme") ?? entries.sort((a, b) => a.id < b.id ? -1 : 1)[0];
  if (!entry?.pin) return undefined;
  try {
    const candidate = readCandidate(root, "designer", entry.id, entry.pin.candidate);
    const item = candidate.sha256 === entry.pin.sha256 ? JSON.parse(candidate.bytes) : undefined;
    return typeof item?.name === "string" ? `${entry.id}/${item.name}` : undefined;
  } catch { return undefined; }
}
