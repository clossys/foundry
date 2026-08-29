/**
 * @clossys/publisher/web — the `web` channel renderer. Takes a
 * `ComposeDocument` with `channel: "web"` and emits the rendered
 * `@clossys/designer` view element plus framework-agnostic head
 * metadata. See `renderWebDocument.ts`'s own doc comment for the full
 * picture, and this package's README for the peer-dependency model
 * (`react`, `react-dom`, and `@clossys/designer` are all OPTIONAL peers
 * of this subpath specifically — a consumer who never imports
 * `@clossys/publisher/web` never needs to install any of them).
 */

export { renderWebDocument } from "./renderWebDocument.js";
export { buildWebHeadMetadata } from "./headMetadata.js";
export { listWebTemplateNames } from "./internal/webTemplates.js";
export { defineWebTemplate } from "./internal/defineWebTemplate.js";
export { createWebRenderer } from "./internal/createWebRenderer.js";
export { AuthView, ErrorView, MarketingView } from "./views/index.js";
export type { AuthViewProps, ErrorViewProps, MarketingFaqItem, MarketingFeatureItem, MarketingViewProps } from "./views/index.js";

export { RenderError } from "../internal/errors.js";
export type { RenderErrorReason } from "../internal/errors.js";

export type {
  AssetResolver,
  CopyResolver,
  CreateWebRendererOptions,
  DefineWebTemplateOptions,
  RenderWebOptions,
  RenderWebResult,
  RepeatingWebSlotSpec,
  ResolvedWebGroupItem,
  WebHeadMetadata,
  WebOpenGraphMetadata,
  WebRenderer,
  WebSlotContentKind,
  WebTemplate,
  WebTwitterMetadata,
} from "./types.js";
