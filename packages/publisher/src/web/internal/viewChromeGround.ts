import type { SiteHeaderProps } from "@clossys/designer/shell/server";

/**
 * The chrome ground a view on the base surface accepts. `"transparent-inverse"`
 * carries the on-inverse ink and is for chrome over an inverse page, which
 * only `LandingView` paints, so the other views refuse it.
 */
export type ViewChromeGround = Exclude<SiteHeaderProps["ground"], "transparent-inverse">;
