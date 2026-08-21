import type { AssetLookup, CopyLookup, ImageMeta } from "../core/index.js";

// ---------------------------------------------------------------------------
// RenderImageOptions / RenderImageResult
// ---------------------------------------------------------------------------

export interface RenderImageOptions {
  /**
   * Resolves a `SlotBinding.copyId` into literal display text — the exact
   * `CopyLookup` shape `@vespeneventures/publisher/core`'s own `resolveCopy` takes
   * (see that function's doc comment). Omit when every binding in the
   * document uses `value`, never `copyId`; every `copyId` binding is then
   * treated as unresolved.
   */
  resolveCopyId?: CopyLookup;
  /**
   * Resolves a `SlotBinding.assetId` into a real asset — the exact
   * `AssetLookup` shape `@vespeneventures/publisher/core`'s own `resolveAssets`
   * takes. Omit when no binding in the document uses `assetId`; every
   * `assetId` binding is then treated as unresolved, which is ALWAYS fatal
   * for this channel (see `resolveCanvasLayout.ts`'s own doc comment,
   * "Assets get a stricter bar than optional text") — unlike an unresolved
   * OPTIONAL `copyId`, which only produces a non-fatal warning.
   */
  resolveAssetId?: AssetLookup;
  /**
   * Passed straight through to `internal/tokens.ts`'s `flattenTokens` — a
   * caller with a real brand's token overrides supplies them here so every
   * `StyleBinding` color role in the document resolves against the brand's
   * own values instead of `@vespeneventures/designer/tokens`' defaults. Omit to use
   * the un-branded defaults.
   */
  tokenOverrides?: Record<string, string>;
}

/** What `renderImageDocument` returns: the rendered SVG plus everything a caller needs to know about how it was rendered. See `renderImageDocument.ts`'s own doc comment for the full picture. */
export interface RenderImageResult {
  /** The complete, self-contained SVG document — a deterministic string, byte for byte, for identical input (see this package's README, "Architectural decision, already made"). */
  svg: string;
  /** `ImageMeta.format` as requested — this function ALWAYS emits SVG regardless of this value; see `warnings` for the rasterization notice when it isn't `"svg"`. Never silently pretend a PNG/JPEG/WebP was produced. */
  requestedFormat: ImageMeta["format"];
  /** The emitted `<svg>` `width` attribute — `ImageMeta.width * (scale ?? 1)`. */
  width: number;
  /** The emitted `<svg>` `height` attribute — `ImageMeta.height * (scale ?? 1)`. */
  height: number;
  /** The `<svg>` `viewBox`'s logical (unscaled) size — always `{ width: ImageMeta.width, height: ImageMeta.height }`, regardless of `scale`. See `engine.ts`'s `computeCanvasDimensions` for why viewBox never scales. */
  viewBox: { width: number; height: number };
  /** The `scale` actually applied — `ImageMeta.scale ?? 1`. */
  scale: 1 | 2;
  /**
   * Every non-fatal finding this render produced, in the order encountered
   * — NEVER a reason to refuse rendering, but never silently dropped
   * either. Includes: one entry per slot whose text overflowed its frame
   * and was truncated (see `engine.ts`'s `wrapText`), one entry per
   * optional slot that matched a binding but produced no text and was
   * omitted, and (when `requestedFormat !== "svg"`) one entry noting that
   * rasterization is the caller's own responsibility.
   */
  warnings: string[];
}
