/**
 * Compile-time-only assertions that the views on the base surface refuse the
 * `"transparent-inverse"` chrome ground. Named `.check.ts` rather than
 * `.test.ts` on purpose: this package's tsconfig excludes test files from the
 * real `tsc` run, so a `@ts-expect-error` inside one asserts nothing. Nothing
 * imports this file at runtime.
 */
import type { BoundaryViewProps } from "../views/BoundaryView.js";
import type { ContactViewProps } from "../views/ContactView.js";
import type { LandingViewProps } from "../views/LandingView.js";
import type { LegalViewProps } from "../views/LegalView.js";
import type { MarketingViewProps } from "../views/MarketingView.js";
import type { PackReviewViewProps } from "../views/PackReviewView.js";

export const boundaryTransparent: BoundaryViewProps["ground"] = "transparent";
export const boundaryInverse: BoundaryViewProps["ground"] = "inverse";

// @ts-expect-error BoundaryView keeps the base surface, so on-inverse chrome ink would sit on a light page
export const boundaryTransparentInverse: BoundaryViewProps["ground"] = "transparent-inverse";
// @ts-expect-error ContactView keeps the base surface
export const contactTransparentInverse: ContactViewProps["ground"] = "transparent-inverse";
// @ts-expect-error LegalView keeps the base surface
export const legalTransparentInverse: LegalViewProps["ground"] = "transparent-inverse";
// @ts-expect-error MarketingView keeps the base surface
export const marketingTransparentInverse: MarketingViewProps["ground"] = "transparent-inverse";
// @ts-expect-error PackReviewView keeps the base surface
export const packReviewTransparentInverse: PackReviewViewProps["ground"] = "transparent-inverse";

// @ts-expect-error LandingView's ground is the page's own, and its chrome ground is derived, never passed
export const landingTransparentInverse: LandingViewProps["ground"] = "transparent-inverse";
