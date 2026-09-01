import type { ReactNode } from "react";
import type { ComposeDocument, FlowLayoutSpec, ResolvedSurfaceGroup, ResolvedSurfaceNode } from "../core/index.js";

// ---------------------------------------------------------------------------
// CopyResolver — the copyId seam, resolved
// ---------------------------------------------------------------------------

/**
 * Resolves a `SlotBinding.copyId` into literal display text. `surface/core`
 * deliberately does not resolve `copyId` itself — see its README, "The
 * `copyId` seam" — and neither does this package resolve it against any
 * particular copy source. This function type IS the decision this package
 * makes about that seam: a caller who has already loaded a
 * `@clossys/writer` registry (or any other copy source) supplies a
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
 * a synchronous function, the same pattern `@clossys/writer`'s own
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
 * `@clossys/publisher/core`'s own `AssetLookup` (`(assetId: string) =>
 * unknown`), declared locally here rather than imported, for the same
 * reason `CopyResolver` is its own local declaration and not `surface/core`'s
 * `CopyLookup` — see `RenderWebOptions`'s own doc comment history for why
 * this package's `./web` and `./print` channels keep their own small type
 * declarations rather than a cross-channel import.
 *
 * Returns `unknown` on purpose: a caller might hand back a real
 * `@clossys/publisher/media` `AssetEntry`, a bare object literal built for a
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
  /**
   * A resolved `SurfaceDocument`'s repeating-group content — the same
   * `ResolvedSurfaceDocument.groups` `resolveSurfaceDocument` (`surface/
   * core`) produces for any `SurfaceRepeatingSlotBinding`. Omit when the
   * document has no repeating binding at all (the same convention
   * `ResolvedSurfaceDocument.groups` itself uses — omitted, not an empty
   * array). Only a template that declares matching `repeatingSlots`
   * (currently `MarketingView` — see `internal/webTemplates.ts`) reads
   * this; `AuthView`/`ErrorView` ignore it, and passing a group for a slot
   * neither of them declares is refused the same way an unknown
   * `SlotBinding.slot` already is — see `renderWebDocument.ts`'s own doc
   * comment.
   */
  groups?: ResolvedSurfaceGroup[];
  /**
   * A resolved `SurfaceDocument`'s single-binding `node` content — the
   * same `ResolvedSurfaceDocument.nodes` `resolveSurfaceDocument`
   * (`surface/core`) produces for a `SurfaceSlotBinding` whose source is
   * `node` and whose `slot` was named in that call's own `nodeSlots`
   * option. Omit when the document has no such binding at all (the same
   * "omitted, not an empty array" convention `groups` itself uses). Only a
   * slot the target template declares `"node"`-kind (via `WebTemplate.
   * slotKinds`, set through `defineWebTemplate`) accepts an entry here —
   * see `renderWebDocument.ts`'s own doc comment for the exact fail-closed
   * rule when a node targets an unknown or non-node-kind slot.
   */
  nodes?: ResolvedSurfaceNode[];
  /**
   * Whether THIS render should treat `prefers-reduced-motion: reduce` as
   * active — governs autoplay for every `VideoAssetEntry`-sourced
   * `<video>` this render produces (see `VideoAssetEntry.reducedMotion`,
   * `@clossys/publisher/media`). Omitted (the default) means "unknown/
   * not reduced" — every video's own `autoplay` is honoured exactly as
   * authored, the same regression-safe default `resolveCopyId`/
   * `resolveAssetId` already use for "caller didn't wire this up."
   *
   * THIS PACKAGE HAS NO `window`/DOM ACCESS AT RENDER TIME — see
   * `renderWebDocument.ts`'s own doc comment, "Reduced motion is a
   * rendering-time decision, not a build-time one," for why this cannot be
   * checked automatically inside `renderWebDocument` itself and must
   * instead be a caller-supplied boolean, the same "opaque seam, explicit
   * input" pattern `resolveCopyId`/`resolveAssetId` already use. A
   * server-rendering caller typically derives this from a
   * `Sec-CH-Prefers-Reduced-Motion` client hint or a cookie set by an
   * earlier client-side check; a client-only caller passes
   * `window.matchMedia("(prefers-reduced-motion: reduce)").matches`
   * directly.
   */
  prefersReducedMotion?: boolean;
}

