/**
 * The frozen contract this package ships. Five renderer packages — one per
 * `Channel` — will be built by other agents against exactly this shape, so
 * every field below is load-bearing: renamed, added, or reshaped only in a
 * coordinated change, never as a local convenience.
 *
 * `surface/core` is the join point where `@vespeneventures/ui`'s visual
 * vocabulary meets `@vespeneventures/copy`'s verbal one, plus everything a
 * specific output channel needs to know: a `ComposeDocument` names a
 * template, binds its slots to copy ids or literal values, targets a
 * `Channel`, and carries that channel's own metadata. This package renders
 * nothing — see the README, "What this package is", for the fuller
 * argument for why that boundary holds and why it is zero-dependency by
 * design (no React, no schema library, no dependency on `ui` or `copy`
 * themselves).
 */

// ---------------------------------------------------------------------------
// Channel — the closed vocabulary of output targets
// ---------------------------------------------------------------------------

export type Channel = "web" | "email" | "print" | "slides" | "image";

/**
 * `Channel`'s own members, as a runtime array — the same "closed vocabulary
 * as both a type and a value" shape `@vespeneventures/policy`'s
 * `DIGEST_ALGORITHMS` uses for `DigestAlgorithm`. Exported so a caller (or
 * this package's own `validate.ts`) can check membership or render a
 * human-readable list without re-typing the five literals by hand.
 */
export const CHANNELS = ["web", "email", "print", "slides", "image"] as const satisfies readonly Channel[];

import type { CopyRef } from "@vespeneventures/copy";

// ---------------------------------------------------------------------------
// SlotBinding — legacy content going into a named slot
// ---------------------------------------------------------------------------

/**
 * Content going into a named slot. Exactly one of `copyId`/`value`/
 * `assetId` must be set — never two, never all three, never none; see
 * `validate.ts`'s `"binding-source-exclusive"` rule (as of 0.3.0, an
 * exactly-one-of-THREE check, not exactly-one-of-two — see that rule's own
 * doc comment for the full truth table).
 */
export interface SlotBinding {
  /** The `SlotSpec.key` this binding fills. */
  slot: string;
  /**
   * A plain string id into a `CopyRecord` — deliberately **not** an import
   * of `@vespeneventures/copy`. Same seam as `@vespeneventures/copy/voice`'s
   * `Claim.factRef` and `@vespeneventures/copy`'s own `CopyEntry.factRef`:
   * the coupling is an opaque string convention, not a code import, so this
   * package works whether or not `copy` is even installed, and resolving a
   * `copyId` against a real `CopyRecord` is a later gate's job — one with
   * visibility into both sides, which this package deliberately does not
   * have. See the README, "The `copyId` seam".
   */
  copyId?: string;
  /** A literal string, for content that isn't registry-owned. */
  value?: string;
  /**
   * A plain string id into an `AssetRecord` — deliberately **not** an
   * import of `@vespeneventures/surface/media`. Added in 0.3.0 to close the gap
   * `ElementKind`'s `"image"`/`"logo"` members left open since this
   * package's first release: until now `SlotBinding` could only carry
   * text, so an `"image"`/`"logo"` slot could only ever render as a styled
   * word. Same seam as `copyId`, one binding field over: the coupling is
   * an opaque string convention, not a code import, so `surface/core` works
   * whether or not `@vespeneventures/surface/media` is even installed, and
   * resolving an `assetId` against a real `AssetRecord` is a later gate's
   * job — one with visibility into both sides, which this package
   * deliberately does not have. See `resolve-assets.ts`'s `resolveAssets`
   * for the resolution half of this seam, and the README, "The `assetId`
   * seam".
   */
  assetId?: string;
}

/**
 * Canonical content binding for a {@link SurfaceDocument}. User-facing text
 * is always a `CopyRef`; `node` is the explicit escape hatch for a
 * caller-owned interactive or rich UI node, and `assetId` remains the media
 * registry seam. Exactly one source is required.
 */
export interface SurfaceSlotBinding {
  slot: string;
  copy?: CopyRef;
  /**
   * A caller-owned rich/interactive node. Primitive values are excluded so
   * a string cannot bypass copy ownership by masquerading as a node.
   */
  node?: object;
  assetId?: string;
}

// ---------------------------------------------------------------------------
// Frame — a fractional position/size on the canvas
// ---------------------------------------------------------------------------

