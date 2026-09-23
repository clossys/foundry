import type { LifecycleCondition, LifecycleStatus } from "./lifecycle.js";

/**
 * The v0 Launch pack's MECE layers (issue #1204's own table). `foundation`
 * and `identity` items are inputs every surface's `needs` pulls from;
 * `surface` items are what actually ships to an audience.
 */
export const PACK_LAYERS = ["foundation", "identity", "surface"] as const;
export type PackLayer = (typeof PACK_LAYERS)[number];

/** Every pack item declares internal or public visibility (#1204, following the #1206 owner decision). Materials are internal by default; nothing infers visibility. */
export const PACK_VISIBILITIES = ["internal", "public"] as const;
export type PackVisibility = (typeof PACK_VISIBILITIES)[number];

/** A content-addressed pin on one of an item's sources, so a stale upstream change can be detected without re-reading every byte. */
export interface PackSourcePin {
  /** Path (or id) of the pinned source, relative to the repository root. */
  path: string;
  /** A content fingerprint — sha256 hex digest of the source at the time it was pinned. */
  fingerprint: string;
}

export interface PackItem {
  /** Stable id, e.g. "strategy-brief", "brand-kit", "materials-site". */
  id: string;
  layer: PackLayer;
  /** The role that owns this item's content and judgments — Strategist, Designer, Writer, or Publisher itself for surfaces it assembles. */
  owner: string;
  visibility: PackVisibility;
  /** Ids of other pack items this one needs before it can be planned as ready. */
  needs: readonly string[];
  status: LifecycleStatus;
  condition: LifecycleCondition;
  /** "v0.1", "v0.2", … — bumped on every republish, independent of the owning package's own semver. */
  version: string;
  createdAt: string | null;
  updatedAt: string | null;
  /** Set when a Customer keep approves this item (the former "kept" status). */
  approvedAt: string | null;
  /** Set when this item is sealed and verified live (the former "published" status). */
  verifiedAt: string | null;
  sourcePins: readonly PackSourcePin[];
  /** Where this item's rendered output lives, e.g. `clossys/publisher/out/website/v0.1/`. */
  outputPaths: readonly string[];
  /** Where a verified item was actually published — a URL, a channel name, or similar. Empty until verified. */
  publishedTo: readonly string[];
  /** The single next action a caller should take for this item, or null when there is none. */
  nextAction: string | null;
}

export interface PackManifest {
  schemaVersion: 1;
  items: readonly PackItem[];
}

const VERSION_RE = /^v\d+\.\d+$/;

export function isPackLayer(value: unknown): value is PackLayer {
  return typeof value === "string" && (PACK_LAYERS as readonly string[]).includes(value);
}

export function isPackVisibility(value: unknown): value is PackVisibility {
  return typeof value === "string" && (PACK_VISIBILITIES as readonly string[]).includes(value);
}

export function isPackVersionString(value: unknown): value is string {
  return typeof value === "string" && VERSION_RE.test(value);
}
