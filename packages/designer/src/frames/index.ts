/** Canonical client application Frames; content and actions remain host-owned. */
export { AppFrame } from "./AppFrame.js";
export type { AppFrameProps, AppFrameBrand, AppFrameBrandNavigationMark, AppFrameAccount, AppFrameAccountAvatar, AppFrameFooterLayout, AppFrameRightPanel, AppFrameLayout, AppFrameStage, AppFrameNotice, AppFrameDock } from "./app-frame-types.js";
export { APP_FRAME_CONTRACT, APP_FRAME_CONFIG_SCHEMA } from "./app-frame-contract.js";
export { APP_FRAME_RIGHT_PANEL_CONFIG } from "./right-panel-config.js";
export { AppFrameSpecimen } from "./AppFrame.specimen.js";
export type { AppFrameSpecimenProps } from "./AppFrame.specimen.js";

export { InspectorFrame } from "./InspectorFrame.js";
export type { InspectorFrameProps, InspectorFramePresentation } from "./InspectorFrame.js";

export { FrameStage, frameSectionRefKey } from "./FrameStage.js";
export type { FrameStageProps, FrameStageSectionRef } from "./FrameStage.js";

/** Package-owned surface runtime renderers (Frames and Sections) for ConsumerRuntimePorts. */
export { surfaceRuntimeRenderers, surfaceRuntimePointers, surfaceRuntimeCallbacks, SURFACE_RUNTIME_POINTER, surfaceRendererId } from "../runtime/index.js";
export type { SurfaceRendererEntry, SurfaceRendererGroup, SurfaceRuntimeRenderer, SurfaceRuntimeLeaf } from "../runtime/index.js";

export { useFrameNotice } from "./frame-notices.js";
export type { FrameNoticeApi } from "./frame-notices.js";

export { AuthFrame } from "./AuthFrame.js";
export type { AuthFrameProps } from "./AuthFrame.js";

export { SiteFrame, siteShellFor, SITE_SURFACE_KINDS, SITE_PAGE_LAYERS, SITE_MAIN_ID, SITE_FRAME_CONTRACT, SITE_FRAME_CONFIG_SCHEMA, normalizeSiteFrameConfig, normalizeSiteFrameActions, type SiteBrandInput, type SiteChromeGround, type SiteEnvironmentLinkInput, type SiteFooterInput, type SiteFrameConfig, type SiteFrameInput, type SiteFrameProps, type SiteIconLinkInput, type SiteLinkInput, type SitePageLayer, type SiteShellInput, type SiteSurfaceKind, type SiteFramePresentationConfig } from "./site-frame/index.js";
export { SITE_CHROME_GROUNDS } from "./site-frame/types.js";
export { resolveShell as resolveSiteShell } from "./site-frame/internal/resolveShell.js";
export { LandingView } from "./site-frame/landing/web/views/LandingView.js";
export { LandingView as ServerLandingView } from "./site-frame/landing/web/views/LandingView.server.js";
export type { LandingViewProps, LandingViewHeader, LandingViewCallToAction } from "./site-frame/landing/web/views/LandingViewContent.js";
export { RenderError, type RenderErrorReason } from "./site-frame/landing/internal/errors.js";
export { siteShellProps, renderSiteShell, siteShellRuntimeRenderer, siteShellRuntimeRenderers, siteShellRuntimePointers, siteShellRuntimeCallbacks, SITE_SHELL_RUNTIME_POINTER } from "../runtime/frames/site-shell.js";
