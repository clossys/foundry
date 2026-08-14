/**
 * The geometry problem, and the one place it's handled.
 *
 * `LayoutSpec.slots` carries `frame: { x, y, w, h }` — ABSOLUTE fractional
 * positions on a two-dimensional canvas (see `@vespeneventures/surface/core`'s
 * `types.ts`, `Frame`'s own doc comment). Email cannot do absolute
 * positioning at all: every client renders a linear, top-to-bottom flow of
 * block elements, full width unless a `<table>` explicitly narrows one.
 * There is no email-safe way to say "this block sits at x=0.5" the way a
 * web page's CSS or a print page's PDF coordinate system can.
 *
 * So a `Frame` degrades to exactly one thing an email CAN express: an
 * ORDERING hint. This module is that degradation, in both directions:
 *
 *   1. `orderEntries` — sorts resolved slot content by `frame.y`, then
 *      `frame.x`, into the single vertical stack `renderEmailDocument`
 *      emits as table rows.
 *   2. `buildGeometryWarnings` — names every real loss of fidelity that
 *      sort silently causes, so a caller who laid out a two-column
 *      document and gets one column back is TOLD, not left to notice on
 *      render. See this file's own doc comments below for the two kinds
 *      of loss detected.
 *
 * NO LAYOUT AT ALL — THE OTHER HALF OF THE CONTRACT
 * -----------------------------------------------------
 * `@vespeneventures/surface/core`'s own `types.ts` says a `layout` must be
 * ABSENT from an `email`-channel `ComposeDocument` (`validate.ts`'s
 * `layout-forbidden` rule) — the same reason it's absent from `web`:
 * neither channel has a coordinate system a `Frame` could describe. So
 * when a caller has no external `LayoutSpec` to hand `renderEmailDocument`
 * either (no template registry of real slot positions the way `./web`'s
 * `AuthView`/`ErrorView` do), there is no geometry to lose in the first
 * place — `buildSyntheticLayout` below builds one slot per binding, all
 * sharing one placeholder frame, so `resolveDocument` has a real
 * `LayoutSpec` to match against. `orderEntries` sorting placeholder frames
 * that are all identical is a no-op (`Array.prototype.sort` is stable —
 * ECMA-262 guarantees this since ES2019 — so ties keep their original,
 * i.e. binding, order), and `buildGeometryWarnings` is never called for
 * this path at all: warning about geometry that was never real information
 * would be noise, not signal. See `renderEmailDocument.ts` for where that
 * branch is chosen.
 */

import type { ElementKind, FlowLayoutSpec, Frame, StyleBinding } from "../../core/index.js";
import type { StaticRenderAsset } from "../../internal/assets.js";
import type { RenderWarning } from "../types.js";

/**
 * Builds a `FlowLayoutSpec` with exactly one slot per DISTINCT `binding.slot`
 * in first-occurrence order. A synthetic email template has no coordinates
 * and no visual kind: the email renderer uses ordinary flowed body styling.
 * `required: false` is deliberate: there is no real template here to say
 * which slots are load-bearing, so nothing is ever flagged
 * `missingRequired` — the "everything must actually resolve" bar this
 * channel holds to (see `renderEmailDocument.ts`) is instead enforced by
 * requiring `resolveCopy` to succeed for every bound slot, which does not
 * depend on `required` at all.
 *
 * A binding whose `slot` is not a non-empty string is skipped — the same
 * malformed shape `resolveDocument`'s own `bindingFindings` would flag via
 * `validateSlotBindingShape`'s `binding-slot-shape` rule, so this function
 * does not need to duplicate that check; it just avoids manufacturing a
 * `SlotSpec` with an unusable key. `resolveDocument` still reports it
 * appropriately once given this layout.
 */
export function buildSyntheticLayout(bindings: ReadonlyArray<{ slot: unknown }>): FlowLayoutSpec {
  const seen = new Set<string>();
  const slots: FlowLayoutSpec["slots"] = [];
  for (const binding of bindings) {
    const key = binding.slot;
    if (typeof key !== "string" || key.length === 0 || seen.has(key)) continue;
    seen.add(key);
    slots.push({ key, required: false });
  }
  return { slots };
}

/**
 * One slot's content plus the `Frame` it was positioned at — what
 * {@link orderEntries}/{@link buildGeometryWarnings} operate on. `style`,
 * when the resolved slot's own `SlotSpec.style` carried one, flows straight
 * through untouched here — this module only ever reads/reorders on
 * `frame`; it is `internal/styles.ts`'s `tdStyleForElement` that actually
 * resolves `style.typography` (and, `style.color`/`.background`/etc.
 * once/if this channel grows to resolve those too — see that file's own
 * doc comment for what it resolves today).
 *
 * `text` is ALWAYS populated, even for an `asset`-bearing entry — see
 * `renderEmailDocument.ts`'s own doc comment: it holds the asset's own
 * `alt` text there, which is what `internal/plainText.ts`'s
 * `buildPlainText` emits for that row (a `text/plain` message has no
 * markup to embed an image into; the alt text is the only meaningful
 * representation of "there was a picture here"). `asset`, when present,
 * is what `internal/emailDocument.ts`'s `buildRow` actually paints — an
 * `<img>` row instead of an escaped-text row — and always wins over `text`
 * for the HTML output specifically.
 */
