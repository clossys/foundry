/** The server condition of the existing Frames entry: no client-hook barrel is evaluated. */
export * from "./site-frame/index.js";
export { SITE_CHROME_GROUNDS } from "./site-frame/types.js";
export { resolveShell as resolveSiteShell } from "./site-frame/internal/resolveShell.js";
export { LandingView, LandingView as ServerLandingView } from "./site-frame/landing/web/views/LandingView.server.js";
export type { LandingViewProps, LandingViewHeader, LandingViewCallToAction } from "./site-frame/landing/web/views/LandingViewContent.js";
export { RenderError, type RenderErrorReason } from "./site-frame/landing/internal/errors.js";
export { AuthFrame } from "./AuthFrame.js";
export type { AuthFrameProps } from "./AuthFrame.js";
export { siteShellProps, renderSiteShell, siteShellRuntimeRenderer, siteShellRuntimeRenderers, siteShellRuntimePointers, siteShellRuntimeCallbacks, SITE_SHELL_RUNTIME_POINTER } from "../runtime/frames/site-shell.js";

import { lazy } from "react";
/** The actual client AppFrame stays behind its existing use-client module boundary. */
export const AppFrame = lazy(async () => ({ default: (await import("./AppFrame.js")).AppFrame }));
export type { AppFrameProps } from "./app-frame-types.js";