/**
 * Fractions of the canvas, 0..1 — never px, never inches. A `Frame` is
 * unit-agnostic on purpose: the exact same `LayoutSpec` serves a CSS
 * emitter (which wants percentages) and a slide emitter (which wants
 * inches) without either renderer needing a different document shape. See
 * `frame.ts`'s `frameToPercent`/`frameToInches` for the two conversions
 * renderers actually need, and the README for the prior-art this design
 * choice is based on.
 */
export interface Frame {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * A `Frame`-shaped rectangle in a concrete unit (percent or inches) rather
 * than a 0..1 fraction of the canvas. What `frameToPercent` and
 * `frameToInches` return — a distinct type from `Frame` on purpose, so a
 * value already converted to a concrete unit can never be mistaken for one
 * still in the 0..1 fractional space `Frame` itself promises.
 */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

// ---------------------------------------------------------------------------
// ElementKind — the closed vocabulary of slot content kinds
// ---------------------------------------------------------------------------

export type ElementKind =
  | "heading"
  | "subheading"
  | "body"
  | "eyebrow"
  | "label"
  | "stat"
  | "list"
  | "image"
  | "logo"
  | "button"
  | "divider"
  | "fill";

/** `ElementKind`'s own members, as a runtime array — see `CHANNELS` above for why this exists alongside the type. */
export const ELEMENT_KINDS = [
  "heading",
  "subheading",
  "body",
  "eyebrow",
  "label",
  "stat",
  "list",
  "image",
  "logo",
  "button",
  "divider",
  "fill",
] as const satisfies readonly ElementKind[];

// ---------------------------------------------------------------------------
// StyleBinding — token ROLE names, never values
// ---------------------------------------------------------------------------

/**
 * Token ROLE names only — a binding never holds a hex value or a font
 * size. The token layer (`@vespeneventures/ui/tokens`, or a consumer's own
 * equivalent) owns the value; this document owns the role. This package
 * does not validate that a role name actually exists in any particular
 * token set — it only validates that, when present, each field is a
 * non-empty string. Resolving a role against a real token set is a later
 * gate's job, the same seam `copyId` and `factRef` draw elsewhere in this
 * ecosystem.
 */
export interface StyleBinding {
  typography?: string;
  color?: string;
  background?: string;
  border?: string;
  weight?: string;
}

// ---------------------------------------------------------------------------
// SlotSpec / LayoutSpec — the layout a template's slots are placed on
// ---------------------------------------------------------------------------

export interface SlotSpec {
  key: string;
  element: ElementKind;
  frame: Frame;
  style?: StyleBinding;
  required?: boolean;
  align?: "start" | "center" | "end";
  vAlign?: "top" | "middle" | "bottom";
}

/** A flowed slot has no coordinates or visual kind. Its template controls order and presentation. */
export interface FlowSlotSpec {
  key: string;
  required?: boolean;
  style?: StyleBinding;
}

/** Ordered slots for a flowed web or email surface. */
export interface FlowLayoutSpec {
  slots: FlowSlotSpec[];
}

/**
 * The full set of positioned slots a `print`/`slides`/`image` document's
 * template exposes. **Meaningless for `web`/`email`** — every email client
 * forces an ordered block stack, and a web page flows the same way, so
 * neither channel has a coordinate system a `Frame` could sensibly place
 * anything on. `validate.ts` enforces this: a `layout` on a `web` or
 * `email` document is an error, and its absence on `print`/`slides`/`image`
 * is an error. See the README, "Why layout is channel-gated".
 */
export interface LayoutSpec {
  background?: StyleBinding;
  slots: SlotSpec[];
}

/** Canonical name for the positioned canvas layout used by print, slides, and images. */
export type CanvasLayoutSpec = LayoutSpec;

// ---------------------------------------------------------------------------
// ChannelMeta — one variant per Channel, discriminated on `channel`
// ---------------------------------------------------------------------------

export interface WebMeta {
  channel: "web";
  title: string;
  description: string;
  canonical?: string;
  robots?: string;
  keywords?: string[];
  og?: { title?: string; description?: string; image?: string; type?: string };
  twitter?: { card?: "summary" | "summary_large_image"; site?: string };
  jsonLd?: Record<string, unknown>[];
}

export interface EmailMeta {
  channel: "email";
  subject: string;
  /** Max 140 characters — see `validate.ts`'s `"email-preheader-length"` rule. */
  preheader: string;
  replyTo?: string;
  listUnsubscribe?: string;
}

export interface PrintMeta {
  channel: "print";
  pageSize: "A4" | "Letter" | "Custom";
  orientation: "portrait" | "landscape";
  margins: { top: string; right: string; bottom: string; left: string };
  bleed?: string;
  cropMarks?: boolean;
  dpi?: number;
}

export interface SlidesMeta {
  channel: "slides";
  aspect: "16:9" | "4:3";
  notes?: Record<string, string>;
}

export interface ImageMeta {
  channel: "image";
  width: number;
  height: number;
  format: "png" | "jpeg" | "webp" | "svg";
  scale?: 1 | 2;
  alt: string;
}

export type ChannelMeta = WebMeta | EmailMeta | PrintMeta | SlidesMeta | ImageMeta;

// ---------------------------------------------------------------------------
// SurfaceDocument — canonical, CopyRef-based surface contract
// ---------------------------------------------------------------------------

export interface SurfaceWebMeta {
  channel: "web";
  title: CopyRef;
  description: CopyRef;
  canonical?: string;
  robots?: string;
  keywords?: CopyRef[];
  og?: { title?: CopyRef; description?: CopyRef; image?: string; type?: string };
  twitter?: { card?: "summary" | "summary_large_image"; site?: string };
  jsonLd?: Record<string, unknown>[];
}

export interface SurfaceEmailMeta {
  channel: "email";
  subject: CopyRef;
  preheader: CopyRef;
  replyTo?: string;
  listUnsubscribe?: string;
}

export interface SurfaceSlidesMeta {
  channel: "slides";
  aspect: "16:9" | "4:3";
  notes?: Record<string, CopyRef>;
}

export interface SurfaceImageMeta {
  channel: "image";
  width: number;
  height: number;
  format: "png" | "jpeg" | "webp" | "svg";
  scale?: 1 | 2;
  alt: CopyRef;
}

export type SurfaceChannelMeta = SurfaceWebMeta | SurfaceEmailMeta | PrintMeta | SurfaceSlidesMeta | SurfaceImageMeta;

/**
 * The canonical authored surface. Flowed channels deliberately carry no
 * canvas layout; canvas channels use `CanvasLayoutSpec` only.
 */
export interface SurfaceDocument {
  id: string;
  channel: Channel;
  meta: SurfaceChannelMeta;
  template: string;
  bindings: SurfaceSlotBinding[];
  layout?: CanvasLayoutSpec;
}

/**
 * @deprecated Use `SurfaceDocument`. This legacy string-bearing contract is
 * retained for one migration release and for existing renderer callers.
 */
export interface ComposeDocument {
  id: string;
  channel: Channel;
  meta: ChannelMeta;
  template: string;
  bindings: SlotBinding[];
  layout?: LayoutSpec;
}

// ---------------------------------------------------------------------------
// Output manifest — the seam between rendering and consumer publication
// ---------------------------------------------------------------------------

export interface OutputArtifact {
  id: string;
  path: string;
  mediaType: string;
  /** A consumer-defined role such as `page`, `preview`, or `attachment`. */
  role?: string;
}

/**
 * Structural provenance accepted from a strategy package or a consumer's own
 * equivalent. Kept local and structural so surface never depends on strategy.
 */
export interface StrategyProvenance {
  strategyId: string;
  revision: string;
  records: Array<{ kind: string; id: string; revision: string }>;
  fingerprint: string;
}

/**
 * Registry-level copy provenance safe to attach to a published artifact.
 * It contains only identifiers and source revisions: resolved copy and
 * interpolation values can be audience-specific and must not be replayed
 * in a manifest.
 */
export interface CopyProvenance {
  recordId: string;
  revision: string;
  locale: string;
  source: { kind: "consumer" | "generated" | "imported"; reference: string };
  entryIds: string[];
}

/** Describes publishable artifacts without making this package own a filesystem. */
export interface OutputManifest {
  surfaceId: string;
  channel: Channel;
  artifacts: OutputArtifact[];
  provenance?: StrategyProvenance;
  /** Registry entries whose approved copy was resolved into this output. */
  copy?: CopyProvenance[];
}

// ---------------------------------------------------------------------------
// ComposeDocument — the whole document
// ---------------------------------------------------------------------------

/**
 * *This template, these slots filled from these copy ids, targeting this
 * channel, with this metadata.* The one document this whole package
 * exists to type and validate.
 */
// ---------------------------------------------------------------------------
// ComposeFinding — what validateComposeDocument reports
// ---------------------------------------------------------------------------

/**
 * One thing `validate.ts`'s shape validation found wrong with a candidate
 * `ComposeDocument`. Deliberately the same shape as
 * `@vespeneventures/copy`'s `CopyFinding` (itself mirroring
 * `@vespeneventures/copy/voice`'s `VoiceFinding` and `@vespeneventures/policy`'s
 * `Finding`) — `rule` / `severity` / `message` / optional `path` — so a
 * caller already handling one kind of finding in this ecosystem does not
 * need a second mental model for this package's. Always `"error"` in
 * practice: a malformed `ComposeDocument` is never merely a warning, the
 * same discipline every sibling package in this repository holds to for
 * its own shape-validation findings.
 */
export interface ComposeFinding {
  rule: string;
  severity: "error" | "warning";
  message: string;
  path?: string;
}

// ---------------------------------------------------------------------------
// ResolvedSlot / ResolveResult — what resolveDocument reports
// ---------------------------------------------------------------------------

/** A canvas or flowed slot accepted by the shared binding resolver. */
export type SurfaceSlotSpec = SlotSpec | FlowSlotSpec;

/** One slot a layout declares that also has a matching `SlotBinding`. */
export interface ResolvedSlot<TSpec extends SurfaceSlotSpec = SlotSpec> {
  key: string;
  spec: TSpec;
  binding: SlotBinding;
}

/**
 * What `resolveDocument` returns. `ok` is `true` only when resolution
 * actually found something: every required slot was bound, every binding
 * matched a real slot, at least one slot was actually resolved, AND every
 * matched binding is itself shape-valid — see `bindingFindings` below. An
 * empty `layout`, an empty `bindings` list, a document that matched no
 * slots at all, or a binding that matched a slot but is malformed (no
 * source at all, two or three conflicting sources, an empty/whitespace-only
 * `value`, an empty `copyId`, an empty `assetId`) is each `ok: false` —
 * never a silent clean pass on having resolved nothing, or on having
 * resolved to something unusable. See `resolve.ts`'s own doc comment for
 * the fuller argument. `resolveDocument` itself does not distinguish a
 * `copyId` binding from an `assetId` one — that split happens one pass
 * later, in `resolve-copy.ts`'s `resolveCopy` and `resolve-assets.ts`'s
 * `resolveAssets`, each of which reads `resolved`/`bindingFindings` from
 * here and picks out only the bindings relevant to its own job.
 */
export interface ResolveResult<TSpec extends SurfaceSlotSpec = SlotSpec> {
  ok: boolean;
  /** `SlotSpec.key`s the layout marks `required: true` that no binding targets. Never silently dropped. */
  missingRequired: string[];
  /** Bindings whose `slot` does not match any `SlotSpec.key` in the layout. Never silently dropped. */
  unknownBindings: SlotBinding[];
  /** Every slot that resolved cleanly: a real `SlotSpec` paired with the `SlotBinding` that fills it. */
  resolved: ResolvedSlot<TSpec>[];
  /**
   * `validate.ts`'s own `validateSlotBindingShape` findings, run against
   * every binding that matched a real slot (i.e. every binding behind an
   * entry in `resolved`) — the same check `validateComposeDocument` would
   * have reported for that binding, reused rather than re-implemented, so
   * `resolveDocument` and `validateComposeDocument` can never quietly
   * drift apart on what counts as a well-formed `SlotBinding`. Catches a
   * binding with none of `copyId`/`value`/`assetId` set, one with two or
   * all three set (`binding-source-exclusive` — see `validate.ts` for the
   * full exactly-one-of-three truth table), an empty `copyId`
   * (`binding-copy-id-shape`), an empty or whitespace-only `value`
   * (`binding-value-shape`), and an empty `assetId`
   * (`binding-asset-id-shape`). Always `severity: "error"` in practice —
   * see `ComposeFinding`'s own doc comment. Any entry here forces
   * `ok: false`; never silently dropped.
   */
  bindingFindings: ComposeFinding[];
}
