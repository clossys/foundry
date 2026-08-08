import type { AssetLookup, ComposeDocument, CopyLookup, SlidesMeta } from "@vespeneventures/compose";

// ---------------------------------------------------------------------------
// SlidesDeckInput — the input shape decision this package makes
// ---------------------------------------------------------------------------

/**
 * The input shape `renderSlidesDeck` takes. **A plain, ordered array of
 * `ComposeDocument`, each `channel: "slides"`, plus deck-wide speaker
 * notes** — see `renderSlidesDeck.ts`'s own doc comment, "Deciding the
 * input shape", for the full argument against the two alternatives the
 * task brief itself named (one document per slide vs. one document with
 * multiple layouts) and for why `notes` lives here, on the deck, rather
 * than on any one slide's own `SlidesMeta.notes`.
 */
export interface SlidesDeckInput {
  /** A stable id for the whole deck — used only in error/warning messages, never in output markup. */
  id: string;
  /**
   * The ordered slides. **Array index IS deck order** — never inferred
   * from `ComposeDocument.id`, from `notes`' own key order, or from any
   * other implicit signal. Each entry is a full `ComposeDocument` with
   * `channel: "slides"` and its own `template`/`bindings`/`layout` (one
   * slide's positioned slots) — `meta.aspect` must be identical across
   * every entry (see `"inconsistent-deck-aspect"` in `internal/errors.ts`).
   */
  slides: ComposeDocument[];
  /**
   * Deck-wide speaker notes, keyed by slide id (`ComposeDocument.id`) — the
   * same shape `SlidesMeta.notes` itself declares, but read from HERE, the
   * deck-level input, never from any individual slide document's own
   * `meta.notes` (see `renderSlidesDeck.ts` for why). A key naming no slide
   * in `slides` is reported in `RenderSlidesResult.unknownNoteKeys` — never
   * silently dropped, and never thrown either: it almost always means a
   * renamed slide and lost speaker notes, worth surfacing, not worth
   * refusing an otherwise-good render over.
   */
  notes?: Record<string, string>;
}

// ---------------------------------------------------------------------------
// RenderSlidesOptions / RenderedSlide / RenderSlidesResult
// ---------------------------------------------------------------------------

export interface RenderSlidesOptions {
  /** See `RenderImageOptions.resolveCopyId` (`../image/types.ts`) — the identical `CopyLookup` shape, applied uniformly to every slide in the deck. */
  resolveCopyId?: CopyLookup;
  /** See `RenderImageOptions.resolveAssetId` (`../image/types.ts`) — the identical `AssetLookup` shape, applied uniformly to every slide in the deck. An unresolved `assetId` binding is ALWAYS fatal (see `../image/resolveCanvasLayout.ts`'s own doc comment), so one slide with a broken image fails the whole deck exactly like a failed `resolveCopyId` already does — see `renderSlidesDeck.ts`, "one failing slide fails the whole deck". */
  resolveAssetId?: AssetLookup;
  /** See `RenderImageOptions.tokenOverrides` — applied uniformly to every slide in the deck, so a whole deck renders against one consistent brand. */
  tokenOverrides?: Record<string, string>;
}

/** One rendered slide. */
export interface RenderedSlide {
  /** `ComposeDocument.id` of the `SlidesDeckInput.slides` entry this came from. */
  id: string;
  /** This slide's position in `SlidesDeckInput.slides` — the same explicit deck order the input declared, carried straight through. */
  index: number;
  /** The complete, self-contained SVG document for this one slide's canvas. */
  svg: string;
  /** This slide's speaker notes, from `SlidesDeckInput.notes[id]` — absent when no note was given for this slide's id. */
  notes?: string;
  /** Non-fatal findings for this slide only (overflow truncations, omitted optional slots) — see `RenderImageResult.warnings` for the identical bar. */
  warnings: string[];
}

/** What `renderSlidesDeck` returns. */
export interface RenderSlidesResult {
  /** Every slide, in the same order as `SlidesDeckInput.slides`. */
  slides: RenderedSlide[];
  /** The deck's fixed canvas width, in pixels — see `canvas.ts`'s `canvasForAspect`. Every slide in the deck shares this exact size. */
  width: number;
  /** The deck's fixed canvas height, in pixels. */
  height: number;
  /** The deck's aspect, read from (and verified identical across) every slide's own `SlidesMeta.aspect`. */
  aspect: SlidesMeta["aspect"];
  /** `SlidesDeckInput.notes` keys that matched no slide id in `SlidesDeckInput.slides` — reported, never dropped, never thrown. See `SlidesDeckInput.notes`'s own doc comment. */
  unknownNoteKeys: string[];
  /** Every slide's own `warnings`, flattened and prefixed with `slide "<id>": ` — a caller who only wants "did anything need attention" can check this one array without walking `slides` itself. */
  warnings: string[];
}
