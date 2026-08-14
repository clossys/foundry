/**
 * `StructuredDocument` — the product-neutral contract for a page whose body
 * is "read this document," not "fill in these five named regions": a help
 * article, a changelog entry, a long-form explainer. `surface/core`'s
 * `SurfaceSlotBinding` only ever carries a single `CopyRef` or a
 * caller-owned `node`; neither expresses an ordered sequence of headings,
 * paragraphs, lists, tables, and callouts with cross-referenced sections.
 * This file is that missing shape.
 *
 * Every leaf of user-facing text is a `CopyRef`, never a literal string —
 * the same discipline `SurfaceSlotBinding.copy` already holds document
 * content to. Structural metadata (a list's `style`, a callout's `tone`, a
 * section's `level`, a section's `id`) is a closed-vocabulary literal or a
 * plain string instead, because none of it is audience-facing prose a copy
 * registry should own.
 *
 * See `render.ts` for the renderer and `validate.ts` for shape/heading-
 * order/link/table/anchor validation; see this package's README, "document"
 * for the full picture, including the deliberate non-goals (no legal-
 * specific content types, no arbitrary HTML passthrough, no pagination, no
 * automatic table-of-contents generation).
 */

import type { CopyRef } from "@vespeneventures/copy";

// ---------------------------------------------------------------------------
// DocumentInline — content inside a paragraph, list item, or callout
// ---------------------------------------------------------------------------

/**
 * Inline content inside a paragraph, list item, or callout — never a block
 * on its own, and never valid as a `DocumentSection.blocks` entry. A
 * `"link"`'s `href` is validated against a closed scheme allowlist
 * (`https:`, `http:`, `mailto:`, or a `"#"`-prefixed in-document fragment
 * resolving to a real `DocumentSection.id`) — see `validate.ts`'s
 * `"link-scheme-not-allowed"`/`"link-fragment-unresolved"` rules. A table
 * cell and a definition-list term/description are plain `CopyRef`s, not
 * `DocumentInline` — neither can carry a link.
 */
export type DocumentInline = { kind: "text"; text: CopyRef } | { kind: "link"; text: CopyRef; href: string };

// ---------------------------------------------------------------------------
// DocumentParagraph / DocumentList / DocumentDefinitionList / DocumentTable / DocumentCallout
// ---------------------------------------------------------------------------

export interface DocumentParagraph {
  kind: "paragraph";
  content: DocumentInline[];
}

/**
 * `items` is an ordered array of inline runs — each entry is one list
 * item's content, never a nested block. A `DocumentList` cannot nest
 * another list; a caller who needs a nested list expresses it as two
 * sibling sections instead, the same "structure, not arbitrary markup"
 * discipline every block in this contract holds to.
 */
export interface DocumentList {
  kind: "list";
  style: "ordered" | "unordered";
  items: DocumentInline[][];
}

/** Every term/description is a plain `CopyRef` — never `DocumentInline` — the same reason a table cell is not: neither position needs a link. */
export interface DocumentDefinitionList {
  kind: "definition-list";
  items: Array<{ term: CopyRef; description: CopyRef }>;
}

/**
 * `headers` and every entry in `rows` are plain `CopyRef[]`, never
 * `DocumentInline[]` — a table cell cannot carry a link. Every row must
 * have exactly `headers.length` cells; a short or long row is a validation
 * finding (`"table-row-length-mismatch"`), never silently padded or
 * truncated — see `validate.ts`. `renderStructuredDocument` renders
 * `headers` as `<th scope="col">` inside a `<thead>` and every row as
 * `<td>` inside `<tbody>`, so the header-to-cell association an accessible
 * table needs is structural (the fixed cell count matching a real `<th>`
 * per column), not left to visual alignment alone.
 */
export interface DocumentTable {
  kind: "table";
  caption?: CopyRef;
  headers: CopyRef[];
  rows: CopyRef[][];
}

/**
 * A closed-vocabulary tone (never a free-form string, so a renderer can
 * always answer "what kind of callout is this" without parsing copy) and
 * an inline run of content — the same shape a paragraph's own `content`
 * carries.
 */
export interface DocumentCallout {
  kind: "callout";
  tone: "info" | "warning" | "success" | "danger";
  content: DocumentInline[];
}

// ---------------------------------------------------------------------------
// DocumentSection — the one block kind that nests
// ---------------------------------------------------------------------------

export type DocumentBlock = DocumentSection | DocumentParagraph | DocumentList | DocumentDefinitionList | DocumentTable | DocumentCallout;

/**
 * `id` is a literal, author-supplied, stable identifier — **never** derived
 * from `heading`'s resolved text. `heading` is a `CopyRef`: its rendered
 * text varies by locale and can be edited in the copy registry without
 * notice; an id generated from it would silently change or break every
 * inbound link the moment either happened — including this same
 * document's own `DocumentInline` `"link"` entries whose `href` is
 * `"#<id>"`. This is enforced by the type itself (`id: string`, entirely
 * separate from `heading: CopyRef`) rather than by a runtime check, since
 * there is nothing to check once the two fields are structurally
 * independent — see `validate.ts`'s `"section-anchor-duplicate"` for the
 * one thing about `id` that IS checked at runtime: uniqueness across the
 * whole document, not just among siblings.
 *
 * `level` is `2`–`6`: `h1` is reserved for the page's own title, rendered
 * outside this contract — the same discipline `ErrorView` already holds
 * between its own `<h1>` and `EmptyState`'s `<h2>` (see
 * `packages/surface/src/web/views/ErrorView.tsx`). A top-level
 * `StructuredDocument.sections` entry must be `level: 2`; a nested
 * section's `level` must be exactly one more than its parent's — see
 * `validate.ts`'s `"section-level-must-be-two-at-top"` and
 * `"section-level-skip"`. `level: 6` sections may not contain a nested
 * section — there is no `level: 7` — see `"section-level-max-depth"`.
 */
export interface DocumentSection {
  kind: "section";
  id: string;
  level: 2 | 3 | 4 | 5 | 6;
  heading: CopyRef;
  blocks: DocumentBlock[];
}

// ---------------------------------------------------------------------------
// StructuredDocument — the whole document
// ---------------------------------------------------------------------------

/**
 * `sections` may be empty — an empty document is valid and produces no
 * content, matching this ecosystem's existing "empty is a fact to report,
 * not to hide" discipline (see `SurfaceRepeatingSlotBinding.items`'s own
 * doc comment in `surface/core`) rather than a special error.
 *
 * `title` is resolved for provenance (it appears in
 * `RenderStructuredDocumentResult.resolutions`) but is never rendered into
 * the output tree — the page's own `<h1>` is the caller's job, the same
 * boundary `DocumentSection.level`'s own doc comment draws.
 */
export interface StructuredDocument {
  id: string;
  title: CopyRef;
  sections: DocumentSection[];
}
