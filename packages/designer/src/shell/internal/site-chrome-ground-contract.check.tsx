/**
 * Compile-time proof that the `transparent` ground belongs to the site
 * chrome (`SiteHeader`, `SiteFooter`) only. `Shell.Header` and `Shell.Footer`
 * keep the closed `base` / `inverse` set, so widening the site chrome's
 * ground type must not widen theirs.
 *
 * A `*.check.tsx` file rather than a runtime test, because `tsc` excludes
 * `*.test.tsx` and a `@ts-expect-error` there asserts nothing (see
 * `shell-contract.check.tsx` for the full reasoning and the gate that
 * enforces it).
 */
import { Shell } from "../Shell.js";
import { SiteFooter } from "../SiteFooter.js";
import { SiteHeader } from "../SiteHeader.js";

export const siteHeaderAcceptsTransparent = <SiteHeader ground="transparent" brand={<a href="/">Home</a>} />;

export const siteFooterAcceptsTransparent = <SiteFooter ground="transparent" secondary={<span>Legal</span>} />;

export const shellHeaderAcceptsInverse = <Shell.Header ground="inverse">Header</Shell.Header>;

export const shellFooterAcceptsBase = <Shell.Footer ground="base">Footer</Shell.Footer>;

// @ts-expect-error — `transparent` is a site-chrome ground only: Shell.Header keeps `base` | `inverse`.
export const shellHeaderRejectsTransparent = <Shell.Header ground="transparent">Header</Shell.Header>;

// @ts-expect-error — `transparent` is a site-chrome ground only: Shell.Footer keeps `base` | `inverse`.
export const shellFooterRejectsTransparent = <Shell.Footer ground="transparent">Footer</Shell.Footer>;
