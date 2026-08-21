/**
 * @vespeneventures/designer/shell — the persistent application frame, plus the
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

import { version as reactVersion } from "react";
import reactAriaComponentsPackageJson from "react-aria-components/package.json" with { type: "json" };
import { assertPeerVersion } from "../internal/peer-version.js";
import { REACT_ARIA_COMPONENTS_DECLARED_RANGE, REACT_DECLARED_RANGE } from "../internal/declared-peer-ranges.js";

/**
 * `react` and `react-aria-components` are two of this package's optional
 * peers — see `atoms/index.ts`'s own, longer version of this comment for
 * the full #182 rationale. This barrel needs its own guard call,
 * independent of `atoms/index.ts`'s: `Toaster.tsx`, `NavShell.tsx`, and
 * `internal/toast-queue.ts` import `react-aria-components` directly, and a
 * consumer who imports only `@vespeneventures/designer/shell` (never
 * `@vespeneventures/designer/atoms`) would otherwise get no signal at all.
 */
assertPeerVersion({ peer: "react", declaredRange: REACT_DECLARED_RANGE, foundVersion: reactVersion });
assertPeerVersion({
  peer: "react-aria-components",
  declaredRange: REACT_ARIA_COMPONENTS_DECLARED_RANGE,
  foundVersion: reactAriaComponentsPackageJson.version,
});

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
