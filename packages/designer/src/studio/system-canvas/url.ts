import type { LayerId, Placement } from "../../catalog-core/index.js";
import { buildSlotTree, type SlotTreeNode } from "../model.js";

export const STUDIO_LAYERS: readonly LayerId[] = ["tokens", "assets", "components", "sections", "frames"];

/** Where the Studio is: the active layer and the selected (or revealed) node. Both optional. */
export interface StudioLocation { readonly layer?: LayerId; readonly node?: string }
/** The layers a host offers and the layer each known node id (a tree branch or a leaf) belongs to. */
export interface StudioNodeResolver { readonly layers: readonly LayerId[]; layerOf(node: string): LayerId | undefined }
export interface StudioUrl { readonly search: string; readonly hash: string }
export interface NormalisedStudioUrl extends StudioUrl { readonly location: StudioLocation; readonly changed: boolean }

/** The closed URL vocabulary. Unknown query keys reset to the System stop. */
const OWNED = new Set(["layer", "node", "l1"]);
const LEGACY_FRAGMENT = /^#studio-layer=(.*)$/;

const decode = (value: string): string => { try { return decodeURIComponent(value.replace(/\+/g, " ")); } catch { return value; } };
/** Node ids are slot ids or `layer/node` tree ids: keep the slash readable in a shared URL. */
const encodeNode = (node: string): string => encodeURIComponent(node).replace(/%2F/gi, "/");
function compose(rest: readonly string[], location: StudioLocation): string {
  const parts = [...rest];
  if (location.layer) parts.push(`layer=${encodeURIComponent(location.layer)}`);
  if (location.node) parts.push(`node=${encodeNode(location.node)}`);
  return parts.length ? `?${parts.join("&")}` : "";
}

/**
 * The one canonical Studio URL is `?layer=<id>&node=<leaf>`, both optional. Legacy forms normalise into it:
 * the `#studio-layer=X` fragment (the active layer, so it wins over a stale query layer), the D5f `?node=<leaf>`
 * (its layer is derived) and the D5f `?layer=X&l1=Y` (Y becomes the node). A node's own layer wins over a
 * mismatched `layer`. An unknown layer, node or query key resets to System, with no error. Pure.
 */
export function normaliseStudioUrl(url: StudioUrl, resolver: StudioNodeResolver): NormalisedStudioUrl {
  const params = new URLSearchParams(url.search);
  const fragment = LEGACY_FRAGMENT.exec(url.hash);
  const rawLayer = fragment ? decode(fragment[1]!) : params.get("layer") ?? undefined;
  const rawNode = params.get("node") ?? params.get("l1") ?? undefined;
  const offered = (layer: string | undefined): layer is LayerId => layer !== undefined && (resolver.layers as readonly string[]).includes(layer);
  const nodeLayer = rawNode ? resolver.layerOf(rawNode) : undefined;
  const node = rawNode && offered(nodeLayer) ? rawNode : undefined;
  const layer = node ? nodeLayer : offered(rawLayer) ? rawLayer : undefined;
  const location: StudioLocation = { ...(layer ? { layer } : {}), ...(node ? { node } : {}) };
  const unknown = [...params.keys()].some(key => !OWNED.has(key)) || (rawLayer !== undefined && !offered(rawLayer)) || (rawNode !== undefined && node === undefined);
  const canonical = unknown ? {} : location;
  const search = compose([], canonical);
  const hash = "";
  return { search, hash, location: canonical, changed: search !== url.search || hash !== url.hash };
}

/** The canonical URL for a location: legacy forms, foreign params and fragments are dropped. Pure. */
export function studioUrlFor(url: StudioUrl, location: StudioLocation): StudioUrl {
  return { search: compose([], location), hash: "" };
}

/** A resolver over placements: the explorer's branch ids (`layer/node`) and leaf (slot) ids, in placement order. */
export function resolverFromPlacements(placements: readonly Placement[]): StudioNodeResolver {
  const layers: LayerId[] = [];
  const owner = new Map<string, LayerId>();
  const visit = (layer: LayerId, node: SlotTreeNode): void => { owner.set(node.id, layer); node.children?.forEach(child => visit(layer, child)); };
  for (const top of buildSlotTree(placements)) {
    const layer = top.id as LayerId;
    if (!layers.includes(layer)) layers.push(layer);
    top.children?.forEach(child => visit(layer, child));
  }
  return { layers, layerOf: node => owner.get(node) };
}

const currentUrl = (): StudioUrl => ({ search: window.location.search, hash: window.location.hash });
const replaceUrl = (url: StudioUrl): void => { window.history.replaceState(window.history.state, "", window.location.pathname + url.search + url.hash); };

/** Normalise the window's URL in place (replaceState, only when it changes) and return the location it names. */
export function normaliseWindowLocation(resolver: StudioNodeResolver): StudioLocation {
  if (typeof window === "undefined") return {};
  try {
    const next = normaliseStudioUrl(currentUrl(), resolver);
    if (next.changed) replaceUrl(next);
    return next.location;
  } catch { return {}; }
}

/** Write a location into the window's URL with replaceState; a URL that already says it is left alone. */
export function replaceStudioLocation(location: StudioLocation): void {
  if (typeof window === "undefined") return;
  try {
    const current = currentUrl(), next = studioUrlFor(current, location);
    if (next.search !== current.search || next.hash !== current.hash) replaceUrl(next);
  } catch { /* A sandboxed history is optional. */ }
}