export interface GeometryEntry {
  key: string;
  /** Present only on the deprecated positioned-email migration path. */
  frame?: Frame;
  text: string;
  /** Present only on the deprecated positioned-email migration path. */
  element?: ElementKind;
  style?: StyleBinding;
  asset?: StaticRenderAsset;
}

/**
 * Sorts `entries` by `frame.y` ascending, then `frame.x` ascending —
 * top-to-bottom, then left-to-right within a row — into the single
 * vertical stack email must render. Stable (relies on
 * `Array.prototype.sort`'s ES2019+ stability guarantee): entries that tie
 * on both fields keep their original relative order, which is what makes
 * this a safe no-op for the all-identical-placeholder-frame (no real
 * layout) case — see this file's top comment.
 */
export function orderEntries(entries: readonly GeometryEntry[]): GeometryEntry[] {
  return [...entries].sort((a, b) => a.frame!.y - b.frame!.y || a.frame!.x - b.frame!.x);
}

const OVERLAP_EPSILON = 1e-9;

/** `true` when frames `a` and `b`'s vertical extents `[y, y+h)` overlap — the geometric definition of "these two slots were meant to sit in the same row," regardless of how their `x`/`w` differ. */
function verticallyOverlaps(a: Frame, b: Frame): boolean {
  return a.y < b.y + b.h - OVERLAP_EPSILON && b.y < a.y + a.h - OVERLAP_EPSILON;
}

/**
 * Names every real loss of fidelity `orderEntries` causes, as a
 * `RenderWarning[]` — never silent. Two distinct kinds, per this
 * package's own task brief:
 *
 *   - `"slots-stacked"` — two or more entries whose frames vertically
 *     overlap (see {@link verticallyOverlaps}) were positioned
 *     side-by-side on the original canvas and are now rendered as
 *     separate full-width rows, one after another, instead. Detected by
 *     grouping entries into overlap clusters (a simple union-find over
 *     all pairs — the entry count per email document is small enough that
 *     the naive O(n^2) pairwise comparison this uses is not a real cost);
 *     any cluster with more than one entry produces one warning naming
 *     every slot key in it, in the ordering `orderEntries` already
 *     produced.
 *   - `"slot-width-lost"` — any entry whose `frame.w < 1` (it was sized
 *     to less than the full canvas — i.e. it was one column of a
 *     multi-column row, or simply narrower than full width on purpose)
 *     now renders at the email's full content width regardless, because
 *     table-stacked email has no narrower unit to give it. Reported per
 *     slot, independently of whether that slot also appears in a
 *     `"slots-stacked"` warning — a slot can lose its width even when it
 *     had no row-mate (a single narrow, centered slot), and a slot that
 *     had a row-mate loses BOTH its position and its width, which is two
 *     separate facts a caller needs, not one.
 *
 * Called only when `renderEmailDocument` was given a REAL, caller-supplied
 * `LayoutSpec` — never for the synthetic, placeholder-frame layout built by
 * {@link buildSyntheticLayout}, where every frame is identical and "these
 * two slots overlap" would be true of every pair for a reason that has
 * nothing to do with the original document's real geometry. See this
 * file's top comment.
 */
export function buildGeometryWarnings(entries: readonly GeometryEntry[]): RenderWarning[] {
  const warnings: RenderWarning[] = [];

  // Union-find over `entries` (by index), clustering any two whose frames
  // vertically overlap.
  const parent = entries.map((_, i) => i);
  function find(i: number): number {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]!]!;
      i = parent[i]!;
    }
    return i;
  }
  function union(a: number, b: number): void {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  }

  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      if (verticallyOverlaps(entries[i]!.frame!, entries[j]!.frame!)) {
        union(i, j);
      }
    }
  }

  const clusters = new Map<number, number[]>();
  for (let i = 0; i < entries.length; i++) {
    const root = find(i);
    const group = clusters.get(root);
    if (group) group.push(i);
    else clusters.set(root, [i]);
  }

  for (const group of clusters.values()) {
    if (group.length < 2) continue;
    // Report in the same top-to-bottom/left-to-right order orderEntries
    // itself produces, i.e. `entries`' own (already-sorted) order.
    const keys = group
      .slice()
      .sort((a, b) => a - b)
      .map((i) => entries[i]!.key);
    warnings.push({
      code: "slots-stacked",
      slots: keys,
      message: `Slot(s) ${keys.join(", ")} were positioned side-by-side (overlapping vertical extents, different x) in the supplied layout. Email cannot place content side-by-side, so they are now stacked as separate full-width rows, in top-to-bottom / left-to-right order — the side-by-side arrangement is lost.`,
    });
  }

  for (const entry of entries) {
    if (entry.frame!.w < 1) {
      warnings.push({
        code: "slot-width-lost",
        slots: [entry.key],
        message: `Slot "${entry.key}" was sized to ${entry.frame!.w * 100}% of the canvas width in the supplied layout. Email has no narrower-than-full-width unit once a slot is stacked into the vertical flow, so it now renders at the email's full content width — its intended width is lost.`,
      });
    }
  }

  return warnings;
}
