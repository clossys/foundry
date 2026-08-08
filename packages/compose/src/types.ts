/**
 * The frozen contract this package ships. Five renderer packages — one per
 * `Channel` — will be built by other agents against exactly this shape, so
 * every field below is load-bearing: renamed, added, or reshaped only in a
 * coordinated change, never as a local convenience.
 *
 * `compose` is the join point where `@vespeneventures/ui`'s visual
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

// ---------------------------------------------------------------------------
// SlotBinding — content going into a named slot
// ---------------------------------------------------------------------------

/**
 * Content going into a named slot. Exactly one of `copyId`/`value` must be
 * set — never both, never neither; see `validate.ts`'s
 * `"binding-source-exclusive"` rule.
 */
export interface SlotBinding {
  /** The `SlotSpec.key` this binding fills. */
  slot: string;
  /**
   * A plain string id into a `CopyRecord` — deliberately **not** an import
   * of `@vespeneventures/copy`. Same seam as `@vespeneventures/voice`'s
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
 * size. The token layer (`@vespeneventures/tokens`, or a consumer's own
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
// ComposeDocument — the whole document
// ---------------------------------------------------------------------------

/**
 * *This template, these slots filled from these copy ids, targeting this
 * channel, with this metadata.* The one document this whole package
 * exists to type and validate.
 */
export interface ComposeDocument {
  id: string;
  channel: Channel;
  meta: ChannelMeta;
  /** A `@vespeneventures/ui` view name, or a template id — a plain string, never an import. */
  template: string;
  bindings: SlotBinding[];
  /** Required for `print`/`slides`/`image`; must be absent for `web`/`email`. See `LayoutSpec`'s own doc comment. */
  layout?: LayoutSpec;
}

// ---------------------------------------------------------------------------
// ComposeFinding — what validateComposeDocument reports
// ---------------------------------------------------------------------------

/**
 * One thing `validate.ts`'s shape validation found wrong with a candidate
 * `ComposeDocument`. Deliberately the same shape as
 * `@vespeneventures/copy`'s `CopyFinding` (itself mirroring
 * `@vespeneventures/voice`'s `VoiceFinding` and `@vespeneventures/policy`'s
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

/** One slot a `LayoutSpec` declares that also has a matching `SlotBinding`. One entry of `ResolveResult.resolved`. */
export interface ResolvedSlot {
  key: string;
  spec: SlotSpec;
  binding: SlotBinding;
}

/**
 * What `resolveDocument` returns. `ok` is `true` only when resolution
 * actually found something: every required slot was bound, every binding
 * matched a real slot, AND at least one slot was actually resolved. An
 * empty `layout`, an empty `bindings` list, or a document that matched no
 * slots at all is `ok: false` — never a silent clean pass on having
 * resolved nothing. See `resolve.ts`'s own doc comment for the fuller
 * argument.
 */
export interface ResolveResult {
  ok: boolean;
  /** `SlotSpec.key`s the layout marks `required: true` that no binding targets. Never silently dropped. */
  missingRequired: string[];
  /** Bindings whose `slot` does not match any `SlotSpec.key` in the layout. Never silently dropped. */
  unknownBindings: SlotBinding[];
  /** Every slot that resolved cleanly: a real `SlotSpec` paired with the `SlotBinding` that fills it. */
  resolved: ResolvedSlot[];
}
