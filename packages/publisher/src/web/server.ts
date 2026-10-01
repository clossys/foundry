/**
 * React-server conditional target for `@clossys/publisher/web`.
 * Runtime exports deliberately match the ordinary entry exactly; the
 * conditional internal views binding selects the server-safe MarketingView.
 */
export { renderWebDocument } from "./renderWebDocument.js";
export { buildWebHeadMetadata } from "./headMetadata.js";
export { SiteMetadataError, buildSiteMetadata, formatPageTitle } from "./siteMetadata.js";
export type {
  SiteIdentityInput,
  SiteLegalStatus,
  SiteMetadata,
  SiteMetadataErrorReason,
  SiteOpenGraphMetadata,
  SitePageInput,
  SitePageKind,
  SiteShareCard,
  SiteTwitterMetadata,
} from "./siteMetadata.js";
export { SITE_METADATA_REQUIRED_TAGS, lintSiteMetadataHtml } from "./siteMetadataLint.js";
export type {
  SiteMetadataLintFinding,
  SiteMetadataLintResult,
  SiteMetadataLintRule,
  SiteMetadataRequiredTag,
  SiteMetadataTagSelector,
} from "./siteMetadataLint.js";
export { brandAssetHeadLinks, publicationMapEmitsBrandAssets } from "./brandAssetHead.js";
export { listWebTemplateNames } from "./internal/webTemplates.js";
export { defineWebTemplate } from "./internal/defineWebTemplate.js";
export { createWebRenderer } from "./internal/createWebRenderer.js";
export { evaluateWebRouteManifest, evaluateWebRouteManifestWithSources, scanRouteSourceForDirectComposition } from "./checkWebRoutes.js";
export type { WebRouteCheckResult, WebRouteFinding, WebRouteManifest, WebRouteManifestEntry } from "./checkWebRoutes.js";
export { AuthView, BoundaryView, BrandGuideView, CaptureView, CollectionView, DocumentView, ErrorView, MarketingView, SectionedView, SystemAuditView } from "#publisher-web-views";
export type {
  AuthViewProps,
  BoundaryViewProps,
  BrandGuideAssetLink,
  BrandGuideFact,
  BrandGuideViewProps,
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
  SystemAuditViewProps,
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
  WebTemplateBlockKind,
  WebTemplateBlockSpec,
  WebTwitterMetadata,
} from "./types.js";

export { LegalView } from "#publisher-web-views";
export type { LegalViewLabels, LegalViewProps } from "#publisher-web-views";

// The contact handler is server-only: import it from server code, never a client bundle.
export {
  CONTACT_CLIENT_KEY_MAX_LENGTH,
  CONTACT_DEFAULT_CAPS,
  STUB_CONTACT_DELIVERY,
  createContactHandler,
  createMemoryRateLimiter,
  createStubContactDelivery,
} from "./contact/index.js";
export type {
  ContactCaps,
  ContactDelivery,
  ContactFieldCode,
  ContactFieldCodeMap,
  ContactFieldIssue,
  ContactFieldName,
  ContactHandleOptions,
  ContactHandler,
  ContactHandlerConfig,
  ContactOutboundMessage,
  ContactRateLimiter,
  ContactResult,
  ContactResultStatus,
  ContactSubmission,
  ContactTarget,
  ContactUnavailableReason,
  MemoryRateLimiterOptions,
  StubContactDelivery,
} from "./contact/index.js";

export { LandingView } from "#publisher-web-views";
export type { LandingViewProps } from "#publisher-web-views";
export { ContactView } from "#publisher-web-views";
export type { ContactViewCopy, ContactViewDevPreview, ContactViewProps, ContactViewTopic, ContactViewValues } from "#publisher-web-views";
export { GlobalErrorDocument } from "#publisher-web-views";
export type { GlobalErrorDocumentProps } from "#publisher-web-views";

// Kept after the views: the share card reads Designer names newer than the views do, and a Designer that lacks the views' names must fail on those first.
export {
  BRAND_SHARE_CARD_DEFAULT_ROLES,
  BRAND_SHARE_CARD_PLATE_PX,
  ShareCardError,
  SHARE_CARD_DEFAULT_PATH,
  SHARE_CARD_DEFAULT_ROLES,
  buildBrandShareCard,
  buildShareCard,
} from "./shareCard.js";
export type {
  BrandShareCardInput,
  BrandShareCardRoles,
  ShareCard,
  ShareCardErrorReason,
  ShareCardInput,
  ShareCardMark,
  ShareCardRoles,
} from "./shareCard.js";
export { createShareCardRoute } from "./shareCardRoute.js";
export type { ShareCardRoute, ShareCardRouteInput } from "./shareCardRoute.js";
