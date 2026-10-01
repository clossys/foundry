/**
 * @clossys/publisher/web — the `web` channel renderer. Takes a
 * `ComposeDocument` with `channel: "web"` and emits the rendered
 * `@clossys/designer` view element plus framework-agnostic head
 * metadata. See `renderWebDocument.ts`'s own doc comment for the full
 * picture, and this package's README for the peer-dependency model
 * (`react`, `react-dom`, and Designer's optional runtime peers are all
 * OPTIONAL peers of this subpath specifically — a consumer who never imports
 * `@clossys/publisher/web` never needs to install any of them).
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
export { AuthView, BoundaryView, BrandGuideView, CaptureView, CollectionView, DocumentView, ErrorView, MarketingView, SectionedView, SystemAuditView } from "./views/index.js";
export type { AuthViewProps, BoundaryViewProps, BrandGuideAssetLink, BrandGuideFact, BrandGuideViewProps, CaptureViewProps, CollectionViewEmptyState, CollectionViewEntry, CollectionViewLink, CollectionViewPagination, CollectionViewProps, DocumentViewEffectiveDate, DocumentViewProps, ErrorViewProps, MarketingFaqItem, MarketingFeatureItem, MarketingViewProps, SectionedViewLandmark, SectionedViewProps, SystemAuditViewProps } from "./views/index.js";

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

export { LegalView } from "./views/index.js";
export type { LegalViewLabels, LegalViewProps } from "./views/index.js";

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

export { LandingView } from "./views/index.js";
export type { LandingViewProps } from "./views/index.js";
export { ContactView } from "./views/index.js";
export type { ContactViewCopy, ContactViewProps, ContactViewTopic, ContactViewValues } from "./views/index.js";
export { GlobalErrorDocument } from "./views/index.js";
export type { GlobalErrorDocumentProps } from "./views/index.js";

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
