/**
 * React-server conditional target for `@clossys/publisher/web`.
 * Runtime exports deliberately match the ordinary entry exactly; the
 * conditional internal views binding selects the server-safe MarketingView.
 */
export { renderWebDocument } from "./renderWebDocument.js";
export { buildWebHeadMetadata } from "./headMetadata.js";
export { listWebTemplateNames } from "./internal/webTemplates.js";
export { defineWebTemplate } from "./internal/defineWebTemplate.js";
export { createWebRenderer } from "./internal/createWebRenderer.js";
export { AuthView, ErrorView, MarketingView } from "#publisher-web-views";
export type {
  AuthViewProps,
  ErrorViewProps,
  MarketingFaqItem,
  MarketingFeatureItem,
  MarketingViewProps,
} from "#publisher-web-views";

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
