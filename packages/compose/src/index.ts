/**
 * @vespeneventures/compose — public entry point. See README.md for the
 * full picture: what this package is (the join point between
 * `@vespeneventures/ui`'s visual vocabulary and `@vespeneventures/copy`'s
 * verbal one, plus per-channel metadata), the frozen `ComposeDocument`
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
 *   3. RESOLUTION (`resolve.ts`) — `resolveDocument`, matching a
 *      document's bindings against a real layout's slots.
 *   4. UNIT CONVERSION AND SMALL HELPERS (`frame.ts`, `slots.ts`) — the
 *      two conversions renderers need out of a `Frame`, plus small
 *      read-only lookups over a `LayoutSpec`'s `slots`.
 */

export type {
  Channel,
  ChannelMeta,
  ComposeDocument,
  ComposeFinding,
  ElementKind,
  EmailMeta,
  Frame,
  ImageMeta,
  LayoutSpec,
  PrintMeta,
  Rect,
  ResolvedSlot,
  ResolveResult,
  SlidesMeta,
  SlotBinding,
  SlotSpec,
  StyleBinding,
  WebMeta,
} from "./types.js";

export { CHANNELS, ELEMENT_KINDS } from "./types.js";

export { validateComposeDocument } from "./validate.js";

export { resolveDocument } from "./resolve.js";

export { frameToInches, frameToPercent } from "./frame.js";
export type { CanvasInches } from "./frame.js";

export { getSlotSpec, listSlotKeys, requiredSlotKeys } from "./slots.js";
