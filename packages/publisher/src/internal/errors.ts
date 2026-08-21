/**
 * `RenderError` — the one error type every channel this package ever grows
 * throws. A renderer only ever fails for one of a small, closed set of
 * reasons (an unknown template, a document that failed to resolve, a
 * channel mismatch, a document that resolved to nothing renderable), and a
 * caller catching errors from this package should be able to switch on
 * `reason` rather than pattern-match error message text. Shared here, under
 * `internal/`, rather than duplicated per channel, so `./email`, `./print`,
 * `./slides`, `./image` throw the exact same shape later.
 */

/**
 * The closed set of reasons a renderer in this package refuses to render.
 *
 * The last six were added alongside `internal/tokens.ts` — the
 * `@vespeneventures/designer/tokens` -> literal-color flattening every channel
 * (`./web`, `./email`, `./print`, `./image`, `./slides`) shares, so a
 * bad token/color input fails the same way regardless of which channel
 * triggered it:
 *
 *   - `"invalid-oklch"` — `oklchToHex` was given a string that is not a
 *     well-formed `oklch(...)` color function.
 *   - `"non-brandable-override"` — `flattenTokens` was given an override
 *     for a token slot whose `brandable` is `false` (a structural token,
 *     not one a brand is meant to touch).
 *   - `"unknown-token-override"` — `flattenTokens` was given an override
 *     for a slot name that does not exist in `TOKENS` at all (almost
 *     always a typo).
 *   - `"unknown-token-ref"` — `resolveTokenRef` hit a `var(--name)` whose
 *     `--name` is not in the supplied flat map, and no fallback was given.
 *   - `"token-ref-cycle"` — `resolveTokenRef` hit a `var()` chain that
 *     loops back on a name already being resolved.
 *   - `"invalid-token-ref"` — `resolveTokenRef` was given malformed
 *     `var(...)` syntax (unbalanced parentheses, or no property name).
 *
 * The next three were added alongside `./print` (`src/print/`), which reuses
 * `"wrong-channel"`, `"resolution-failed"`, and `"empty-output"` above for
 * the situations they already describe (see `renderPrintDocument.ts`'s own
 * doc comment for exactly how each maps), and needed exactly three genuinely
 * new ones:
 *
 *   - `"missing-layout"` — `doc.layout` is absent or malformed on a
 *     `channel: "print"` document. `@vespeneventures/publisher/core`'s own frozen
 *     contract requires a `LayoutSpec` for `print`/`slides`/`image` (see its
 *     `types.ts`, `LayoutSpec`'s doc comment) — this is a stronger, earlier
 *     refusal than letting `resolveDocument` silently treat a missing
 *     layout as zero slots and fail with the less specific
 *     `"resolution-failed"`.
 *   - `"missing-custom-page-size"` — `doc.meta.pageSize === "Custom"` and no
 *     explicit page dimensions were supplied. `PrintMeta` itself has no
 *     width/height field for `"Custom"`; `./print` refuses to default to A4
 *     rather than risk a print run at the wrong trim size.
 *   - `"unknown-style-role"` — a `StyleBinding.color`/`.background` names a
 *     token role absent from `@vespeneventures/designer/tokens`' `TOKENS` registry
 *     (checked after `flattenTokens()`), the same "never a silent fallback
 *     colour" discipline `internal/tokens.ts` itself holds to.
 *
 * One more member was appended for `./slides` (a `SlidesDeckInput` whose
 * slides don't all agree on `meta.aspect` — see `src/slides/
 * renderSlidesDeck.ts` for the full reasoning):
 *
 *   - `"inconsistent-deck-aspect"` — `renderSlidesDeck` was given a deck
 *     whose slides don't all declare the same `SlidesMeta.aspect`. A deck
 *     is one fixed canvas rendered repeatedly; a per-slide aspect change
 *     mid-deck has no sensible single canvas size, so this is refused
 *     rather than silently rendered at (say) the first slide's aspect.
 *
 * Two more members were added alongside `./web`'s `defineWebTemplate`/
 * `createWebRenderer` (the extensible web-template registry — see
 * `web/internal/defineWebTemplate.ts` and `web/internal/createWebRenderer.ts`).
 * Both are DEFINITION-TIME failures — thrown before any `SurfaceDocument`
 * is ever rendered against the template in question — reusing this same
 * closed reason set rather than introducing a second error type for
 * "something about a template registration was wrong": a consumer
 * catching errors from this package should never need two different
 * `instanceof` checks depending on whether the failure happened while
 * defining a template or while rendering a document against one.
 *
 *   - `"invalid-template-definition"` — `defineWebTemplate` was given a
 *     malformed `name`, `flow` (not an object, no `slots` array, a slot
 *     with a non-string/empty `key`, or a duplicate slot key within it),
 *     `slotKinds` (naming a key `flow.slots` does not declare, or an
 *     unknown/empty content-kind list), `repeatingSlots` (a key that
 *     collides with a `flow.slots` key, or with another repeating slot),
 *     or `build`.
 *   - `"duplicate-template"` — `createWebRenderer` was given two entries
 *     (across `templates` and, when `includeBuiltins` is `true`, the
 *     built-ins) sharing the same `WebTemplate.name`. Never silently
 *     keeps the last one registered.
 */
export type RenderErrorReason =
  | "unknown-template"
  | "wrong-channel"
  | "resolution-failed"
  | "empty-output"
  | "invalid-oklch"
  | "non-brandable-override"
  | "unknown-token-override"
  | "unknown-token-ref"
  | "token-ref-cycle"
  | "invalid-token-ref"
  | "missing-layout"
  | "missing-custom-page-size"
  | "unknown-style-role"
  | "inconsistent-deck-aspect"
  | "invalid-template-definition"
  | "duplicate-template";

export class RenderError extends Error {
  readonly reason: RenderErrorReason;

  constructor(reason: RenderErrorReason, message: string) {
    super(message);
    this.name = "RenderError";
    this.reason = reason;
  }
}
