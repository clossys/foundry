/**
 * @vespeneventures/ui/shell — the persistent application frame, plus the
 * `Toaster` runtime service that lives in it, and the persistent chrome a
 * public SITE (as opposed to an authenticated app) needs: `SkipLink`,
 * `SiteHeader`, `NavShell`, `SiteFooter`. See this package's README for the
 * full rationale: content (`atoms`, `blocks`, and the not-yet-built
 * `views`) remounts per route and is many-per-app; everything in this
 * subpath persists across navigation and is exactly one-per-app. `Toaster`
 * isn't itself a rung of the atoms → blocks → views → shell ladder (see
 * "Placement rules" in the README — a portal, a queue, and an imperative
 * API make it a runtime service, not a layout component) but ships from
 * this same subpath because its lifetime requirement is identical to
 * `Shell`'s.
 *
 * `shell` may import from `atoms` and `icons` (that direction is
 * correct — see `src/ladder.test.ts`); it never imports from `views` or
 * `charts`.
 */

export { Shell } from "./Shell.js";
export type {
  ShellProps,
  ShellHeaderProps,
  ShellSideNavProps,
  ShellMainProps,
  ShellRailProps,
  ShellFooterProps,
} from "./Shell.js";

export { Toaster, toast } from "./Toaster.js";
export type { ToasterProps, ToastFunction, ToastHandle, ToastOptions, ToastRecord, ToastVariant } from "./Toaster.js";

export { SkipLink } from "./SkipLink.js";
export type { SkipLinkProps } from "./SkipLink.js";

export { SiteHeader } from "./SiteHeader.js";
export type { SiteHeaderProps } from "./SiteHeader.js";

export { NavShell } from "./NavShell.js";
export type { NavShellProps } from "./NavShell.js";

export { SiteFooter } from "./SiteFooter.js";
export type { SiteFooterProps, SiteFooterColumnProps } from "./SiteFooter.js";
