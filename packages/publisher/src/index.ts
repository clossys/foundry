/**
 * This file is NOT a public entry point — `package.json` deliberately
 * declares no `"."` export. Import an explicit `@vespeneventures/publisher`
 * subpath instead: `/core`, `/media`, `/web`, `/document`, `/email`,
 * `/print`, `/image`, `/slides`, or the record half's `/record`.
 * This barrel exists only so the same names are reachable from one place
 * for internal tooling (see `scripts/check-readme-parity.mjs` in the
 * repository root, which reads `src/index.ts` as every package's canonical
 * export list); it re-exports exactly what `./web/index.js` and
 * `./document/index.js` export, nothing more — the composer half's own
 * subset, unchanged from `@vespeneventures/surface`'s equivalent file.
 * `./record` is deliberately NOT re-exported here: this barrel exists to
 * let `check-readme-parity.mjs` verify the composer's own README section,
 * and the record half documents and checks its own exports separately (see
 * "`record` — the append-only publication ledger" in `README.md`) so that
 * fusing the packaging never reads as fusing the two halves' surfaces into
 * one export list. A future composer channel subpath's own exports get
 * added here too, the same way `designer`'s own internal barrel grew one
 * `export ... from` block per layer as `atoms`/`blocks`/`views`/`shell`/
 * `charts`/`icons` shipped.
 */
export {
  renderWebDocument,
  buildWebHeadMetadata,
  listWebTemplateNames,
  RenderError,
} from "./web/index.js";
export type {
  RenderErrorReason,
  AssetResolver,
  CopyResolver,
  RenderWebOptions,
  RenderWebResult,
  WebHeadMetadata,
  WebOpenGraphMetadata,
  WebTwitterMetadata,
} from "./web/index.js";

export { validateStructuredDocument, renderStructuredDocument } from "./document/index.js";
export type {
  DocumentBlock,
  DocumentCallout,
  DocumentDefinitionList,
  DocumentInline,
  DocumentList,
  DocumentParagraph,
  DocumentSection,
  DocumentTable,
  StructuredDocument,
  RenderStructuredDocumentOptions,
  RenderStructuredDocumentResult,
} from "./document/index.js";
