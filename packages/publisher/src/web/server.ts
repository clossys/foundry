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
export { AuthView, CaptureView, CollectionView, DocumentView, ErrorView, MarketingView, SectionedView } from "#publisher-web-views";
export type {
  AuthViewProps,
  CaptureViewProps,
  CollectionViewEmptyState,
  CollectionViewEntry,
  CollectionViewLink,
  CollectionViewPagination,
  CollectionViewProps,
  DocumentViewEffectiveDate,
  DocumentViewProps,
  ErrorViewProps,
  MarketingFaqItem,
  MarketingFeatureItem,
  MarketingViewProps,
  SectionedViewLandmark,
  SectionedViewProps,
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
  RepeatingWebSlotFieldSpec,
  RepeatingWebSlotSpec,
  ResolvedWebGroupField,
  ResolvedWebGroupItem,
  WebHeadMetadata,
  WebOpenGraphMetadata,
  WebRenderer,
  WebSlotContentKind,
  WebTemplate,
  WebTwitterMetadata,
} from "./types.js";
