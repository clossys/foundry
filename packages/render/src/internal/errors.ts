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

/** The closed set of reasons a renderer in this package refuses to render. */
export type RenderErrorReason =
  | "unknown-template"
  | "wrong-channel"
  | "resolution-failed"
  | "empty-output";

export class RenderError extends Error {
  readonly reason: RenderErrorReason;

  constructor(reason: RenderErrorReason, message: string) {
    super(message);
    this.name = "RenderError";
    this.reason = reason;
  }
}
