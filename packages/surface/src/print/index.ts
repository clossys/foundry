/**
 * @vespeneventures/surface/print — the `print` channel renderer. Takes a
 * `ComposeDocument` with `channel: "print"` and returns a deterministic,
 * paged-media HTML+CSS document string. See `renderPrintDocument.ts`'s own
 * doc comment for the full picture, and this package's README's `./print`
 * section for the architectural argument (paged HTML+CSS, never a PDF,
 * never a headless browser). Zero new dependencies: everything this
 * channel needs (`resolveDocument`, `resolveCopy`, `frameToPercent`) ships
 * from `@vespeneventures/surface/core`, already part of this release unit.
 */

export { renderPrintDocument } from "./renderPrintDocument.js";

export { RenderError } from "../internal/errors.js";
export type { RenderErrorReason } from "../internal/errors.js";

export type { CopyResolver, CustomPageSize, PrintPageInfo, RenderPrintOptions, RenderPrintResult } from "./types.js";
