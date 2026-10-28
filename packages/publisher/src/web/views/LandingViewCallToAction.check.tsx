/** Compile-only API assertions; test files are excluded from the package typecheck. */
import type { LandingViewCallToAction, LandingViewProps } from "@clossys/designer/frames";

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

export const closeActions: LandingViewProps["callToAction"] = { heading: "Close", actions: [{ id: "start", href: "/start", label: "Start", emphasis: "primary" }, { id: "guide", href: "/guide", label: <em>Guide</em>, emphasis: "quiet" }] };
export const reusedActions: LandingViewProps["callToAction"] = { copy: "hero", actions: [{ id: "start", href: "/start", label: "Start" }] };
// @ts-expect-error legacy action and the additive action list are mutually exclusive
export const competingClose: LandingViewProps["callToAction"] = { heading: "Close", action: <a href="/start">Start</a>, actions: [{ id: "start", href: "/start", label: "Start" }] };
// @ts-expect-error closing actions exclude tertiary
export const tertiaryClose: LandingViewProps["callToAction"] = { heading: "Close", actions: [{ id: "start", href: "/start", label: "Start", emphasis: "tertiary" }] };

import type { SectionedViewAction, SectionedViewContentAction } from "../../core/sectioned-view.js";
export const heroQuiet: SectionedViewAction = { id: "guide", href: "/guide", label: { id: "guide" }, emphasis: "quiet" };
export const bodyTertiary: SectionedViewContentAction = { id: "guide", href: "/guide", label: { id: "guide" }, emphasis: "tertiary" };
export const bodyQuiet: SectionedViewContentAction = { ...bodyTertiary, emphasis: "quiet" };
// @ts-expect-error hero actions exclude tertiary
export const tertiaryHero: SectionedViewAction = { ...heroQuiet, emphasis: "tertiary" };
// @ts-expect-error content action emphasis is closed
export const unknownBody: SectionedViewContentAction = { ...bodyTertiary, emphasis: "ghost" };

export const composedClose: LandingViewProps["callToAction"] = { heading: "Close", actions: [{ id: "start", href: "/start", label: ["Start ", [null, false, <em key="now">now</em>]] }], footnote: { text: ["Note ", <strong key="detail">detail</strong>], link: { label: ["Read ", <em key="guide">guide</em>], href: "/guide" } } };

// Consumers may name the resolved action through either public web barrel.
import type { LandingViewAction as PublicLandingViewAction } from "../index.js";
import type { LandingViewAction as ServerLandingViewAction } from "../server.js";
export const publicNamedAction: PublicLandingViewAction = { id: "start", href: "/start", label: <em>Start</em>, emphasis: "primary" };
export const serverNamedAction: ServerLandingViewAction = { ...publicNamedAction, id: "guide", href: "/guide", label: "Guide", emphasis: "quiet" };
export const namedConsumerClose: LandingViewProps["callToAction"] = { heading: "Close", actions: [publicNamedAction, serverNamedAction] };
