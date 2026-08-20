/**
 * @vespeneventures/ui/shell/server — the server-safe subset of
 * `@vespeneventures/ui/shell`. See `atoms/server.ts`'s own header for the
 * full #375 rationale this file shares: `shell/index.ts` re-exports every
 * member eagerly from one module, so the interactive minority
 * (`NavShell`, `Toaster`/`toast`) drags the whole barrel down under
 * React's `react-server` condition even though `Shell`, `SkipLink`,
 * `SiteHeader`, and `SiteFooter` resolve cleanly on their own — none of
 * them import `react-aria-components`.
 *
 * MEMBERSHIP IS EMPIRICAL — confirmed by resolving each member's own
 * compiled file (`dist/shell/<Name>.js`, never the barrel) under
 * `node --conditions=react-server`. See `src/render-environment.ts` for
 * the recorded verdict and `render-environment.test.ts` for the negative
 * control proving `shell/index.ts` still fails the identical probe.
 *
 * ADDITIVE ONLY: every name below already ships from `shell/index.ts`.
 * No wildcard subpath, no per-file deep export — see `atoms/server.ts`'s
 * header for why.
 */

import { version as reactVersion } from "react";
import { assertPeerVersion } from "../internal/peer-version.js";
import { REACT_DECLARED_RANGE } from "../internal/declared-peer-ranges.js";

/**
 * `react` guard only — see `atoms/server.ts`'s own header for why
 * `react-aria-components` is deliberately NOT guarded from this file:
 * none of the members below import it (confirmed by grep against each
 * one's own source), and guarding it here would make that peer
 * non-optional for every consumer of this narrower subpath.
 */
assertPeerVersion({ peer: "react", declaredRange: REACT_DECLARED_RANGE, foundVersion: reactVersion });

export { Shell } from "./Shell.js";
export type {
  ShellProps,
  ShellHeaderProps,
  ShellSideNavProps,
  ShellMainProps,
  ShellRailProps,
  ShellFooterProps,
} from "./Shell.js";

export { SkipLink } from "./SkipLink.js";
export type { SkipLinkProps } from "./SkipLink.js";

export { SiteHeader } from "./SiteHeader.js";
export type { SiteHeaderProps } from "./SiteHeader.js";

export { SiteFooter } from "./SiteFooter.js";
export type { SiteFooterProps, SiteFooterColumnProps } from "./SiteFooter.js";