/** What `renderWebDocument` returns: the two things a web `ComposeDocument` renders to. See `renderWebDocument.ts`'s own doc comment. */
export interface RenderWebResult {
  /** The composed `@clossys/designer` view element — the `ComposeDocument.template` view with its bindings resolved into its slots. Render this with your own React tree (or `react-dom/server`) however your app already does. */
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

// ---------------------------------------------------------------------------
// WebSlotContentKind / WebTemplate — the extensible template registry
// ---------------------------------------------------------------------------

/**
 * What a `WebTemplate`'s declared flowed slot is permitted to receive.
 * Closed vocabulary, deliberately three members and no more:
 *
 *   - `"copy"` — resolved `CopyRef` text (a `SurfaceSlotBinding.copy`,
 *     lowered by `resolveSurfaceDocument` into a plain string).
 *   - `"asset"` — a resolved `AssetRecord` (a `SurfaceSlotBinding.assetId`),
 *     rendered as a real `<img>`.
 *   - `"node"` — a caller-owned `ReactNode` the caller's OWN trusted code
 *     already constructed (a composed `AuthView` form, a widget built from
 *     `@clossys/designer` atoms, a small caller-authored component) —
 *     never a raw HTML string, never audience-supplied or copy-registry
 *     content. This is the dangerous one: see `renderWebDocument.ts`'s own
 *     doc comment, "RICH-NODE SLOTS", for exactly what a `"node"`-kind slot
 *     may and may not contain, and why there is no `dangerouslySetInnerHTML`
 *     anywhere on this path. A `"node"`-kind slot is opt-in PER SLOT on a
 *     template's own `slotKinds` — never a renderer-wide switch a consumer
 *     could flip once to loosen every slot at once.
 *
 * A slot key absent from `WebTemplate.slotKinds` defaults to `["copy",
 * "asset"]` — the exact two sources `AuthView`/`ErrorView`'s existing
 * flowed slots already accept today, so a template defined without ever
 * mentioning `slotKinds` behaves identically to one that spelled the
 * default out by hand.
 */
export type WebSlotContentKind = "copy" | "asset" | "node";

/**
 * One resolved item inside a repeating web slot, already turned into
 * paintable React content by `renderWebDocument` — exactly one of
 * `text`/`element`/`node` is set. See `internal/webTemplates.ts` for the
 * fuller doc comment on why this exists as a separate shape from a single
 * slot's resolved content.
 */
export interface ResolvedWebGroupItem {
  index: number;
  text?: string;
  element?: ReactNode;
  node?: object;
  /** Named, already-resolved copy/asset fields for a structured repeating item. */
  fields?: Record<string, ResolvedWebGroupField>;
}

/** One already-renderable field inside {@link ResolvedWebGroupItem.fields}. */
export interface ResolvedWebGroupField {
  text?: string;
  element?: ReactNode;
}

/** One named field a structured repeating slot accepts. */
export interface RepeatingWebSlotFieldSpec {
  key: string;
  required?: boolean;
}

/** One repeating slot key a `WebTemplate` expects to receive via `RenderWebOptions.groups`, and whether that slot must be present (not necessarily non-empty). */
export interface RepeatingWebSlotSpec {
  key: string;
  required?: boolean;
  /**
   * When present, every item must carry a `fields` map containing only these
   * declared names. Required fields must be present; `node` is never a field
   * source, so editorial copy remains CopyRef-resolved and attributable.
   */
  fields?: RepeatingWebSlotFieldSpec[];
}

/**
 * One template a `WebRenderer` knows how to render — the unit both the
 * three built-ins (`AuthView`, `ErrorView`, `MarketingView`) and a
 * consumer's own `defineWebTemplate`-built entries share. `flow` is
 * handed to the shared `resolveDocument(doc, flow)` resolver exactly as
 * every existing template already uses it; `build` turns resolved slot
 * content into the real `@clossys/designer`-composed element. See
 * `defineWebTemplate` for the validated, frozen way to construct one of
 * these — constructing a `WebTemplate` object literal by hand bypasses
 * that validation, the same way constructing a `SurfaceDocument` by hand
 * bypasses `validateSurfaceDocument` until something actually calls it.
 */
export interface WebTemplate {
  /** The exact `SurfaceDocument.template` string this entry answers to. */
  name: string;
  /** Handed to `resolveDocument(doc, flow)` as-is. */
  flow: FlowLayoutSpec;
  /** The repeating slot keys this template expects. Omitted (or empty) for a template with no repeating content, e.g. `AuthView`/`ErrorView`. */
  repeatingSlots?: RepeatingWebSlotSpec[];
  /**
   * Declares what each of `flow.slots`' keys may be filled with. A slot
   * key absent from this map defaults to `["copy", "asset"]` — see
   * `WebSlotContentKind`'s own doc comment. A slot must be listed with
   * `"node"` explicitly (alongside or instead of `"copy"`/`"asset"`) to
   * accept a rich node; this is opt-in per slot, never a renderer-wide
   * switch.
   */
  slotKinds?: Record<string, WebSlotContentKind[]>;
  /**
   * Builds the real element from resolved slot content. Missing optional
   * slots are simply absent keys in `content`. `groups` carries every
   * repeating slot's resolved items, keyed by slot — absent for a
   * template with no `repeatingSlots`, or for an optional repeating slot
   * this document never bound. A `build` function for a template with no
   * repeating slots may ignore the second parameter entirely.
   */
  build: (content: Record<string, ReactNode>, groups: Record<string, ResolvedWebGroupItem[]>) => ReactNode;
}

/**
 * What `defineWebTemplate` accepts — everything needed to construct one
 * validated, frozen `WebTemplate`. See `defineWebTemplate`'s own doc
 * comment for the exact validation performed and what throws.
 */
export interface DefineWebTemplateOptions {
  /** The exact `SurfaceDocument.template` string this entry answers to. Must be unique within whichever renderer it is registered on — see `createWebRenderer`. */
  name: string;
  /** Same shape every existing template already uses — see `WebTemplate.flow`. */
  flow: FlowLayoutSpec;
  /** See `WebTemplate.slotKinds`. */
  slotKinds?: Record<string, WebSlotContentKind[]>;
  /** See `WebTemplate.repeatingSlots`. */
  repeatingSlots?: RepeatingWebSlotSpec[];
  /** See `WebTemplate.build`. */
  build: (content: Record<string, ReactNode>, groups: Record<string, ResolvedWebGroupItem[]>) => ReactNode;
}

/**
 * What `createWebRenderer` accepts. See `createWebRenderer`'s own doc
 * comment — in `internal/createWebRenderer.ts` — for the full instance-
 * scoping argument this type exists to support.
 */
export interface CreateWebRendererOptions {
  /** Every template this renderer instance knows, beyond any built-ins. Construct each with `defineWebTemplate`. */
  templates?: WebTemplate[];
  /**
   * Register `AuthView`/`ErrorView`/`MarketingView` under this instance
   * too. Default `false` — a renderer built with no arguments at all
   * knows ZERO templates, not the three built-ins; see `createWebRenderer`'s
   * own doc comment, "Built-ins become opt-in, not gone".
   */
  includeBuiltins?: boolean;
}

/**
 * One isolated template registry plus the renderer bound to it — what
 * `createWebRenderer` returns. Every method here is scoped to exactly the
 * templates that renderer instance was built with; a second, independently
 * created `WebRenderer` never observes them, and vice versa. See
 * `createWebRenderer`'s own doc comment for the full instance-scoping
 * argument.
 */
export interface WebRenderer {
  /** Identical contract to the module-level `renderWebDocument`, scoped to this instance's own templates. */
  renderWebDocument(doc: ComposeDocument, options?: RenderWebOptions): RenderWebResult;
  /** Identical contract to the module-level `listWebTemplateNames`, scoped to this instance's own templates. */
  listWebTemplateNames(): string[];
  /** The `WebTemplate` registered under `name` on THIS instance, or `undefined` if `name` names no template this instance knows. */
  getWebTemplate(name: string): WebTemplate | undefined;
}
