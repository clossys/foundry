export { PublisherInstancesView } from "./instances/PublisherInstancesView.js";
export type { PublisherInstancesViewProps } from "./instances/PublisherInstancesView.js";
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
export { PublisherCompositionsView } from "./compositions/PublisherCompositionsView.js";
export type { CompositionsConsumerLibrary, PublisherCompositionsViewProps } from "./compositions/PublisherCompositionsView.js";
export { buildWebHeadMetadata } from "./headMetadata.js";
export { SiteMetadataError, buildSiteMetadata, formatPageTitle } from "./siteMetadata.js";
export type {
  SiteIdentityInput,
  SiteIndexing,
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
export { AuthView, BoundaryView, BrandGuideView, CaptureView, CollectionView, DocumentView, ErrorView, MarketingView, PackReviewView, SectionedView, StatusView, SystemAuditView } from "./views/index.js";
export type { AuthViewProps, BoundaryViewProps, BrandGuideAssetLink, BrandGuideFact, BrandGuideSpecimen, BrandGuideViewProps, CaptureViewProps, CollectionViewEmptyState, CollectionViewEntry, CollectionViewLink, CollectionViewPagination, CollectionViewProps, DocumentViewEffectiveDate, DocumentViewProps, ErrorViewProps, MarketingFaqItem, MarketingFeatureItem, MarketingViewProps, PackReviewViewBrandKit, PackReviewViewExport, PackReviewViewFact, PackReviewViewFaqItem, PackReviewViewLabels, PackReviewViewPage, PackReviewViewProps, PackReviewViewState, PackReviewViewStrategy, PackReviewViewVoice, SectionedViewLandmark, SectionedViewProps, StatusViewProps, SystemAuditViewProps } from "./views/index.js";
export { PageView } from "./views/index.js";
export type { PageViewProps } from "./views/index.js";

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
export type { LegalViewFramedLabels, LegalViewLabels, LegalViewProps } from "./views/index.js";

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

export { HeroView, LandingView } from "./views/index.js";
export type { HeroViewFooter, HeroViewGround, HeroViewProps, LandingViewAction, LandingViewCallToAction, LandingViewHeader, LandingViewProps } from "./views/index.js";
export { LANDING_VIEW_CALL_TO_ACTION_GROUND, LANDING_VIEW_CLOSING_GROUND, planLandingViewGrounds } from "./views/index.js";
export type { LandingViewBandGround, LandingViewBandRole, LandingViewGroundPlan, LandingViewGroundRepeat } from "./views/index.js";
export { ContactView } from "./views/index.js";
export type { ContactViewCopy, ContactViewDevPreview, ContactViewProps, ContactViewTopic, ContactViewValues } from "./views/index.js";
export { SignInForm } from "./views/index.js";
export type { SignInFailure, SignInFormProps, SignInResult } from "./views/index.js";
export { GlobalErrorDocument } from "./views/index.js";
export type { GlobalErrorDocumentErrorViewProps, GlobalErrorDocumentFramedProps, GlobalErrorDocumentHeadProps, GlobalErrorDocumentProps } from "./views/index.js";
export { NotFoundDocument } from "./views/index.js";
export type { NotFoundDocumentProps } from "./views/index.js";
export { ActivateForm, ResetForm } from "./views/index.js";
export type { ActivateDetails, ActivateFailure, ActivateFormProps, ActivateResult, ResetDetails, ResetFailure, ResetFormProps, ResetResult } from "./views/index.js";

// The page frame: owns the skip link, banner, the page's one <main> and contentinfo; views render chrome-free inside it.
export { SITE_MAIN_ID, SITE_PAGE_LAYERS, SITE_SURFACE_KINDS, SiteFrame, siteShellFor } from "./frame/index.js";
// The frames.site-shell surface runtime renderer: Publisher's registry beside Designer's (@clossys/designer/frames).
export { SITE_SHELL_RUNTIME_POINTER, siteShellRuntimeCallbacks, siteShellRuntimePointers, siteShellRuntimeRenderers } from "./site-shell-runtime.js";
export type {
  SiteBrandInput,
  SiteChromeGround,
  SiteEnvironmentLinkInput,
  SiteFooterInput,
  SiteFrameConfig,
  SiteFrameInput,
  SiteFrameProps,
  SiteIconLinkInput,
  SiteLinkInput,
  SitePageLayer,
  SiteShellInput,
  SiteSurfaceKind,
} from "./frame/index.js";

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

export { ConsumerArtSlot } from "./ConsumerArtSlot.js";
export type { ConsumerArtSlotProps } from "./ConsumerArtSlot.js";

export { constructionStatusProps } from "./views/index.js";
export type { ConstructionStatusInput } from "./views/index.js";

export { ContactForm } from "./views/ContactForm.js";
export type { ContactFormCopy, ContactFormDevPreview, ContactFormProps, ContactFormTopic, ContactFormValues } from "./views/ContactForm.js";

export type { SectionedViewHeroSection } from "../core/sectioned-view.js";

export { SITE_FRAME_CONTRACT, SITE_FRAME_CONFIG_SCHEMA, normalizeSiteFrameConfig, normalizeSiteFrameActions } from "./frame/site-frame-contract.js";
export type { SiteFramePresentationConfig } from "./frame/site-frame-contract.js";

export { IndexView, DetailsView } from "./views/index.js";
export type { IndexViewCollection, IndexViewProps, IndexViewRowRoute, IndexViewTable, DetailsViewBlock, DetailsViewLayout, DetailsViewProps, DetailsViewRegion, DetailsViewSection, DetailsViewSectionState, DetailsViewTab } from "./views/index.js";

export { PublisherPage } from "./publisher/PublisherPage.js";
export type { PublisherPageProps } from "./publisher/PublisherPage.js";
export type { AssemblyOwner, AssemblyOwnerTarget, AssemblyOwnerHref } from "./publisher/assembly/assembly.js";
export type { PublisherLane, PublisherPipelineItem, PublishStageEvidence, PublishStage, PublishStageStatus } from "./publisher/pipeline.js";

export { PublisherFormatsView } from "./formats/PublisherFormatsView.js";
export type { PublisherFormatsViewProps } from "./formats/PublisherFormatsView.js";
export { AppPack } from "./publisher/app/AppPack.js";
export { projectAppInventory } from "./publisher/app/inventory.js";
export type { AppInventory, AppRoute, AppLane, AppMissingDecision, AppInventoryProjection, AppPageProjection, AppSubrowProjection, AppScopedStateDeclaration } from "./publisher/app/inventory.js";
export type { AppPageBindingInput, AppSubrowBindingInput, AppPipelineInput, AppPipelineMessages } from "./publisher/app/pipeline.js";

export type { ProductionSettings, ProductionSettingsByItem, PublisherProductionState, PublisherInputRequest, PublisherInputRequests } from "./publisher/production-settings.js";
export type { AppPackProps } from "./publisher/app/AppPack.js";

export { PublisherSection } from "./publisher/PublisherSection.js";
export type { PublisherSectionProps } from "./publisher/PublisherSection.js";
export { projectPublisherSections } from "./publisher/publisher-sections.js";
export type { PublisherSectionCommand, PublisherSectionData, PublisherSectionsInput, PublisherCell, PublisherTableRow } from "./publisher/publisher-sections.js";
export { ProductionSettingsFields, useProductionDraft } from "./publisher/ProductionSettingsForm.js";
export type { ProductionSettingsFieldsProps } from "./publisher/ProductionSettingsForm.js";
