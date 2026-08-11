import type { ReactNode } from "react";

// ---------------------------------------------------------------------------
// CopyResolver — the copyId seam, resolved
// ---------------------------------------------------------------------------

/**
 * Resolves a `SlotBinding.copyId` into literal display text. `compose`
 * deliberately does not resolve `copyId` itself — see its README, "The
 * `copyId` seam" — and neither does this package resolve it against any
 * particular copy source. This function type IS the decision this package
 * makes about that seam: a caller who has already loaded a
 * `@vespeneventures/copy` registry (or any other copy source) supplies a
 * synchronous lookup from id to resolved text; a caller with nothing to
 * resolve against simply omits `resolveCopyId`, and every `copyId` binding
 * is then treated as unresolved (see `renderWebDocument`'s own doc comment
 * for exactly what that does to the render).
 *
 * Deliberately synchronous, not `Promise`-returning: `renderWebDocument`
 * builds a React element tree in one pass, and an async resolver would
 * force every caller into an async render path even when their copy source
 * is already fully loaded in memory (the common case — a build-time static
 * page, or a request that already fetched its `CopyRecord` before calling
 * this function). A caller with a genuinely async copy source resolves
 * every `copyId` a document needs up front and closes over the results in
 * a synchronous function, the same pattern `@vespeneventures/copy`'s own
 * README recommends for its registry reader.
 *
 * Returns `undefined` for an id the resolver has no text for — treated
 * identically to not supplying a `resolveCopyId` at all for that one
 * binding, not as an error. A resolver that wants a missing id to be fatal
 * throws instead.
 */
export type CopyResolver = (copyId: string) => string | undefined;

// ---------------------------------------------------------------------------
// AssetResolver — the assetId seam, resolved the same way copyId is
// ---------------------------------------------------------------------------

/**
 * Resolves a `SlotBinding.assetId` into a real asset — the identical seam
 * `CopyResolver` draws for `copyId`, one binding field over. Same shape as
 * `@vespeneventures/surface/core`'s own `AssetLookup` (`(assetId: string) =>
 * unknown`), declared locally here rather than imported, for the same
 * reason `CopyResolver` is its own local declaration and not `compose`'s
 * `CopyLookup` — see `RenderWebOptions`'s own doc comment history for why
 * this package's `./web` and `./print` channels keep their own small type
 * declarations rather than a cross-channel import.
 *
 * Returns `unknown` on purpose: a caller might hand back a real
 * `@vespeneventures/surface/media` `AssetEntry`, a bare object literal built for a
 * test, or anything else with the right shape — `renderWebDocument` (via
 * `../internal/assets.ts`'s `resolveDocumentAssets`) validates whatever
 * comes back into a real, paintable `RenderAsset` (`src`/`width`/`height`/
 * `alt`) before ever using it, and refuses to render rather than trust an
 * unchecked shape. Returns `undefined`/`null` for an id the resolver has no
 * asset for — treated as UNRESOLVED, never as a signal to render a blank
 * image.
 */
export type AssetResolver = (assetId: string) => unknown;

// ---------------------------------------------------------------------------
// RenderWebOptions / RenderWebResult
// ---------------------------------------------------------------------------

export interface RenderWebOptions {
  /** See {@link CopyResolver}. Omit when every binding in the document uses `value`, never `copyId`. */
  resolveCopyId?: CopyResolver;
  /**
   * See {@link AssetResolver}. Omit when no binding in the document uses
   * `assetId` — every `assetId` binding is then treated as unresolved,
   * which is fatal for that binding (see `renderWebDocument.ts`'s own doc
   * comment on why an unresolved asset is never silently omitted the way an
   * unresolved OPTIONAL text binding is).
   */
  resolveAssetId?: AssetResolver;
}

/** What `renderWebDocument` returns: the two things a web `ComposeDocument` renders to. See `renderWebDocument.ts`'s own doc comment. */
export interface RenderWebResult {
  /** The composed `@vespeneventures/ui` view element — the `ComposeDocument.template` view with its bindings resolved into its slots. Render this with your own React tree (or `react-dom/server`) however your app already does. */
  element: ReactNode;
  /** The document's head metadata, as a plain serialisable object — see {@link WebHeadMetadata}. */
  head: WebHeadMetadata;
}

// ---------------------------------------------------------------------------
// WebHeadMetadata — plain, serialisable, framework-agnostic
// ---------------------------------------------------------------------------

/**
 * `WebMeta`, reshaped into the plain object every framework's own head/meta
 * API can be built from in a few lines — deliberately NOT any one
 * framework's own `Metadata` type (Next.js's, Remix's, or anyone else's).
 * Coupling this package to one framework's type would strand every other
 * consumer; a plain object is adaptable by all of them equally. See this
 * package's README, "Why `WebHeadMetadata` is a plain object, not a
 * framework type" for a worked Next.js adapter.
 */
export interface WebHeadMetadata {
  title: string;
  description: string;
  canonical?: string;
  robots?: string;
  keywords?: string[];
  openGraph?: WebOpenGraphMetadata;
  twitter?: WebTwitterMetadata;
  /**
   * Zero or more `<script type="application/ld+json">`-ready payloads —
   * each entry is already `JSON.stringify`'d AND escaped safe for
   * `<script>` embedding (see `internal/jsonLd.ts`'s `serializeJsonLd`).
   * Drop each string directly into a script tag's raw text content (e.g.
   * React's `dangerouslySetInnerHTML={{ __html: entry }}`, never string
   * concatenation into an HTML template) — each entry is pre-escaped
   * exactly once; escaping it again would double-encode it, and rendering
   * it through anything that HTML-escapes text content (a plain `{entry}`
   * JSX child, for instance) would corrupt it into invalid JSON.
   */
  jsonLd: string[];
}

export interface WebOpenGraphMetadata {
  title?: string;
  description?: string;
  image?: string;
  type?: string;
}

export interface WebTwitterMetadata {
  card?: "summary" | "summary_large_image";
  site?: string;
}
