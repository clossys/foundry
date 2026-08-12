/**
 * @vespeneventures/surface/core — public composition contract. See README.md
 * for the full picture: the join point between
 * `@vespeneventures/ui`'s visual vocabulary and `@vespeneventures/copy`'s
 * verbal one, plus per-channel metadata; the renderer-facing `ComposeDocument`
 * contract, and why `layout` is channel-gated.
 *
 * Everything here is pure — no I/O, no React, no schema library, and no
 * dependency on `@vespeneventures/ui` or `@vespeneventures/copy`
 * themselves (see the README, "Zero runtime dependencies"). Four things
 * ship:
 *
 *   1. THE CONTRACT (`types.ts`) — `ComposeDocument` and every shape it's
 *      built from.
 *   2. VALIDATION (`validate.ts`) — `validateComposeDocument`, hand-rolled
 *      shape validation in the style of `@vespeneventures/strategy`'s
 *      `validation.ts` and `@vespeneventures/copy`'s `schema.ts`.
 *   3. RESOLUTION (`resolve.ts`, `resolve-copy.ts`, `resolve-assets.ts`) —
 *      `resolveDocument`, matching a document's bindings against a real
 *      layout's slots (reusing `validate.ts`'s own binding-shape checks
 *      so a malformed binding can never resolve `ok: true` — see issue
 *      #43); `resolveCopy`, the second pass that turns matched
 *      `copyId`/`value` bindings into actual text via a caller-supplied
 *      `CopyLookup`; and `resolveAssets`, its symmetric companion (added
 *      0.3.0) that turns matched `assetId` bindings into actual assets
 *      via a caller-supplied `AssetLookup`. Each of the latter two defers
 *      the other's bindings rather than treating them as failures — see
 *      `resolve-copy.ts`'s own top comment, "Asset bindings are not
 *      failed text".
 *   4. UNIT CONVERSION AND SMALL HELPERS (`frame.ts`, `slots.ts`) — the
 *      two conversions renderers need out of a `Frame`, plus small
 *      read-only lookups over a `LayoutSpec`'s `slots`.
 */

export type {
  Channel,
  ChannelMeta,
  CanvasLayoutSpec,
  CopyProvenance,
  ComposeDocument,
  ComposeFinding,
  ElementKind,
  EmailMeta,
  Frame,
  FlowLayoutSpec,
  FlowSlotSpec,
  ImageMeta,
  LayoutSpec,
  OutputArtifact,
  OutputManifest,
  PrintMeta,
  Rect,
  ResolvedSlot,
  ResolveResult,
  SlidesMeta,
  SlotBinding,
  SurfaceChannelMeta,
  SurfaceDocument,
  SurfaceEmailMeta,
  SurfaceImageMeta,
  SurfaceSlotBinding,
  SurfaceSlidesMeta,
  SurfaceSlotSpec,
  SurfaceWebMeta,
  SlotSpec,
  StyleBinding,
  StrategyProvenance,
  WebMeta,
} from "./types.js";

export { CHANNELS, ELEMENT_KINDS } from "./types.js";

export { validateComposeDocument } from "./validate.js";
export { validateSurfaceDocument } from "./validate.js";

export { resolveDocument } from "./resolve.js";

export { resolveCopy } from "./resolve-copy.js";
export type { CopyLookup, CopyResolveResult, ResolvedText } from "./resolve-copy.js";

export { resolveAssets } from "./resolve-assets.js";
export type { AssetLookup, AssetResolveResult, ResolvedAsset } from "./resolve-assets.js";

export { frameToInches, frameToPercent } from "./frame.js";
export type { CanvasInches } from "./frame.js";

export { getSlotSpec, listSlotKeys, requiredSlotKeys } from "./slots.js";

export { collectCopyProvenance, createOutputManifest, createResolvedOutputManifest } from "./output-manifest.js";

export { resolveSurfaceDocument, SurfaceResolutionError } from "./resolve-surface.js";
export type { ResolvedSurfaceDocument, SurfaceResolutionReason } from "./resolve-surface.js";
