import type { SiteHeaderProps } from "@clossys/designer/shell/server";

/**
 * The chrome ground the page frame and the views on the base surface accept:
 * one name for both. `"transparent-inverse"` carries the on-inverse ink and is
 * for chrome over an inverse page, which only `LandingView` paints, so the
 * frame and the other views refuse it.
 */
export type SiteChromeGround = Exclude<SiteHeaderProps["ground"], "transparent-inverse" | undefined>;

/** Every {@link SiteChromeGround}, for runtime checks. Frozen. */
export const SITE_CHROME_GROUNDS: readonly SiteChromeGround[] = Object.freeze(["base", "inverse", "transparent"] as const);
