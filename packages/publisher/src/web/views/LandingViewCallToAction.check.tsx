/** Compile-only API assertions; test files are excluded from the package typecheck. */
import type { LandingViewCallToAction, LandingViewProps } from "./LandingView.js";

interface ExtendedClose extends LandingViewCallToAction { label: string }
export const extended: ExtendedClose = { heading: "Close", action: <a href="/start">Start</a>, label: "Close" };
export const legacy: LandingViewProps["callToAction"] = extended;
export const reused: LandingViewProps["callToAction"] = { copy: "hero", action: <a href="/start">Start</a> };
export const overridden: LandingViewProps["callToAction"] = { copy: "hero", heading: null, description: false, action: <a href="/start">Start</a> };
// @ts-expect-error legacy close requires a heading
export const missingHeading: LandingViewProps["callToAction"] = { action: <a href="/start">Start</a> };
// @ts-expect-error hero reuse retains the required own action
export const missingAction: LandingViewProps["callToAction"] = { copy: "hero" };
// @ts-expect-error the named interface retains its required heading
export const interfaceMissingHeading: LandingViewCallToAction = { copy: "hero", action: <a href="/start">Start</a> };
// @ts-expect-error copy is a closed option
export const invalidCopy: LandingViewProps["callToAction"] = { copy: "other", heading: "Close", action: <a href="/start">Start</a> };
