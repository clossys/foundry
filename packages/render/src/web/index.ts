/**
 * @vespeneventures/render/web — the `web` channel renderer. Takes a
 * `ComposeDocument` with `channel: "web"` and emits the rendered
 * `@vespeneventures/ui` view element plus framework-agnostic head
 * metadata. See `renderWebDocument.ts`'s own doc comment for the full
 * picture, and this package's README for the peer-dependency model
 * (`react`, `react-dom`, and `@vespeneventures/ui` are all OPTIONAL peers
 * of this subpath specifically — a consumer who never imports
 * `@vespeneventures/render/web` never needs to install any of them).
 */

export { renderWebDocument } from "./renderWebDocument.js";
export { buildWebHeadMetadata } from "./headMetadata.js";
export { listWebTemplateNames } from "./internal/webTemplates.js";

export { RenderError } from "../internal/errors.js";
export type { RenderErrorReason } from "../internal/errors.js";

export type {
  CopyResolver,
  RenderWebOptions,
  RenderWebResult,
  WebHeadMetadata,
  WebOpenGraphMetadata,
  WebTwitterMetadata,
} from "./types.js";
