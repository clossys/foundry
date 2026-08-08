/**
 * Public types for `@vespeneventures/render/print`. See
 * `renderPrintDocument.ts`'s own doc comment for the full picture: this
 * channel emits a deterministic, paged-media HTML+CSS document string from
 * a `channel: "print"` `ComposeDocument` — never a PDF, never via a
 * headless browser. See this package's README, the `./print` section, for
 * why.
 *
 * Deliberately does NOT import `./web`'s `CopyResolver` (or any other type
 * from a sibling channel) — every channel in this package defines its own
 * small option/result shapes, even where the shape happens to match a
 * sibling channel's, because three renderer channels are built in parallel
 * against this same package and a cross-channel type import is exactly the
 * kind of coupling that turns an independently-owned file into a merge
 * hazard for someone else's work. `CopyResolver` below is byte-for-byte the
 * same signature `./web`'s own `CopyResolver` uses, on purpose — same
 * problem, same seam, same answer — just not the same declaration.
 */

import type { PrintMeta } from "@vespeneventures/compose";

// ---------------------------------------------------------------------------
// CopyResolver — the copyId seam, resolved the same way ./web resolves it
// ---------------------------------------------------------------------------

/**
 * Resolves a `SlotBinding.copyId` into literal display text — see
 * `@vespeneventures/compose`'s own README, "The `copyId` seam", for the
 * fuller reasoning behind the seam itself. Synchronous, on the same grounds
 * `./web`'s own `CopyResolver` doc comment gives: `renderPrintDocument`
 * builds its HTML string in one pass, and an async resolver would force
 * every caller into an async render path even when their copy source is
 * already fully loaded in memory. Returns `undefined` for an id the
 * resolver has no text for — treated as UNRESOLVED (see
 * `renderPrintDocument`'s own "empty-output" refusal), never as a signal to
 * fall back to anything else.
 */
export type CopyResolver = (copyId: string) => string | undefined;

// ---------------------------------------------------------------------------
// AssetResolver — the assetId seam, resolved the same way ./web resolves it
// ---------------------------------------------------------------------------

/**
 * Resolves a `SlotBinding.assetId` into a real asset — the identical seam
 * `CopyResolver` draws for `copyId`, one binding field over, and the same
 * local (not cross-channel-imported) declaration this file's own top
 * comment explains for `CopyResolver`. Same shape as `@vespeneventures/
 * compose`'s own `AssetLookup`: returns `unknown` on purpose — whatever
 * comes back is validated into a real, paintable `RenderAsset` by
 * `../internal/assets.ts`'s `resolveDocumentAssets` before this channel
 * ever uses it (see `renderPrintDocument.ts`). Returns `undefined`/`null`
 * for an id the resolver has no asset for — UNRESOLVED, which this
 * channel's own resolution bar treats exactly like an unresolved `copyId`:
 * fatal, never a silently omitted or blank image.
 */
export type AssetResolver = (assetId: string) => unknown;

// ---------------------------------------------------------------------------
// CustomPageSize — the escape hatch PrintMeta itself doesn't carry
// ---------------------------------------------------------------------------

/**
 * Explicit page dimensions, required by `renderPrintDocument` whenever
 * `doc.meta.pageSize === "Custom"`. `PrintMeta` itself (the frozen
 * contract — see `@vespeneventures/compose`'s `types.ts`) has no
 * width/height field for `"Custom"`; the only three page-size states it
 * can express are `"A4"`, `"Letter"`, and `"Custom"` with no attached
 * dimensions at all. `renderPrintDocument` refuses
 * (`RenderError("missing-custom-page-size", ...)`) rather than silently
 * defaulting to A4 — see this package's README, "`pageSize: "Custom"` with
 * no explicit dimensions is an ERROR, not a default" — for why that
 * default would be actively dangerous: a silent fallback here means
 * someone prints 500 copies at the wrong trim size.
 */
export interface CustomPageSize {
  /** A CSS length for the page's total width, e.g. `"148mm"`, `"6in"`. Used verbatim in the `@page` rule's `size` descriptor — see `internal/page.ts`. */
  width: string;
  /** A CSS length for the page's total height, e.g. `"210mm"`, `"9in"`. */
  height: string;
}

// ---------------------------------------------------------------------------
// RenderPrintOptions / RenderPrintResult
// ---------------------------------------------------------------------------

export interface RenderPrintOptions {
  /** See {@link CopyResolver}. Omit when every binding in the document uses `value`, never `copyId` — every `copyId` binding is then treated as unresolved. */
  resolveCopyId?: CopyResolver;
  /** See {@link AssetResolver}. Omit when no binding in the document uses `assetId` — every `assetId` binding is then treated as unresolved, which is always fatal for this channel (see `renderPrintDocument.ts`). */
  resolveAssetId?: AssetResolver;
  /** Required when `doc.meta.pageSize === "Custom"`; ignored otherwise. See {@link CustomPageSize}. */
  customPageSize?: CustomPageSize;
  /** Brand token overrides, passed straight through to `@vespeneventures/tokens`'s `flattenTokens(overrides)` (via the shared `internal/tokens.ts`). Omit to render with every token at its own default value. */
  tokenOverrides?: Record<string, string>;
  /**
   * `SlotSpec.key`s that must start on a fresh page — emits
   * `break-before:page;` (plus the legacy `page-break-before:always;` for
   * older engines) on that slot's box. See this package's README,
   * "Page-break control".
   */
  breakBefore?: string[];
  /** `SlotSpec.key`s that must be immediately followed by a page break — `break-after:page;` (`page-break-after:always;`). */
  breakAfter?: string[];
  /**
   * `SlotSpec.key`s EXEMPTED from this renderer's default
   * `break-inside:avoid;` (`page-break-inside:avoid;`) — every slot gets
   * that default unless its key is listed here. See the README for why the
   * default is "avoid" rather than "auto".
   */
  allowBreakInside?: string[];
}

/** The page dimensions and metadata `renderPrintDocument` actually resolved and rendered against. */
export interface PrintPageInfo {
  pageSize: PrintMeta["pageSize"];
  orientation: PrintMeta["orientation"];
  /** The page's total width as a CSS length — a named size's real physical dimension (`"210mm"` for A4 portrait) or `options.customPageSize.width` verbatim for `"Custom"`. */
  width: string;
  /** The page's total height as a CSS length. See `width`. */
  height: string;
  /** `doc.meta.dpi`, carried through unchanged. Metadata for a downstream rasterizer — this package never reads it to change rendering behaviour. See the README. */
  dpi?: number;
}

/** What `renderPrintDocument` returns. */
export interface RenderPrintResult {
  /**
   * The complete, standalone HTML document — `<!doctype html>` through
   * `</html>` — as a single string. A browser's print pipeline (or a
   * downstream rasterizer fed this same markup) renders it directly; this
   * package does not paginate, rasterize, or emit a PDF itself. See the
   * README, "The key architectural decision".
   */
  html: string;
  /** The page geometry/metadata this render actually used. See {@link PrintPageInfo}. */
  page: PrintPageInfo;
}
