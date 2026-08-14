/**
 * `@vespeneventures/surface/document` — the product-neutral structured-
 * document contract: sections, paragraphs, lists, definition lists,
 * tables, callouts, and safe links, validated and rendered to semantic
 * HTML through React. Depends on `surface/core` for `ComposeFinding`
 * (validation findings) and on `@vespeneventures/copy` for `CopyRef`/
 * `CopyResolution`/`CopyResolver`, the same way `surface/web` already
 * does. See this package's README, "document" for the full picture,
 * including the non-goals this subpath deliberately does not cover (no
 * legal-specific content types, no arbitrary HTML passthrough, no
 * pagination, no automatic table-of-contents generation).
 *
 * Like `surface/web`, this subpath has an OPTIONAL `react` peer — a
 * consumer who never imports `@vespeneventures/surface/document` never
 * needs to install it.
 */

export type { DocumentBlock, DocumentCallout, DocumentDefinitionList, DocumentInline, DocumentList, DocumentParagraph, DocumentSection, DocumentTable, StructuredDocument } from "./types.js";

export { validateStructuredDocument } from "./validate.js";

export { renderStructuredDocument } from "./render.js";
export type { RenderStructuredDocumentOptions, RenderStructuredDocumentResult } from "./render.js";

export { RenderError } from "../internal/errors.js";
export type { RenderErrorReason } from "../internal/errors.js";
