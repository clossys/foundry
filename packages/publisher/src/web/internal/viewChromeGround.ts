import type { SiteHeaderProps } from "@clossys/designer/shell/server";

/**
 * The chrome ground the page frame and the views on the base surface accept:
 * one name for both. `"transparent-inverse"` carries the on-inverse ink and is
 * for chrome over an inverse page, which only `LandingView` paints, so the
 * frame and the other views refuse it.
 */
export type SiteChromeGround = Exclude<SiteHeaderProps["ground"], "transparent-inverse" | undefined>;

const GROUNDS = ["base", "inverse", "transparent"] as const;

/** Every {@link SiteChromeGround}, for runtime checks. Frozen. */
export const SITE_CHROME_GROUNDS: readonly SiteChromeGround[] = Object.freeze(GROUNDS);

// Compile-time check that the runtime list and the type name the same grounds:
// this fails to compile if either has a value the other lacks.
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
const groundsMatchList: Equal<SiteChromeGround, (typeof GROUNDS)[number]> = true;
void groundsMatchList;
