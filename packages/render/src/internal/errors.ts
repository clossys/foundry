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
 * `@vespeneventures/tokens` -> literal-color flattening every channel
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
  | "invalid-token-ref";

export class RenderError extends Error {
  readonly reason: RenderErrorReason;

  constructor(reason: RenderErrorReason, message: string) {
    super(message);
    this.name = "RenderError";
    this.reason = reason;
  }
}
