import type { LifecycleCondition, LifecycleStatus } from "../pack/lifecycle.js";
import type { SlidesDeckInput } from "../slides/index.js";

/**
 * `@clossys/publisher/materials` — the materials mini-site (issue #1206):
 * company overviews (short/medium/long) and pitch decks (with audience
 * variants), rendered as a browsable, print-friendly static HTML site.
 *
 * This subpath deliberately does not re-author document or slide content —
 * `@clossys/publisher/document` and `@clossys/publisher/slides` already
 * render a `StructuredDocument`/`SlidesDeckInput` to HTML/SVG. This module
 * takes ALREADY-RENDERED output from those two subpaths and does the work
 * specific to the materials site: the browsable index (#1206's own
 * requirement — "lists every overview and deck version with its status,
 * version, and last-published time from the pack manifest"), the shared
 * print stylesheet, the audience-variant selection mechanism, and the
 * internal-visibility guard (issue #1206's owner decision: materials are
 * internal by default, and Publisher refuses to let one reach a public
 * repository).
 */

/** One entry in the materials index (#1206's own index requirement). */
export interface MaterialsIndexEntry {
  /** Stable id, e.g. "overview-short", "pitch-deck-investor". */
  id: string;
  /** Human title shown in the index, e.g. "Company overview — short". */
  title: string;
  kind: "overview" | "deck";
  /** From the pack manifest (#1204) — the shared lifecycle vocabulary (#1228). */
  status: LifecycleStatus;
  condition: LifecycleCondition;
  /** "v0.1", "v0.2", … — same shape as `PackItem.version`. */
  version: string;
  /** ISO-8601 timestamp of the last publish, or null when never published. */
  lastPublishedAt: string | null;
  /** Relative path (from the index) to this entry's rendered page. */
  href: string;
}

/** Declared per-slide audience selections for a pitch deck (#1206: "share one source and differ only by declared selections"). A slide with no entry here is shown to every audience. */
export type DeckAudienceSelections = Readonly<Record<string, readonly string[]>>;

export interface AudienceVariantDeck {
  audience: string;
  deck: SlidesDeckInput;
}
