/**
 * @vespeneventures/surface/email — the `email` channel renderer. Takes a
 * `ComposeDocument` with `channel: "email"` and emits a complete,
 * self-contained, table-based HTML document plus its deterministically
 * derived plain-text alternative. See `renderEmailDocument.ts`'s own doc
 * comment for the full pipeline, and this package's README, "Email is not
 * a small web page," for why the output looks the way it does.
 *
 * Unlike `./web`, this channel imports neither `react` nor
 * `@vespeneventures/ui` — email HTML is a string this package builds by
 * hand (see `internal/emailDocument.ts`'s own top comment) — so
 * `@vespeneventures/surface/email` has NO extra peer dependencies beyond
 * this package's own real dependencies (`@vespeneventures/surface/core`,
 * `@vespeneventures/ui/tokens`). A consumer who only imports this subpath
 * never needs to install React at all.
 */

export { renderEmailDocument } from "./renderEmailDocument.js";

export { RenderError } from "../internal/errors.js";
export type { RenderErrorReason } from "../internal/errors.js";

export type { EmailRenderResult, RenderEmailOptions, RenderWarning } from "./types.js";
