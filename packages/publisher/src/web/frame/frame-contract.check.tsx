/**
 * Compile-time-only assertions about the `SiteFrame` contract. Named
 * `.check.tsx` rather than `.test.tsx` on purpose: this package's tsconfig
 * excludes test files from the real `tsc` run, so a `@ts-expect-error` inside
 * one asserts nothing. Nothing imports this file at runtime.
 */
import type { CopyResolver } from "@clossys/writer";
import type { AssetResolver } from "../types.js";
import { SiteFrame } from "./SiteFrame.js";
import { siteShellFor } from "./surface.js";
import type { SiteBrandInput, SiteFrameConfig, SiteIconLinkInput, SiteLinkInput, SiteShellInput } from "./types.js";

declare const resolveCopy: CopyResolver;
declare const resolveAsset: AssetResolver;
declare const config: SiteFrameConfig;

const mark: SiteBrandInput = { assetId: "brand-mark", label: { id: "brand.name" }, size: "md", variant: "mark" };
const shell: SiteShellInput = { brand: mark, skipLink: { id: "shell.skipLink" } };

export const framed = (
  <SiteFrame shell={shell} resolveCopy={resolveCopy} resolveAsset={resolveAsset}>
    <p>content</p>
  </SiteFrame>
);

export const perKind = siteShellFor(config, "front-door");

// The shell is data only: there is no node slot for a header, footer or mark.
// @ts-expect-error header configuration is data, not a nullable node slot
export const withHeaderNode: SiteShellInput = { brand: mark, skipLink: { id: "shell.skipLink" }, header: null };

// @ts-expect-error SiteShellInput has no footer node slot
export const withFooterNode: SiteShellInput = { brand: mark, skipLink: { id: "shell.skipLink" }, footer: <footer /> };

// The skip link's words are a copy reference, never a literal string.
// @ts-expect-error skipLink is a CopyRef
export const withLiteralSkipLink: SiteShellInput = { brand: mark, skipLink: "Skip to content" };

// A lockup requires its wordmark.
// @ts-expect-error a lockup needs a wordmark
export const lockupWithoutWordmark: SiteBrandInput = { assetId: "brand-mark", label: { id: "brand.name" }, size: "md", variant: "lockup" };

// A mark forbids a wordmark.
// @ts-expect-error a mark takes no wordmark
export const markWithWordmark: SiteBrandInput = { assetId: "brand-mark", label: { id: "brand.name" }, size: "md", variant: "mark", wordmark: { id: "brand.wordmark" } };

// The frame has no main-id prop: the main id is fixed.
export const withMainId = (
  // @ts-expect-error SiteFrame has no mainId prop
  <SiteFrame shell={shell} resolveCopy={resolveCopy} resolveAsset={resolveAsset} mainId="content">
    <p>content</p>
  </SiteFrame>
);

// Only the four surface kinds exist.
// @ts-expect-error unknown surface kind
export const unknownKind = siteShellFor(config, "intranet");


// @ts-expect-error an icon link requires a copy reference label
export const iconWithoutLabel: SiteIconLinkInput = { href: "/contact", icon: [["path", { d: "M0 0" }]] };
// @ts-expect-error an icon link requires SVG shape data
export const iconWithoutGlyph: SiteIconLinkInput = { href: "/contact", label: { id: "contact" } };
// @ts-expect-error an icon link cannot take a React node as its icon
export const iconWithNode: SiteIconLinkInput = { href: "/contact", label: { id: "contact" }, icon: <svg /> };
// @ts-expect-error social navigation label is a copy reference
export const socialWithLiteralLabel: SiteShellInput = { ...shell, footer: { legal: config.legal, social: { label: "Profiles", links: [] } } };

// The type is available from each public frame entry.
export type IconLinkEntryParity = [
  import("./index.js").SiteIconLinkInput,
  import("../index.js").SiteIconLinkInput,
  import("../server.js").SiteIconLinkInput,
];


export const solidHeader: SiteShellInput = { ...shell, header: { surface: "solid", tone: "inverse" } };
export const overlayHeader: SiteShellInput = { ...shell, header: { surface: "glass", tone: "inverse" } };
export const defaultHeader: SiteShellInput = { ...shell, header: {} };
// @ts-expect-error placement is removed for every header surface
export const reservedTone: SiteShellInput = { ...shell, header: { placement: "reserved", tone: "inverse" } };
export const omittedPlacementTone: SiteShellInput = { ...shell, header: { tone: "inverse" } };
// @ts-expect-error header ground is removed; use surface and tone
export const omittedPlacementGround: SiteShellInput = { ...shell, header: { ground: "inverse" } };
// @ts-expect-error neither placement nor header ground is accepted
export const overlayGround: SiteShellInput = { ...shell, header: { placement: "overlay", ground: "base" } };

export const independentFooter: SiteShellInput = { ...shell, footer: { tone: "dark", legal: config.legal } };
export const disclosureCopy: SiteShellInput = { ...shell, nav: { label: { id: "nav.label" }, triggerLabel: { id: "nav.toggle" }, links: [] } };
// @ts-expect-error the disclosure toggle label is a copy reference, never literal text
export const literalDisclosureCopy: SiteShellInput = { ...shell, nav: { label: { id: "nav.label" }, triggerLabel: "Menu", links: [] } };
// @ts-expect-error footer ground is removed
export const invalidFooterGround: SiteShellInput = { ...shell, footer: { ground: "unknown", legal: config.legal } };


export const overlayFooter: SiteShellInput = { ...shell, header: { surface: "glass", tone: "inverse" }, footer: { placement: "overlay", legal: config.legal } };
export const flowFooter: SiteShellInput = { ...shell, footer: { placement: "flow", tone: "light", legal: config.legal } };
// @ts-expect-error footer placement accepts only flow or overlay
export const invalidFooterPlacement: SiteShellInput = { ...shell, footer: { placement: "fixed", legal: config.legal } };
// @ts-expect-error footer ground is removed even with overlay placement
export const transparentOverlayFooter: SiteShellInput = { ...shell, footer: { placement: "overlay", ground: "transparent", legal: config.legal } };

// Appearance inputs are reachable from the canonical barrel and both web entries.
type ActionEmphasis = [import("../../index.js").SiteLinkInput["emphasis"], import("../index.js").SiteLinkInput["emphasis"], import("../server.js").SiteLinkInput["emphasis"]];
type BrandTone = [import("../../index.js").SiteBrandInput["tone"], import("../index.js").SiteBrandInput["tone"], import("../server.js").SiteBrandInput["tone"]];
type HeaderTone = [NonNullable<import("../../index.js").SiteShellInput["header"]>["tone"], NonNullable<import("../index.js").SiteShellInput["header"]>["tone"], NonNullable<import("../server.js").SiteShellInput["header"]>["tone"]];
type FooterTone = [import("../../index.js").SiteFooterInput["tone"], import("../index.js").SiteFooterInput["tone"], import("../server.js").SiteFooterInput["tone"]];
type HeroEyebrowTone = [import("../../index.js").SectionedViewHeroSection["eyebrowTone"], import("../index.js").SectionedViewHeroSection["eyebrowTone"], import("../server.js").SectionedViewHeroSection["eyebrowTone"]];
type HeroMeasure = [import("../../index.js").SectionedViewHeroSection["measure"], import("../index.js").SectionedViewHeroSection["measure"], import("../server.js").SectionedViewHeroSection["measure"]];
type HeroHeadingScale = [import("../../index.js").SectionedViewHeroSection["headingScale"], import("../index.js").SectionedViewHeroSection["headingScale"], import("../server.js").SectionedViewHeroSection["headingScale"]];
export const actionEmphasis: ActionEmphasis = ["primary", "secondary", undefined];
export const brandTone: BrandTone = ["auto", "inverse", undefined];
export const headerTone: HeaderTone = ["base", "inverse", undefined];
export const footerTone: FooterTone = ["dark", "light", undefined];
export const heroEyebrowTone: HeroEyebrowTone = ["accent", "muted", undefined];
export const heroMeasure: HeroMeasure = ["prose", "wide", undefined];
export const heroHeadingScale: HeroHeadingScale = ["default", "display", undefined];
// @ts-expect-error action emphasis is closed
export const invalidEmphasis: ActionEmphasis = ["danger", "secondary", undefined];
// @ts-expect-error brand tone is closed
export const invalidBrandTone: BrandTone = ["base", "inverse", undefined];
// @ts-expect-error header tone is closed
export const invalidHeaderTone: HeaderTone = ["auto", "inverse", undefined];
// @ts-expect-error footer tone is closed
export const invalidFooterTone: FooterTone = ["inverse", "light", undefined];
// @ts-expect-error hero eyebrow tone is closed
export const invalidEyebrowTone: HeroEyebrowTone = ["quiet", "muted", undefined];
// @ts-expect-error hero measure is closed
export const invalidMeasure: HeroMeasure = ["content", "wide", undefined];
// @ts-expect-error hero heading scale is closed
export const invalidHeadingScale: HeroHeadingScale = ["large", "display", undefined];
// @ts-expect-error emphasis belongs to shell.actions only
export const navigationEmphasis: SiteShellInput = { ...shell, nav: { label: { id: "nav" }, links: [{ href: "/", label: { id: "home" }, emphasis: "primary" }] } };
// Existing callers may type ordinary links with the public SiteLinkInput type.
const plainLink: SiteLinkInput = { href: "/help", label: { id: "help" } };
const plainLinks: readonly SiteLinkInput[] = [plainLink];
export const typedNavigationLinks: SiteShellInput = { ...shell, nav: { label: { id: "nav" }, links: plainLinks } };
export const typedFooterLinks: SiteShellInput = { ...shell, footer: { links: plainLinks, legal: config.legal } };
export const typedFooterColumnLinks: SiteShellInput = { ...shell, footer: { columns: [{ heading: { id: "help" }, links: plainLinks }], legal: config.legal } };
export const typedLegalLinks: SiteFrameConfig["legal"] = { entity: { id: "entity" }, links: plainLinks };
export const typedOrderedActions: SiteShellInput = { ...shell, actions: [plainLink] };
// @ts-expect-error footer legal links do not accept header action emphasis
export const legalEmphasis: SiteShellInput = { ...shell, footer: { legal: { entity: { id: "entity" }, links: [{ href: "/", label: { id: "home" }, emphasis: "primary" }] } } };

const actionIcon = [["path", { d: "M4 12h16" }]] as const;
export const mobileShell: SiteShellInput = {
  ...shell,
  nav: { label: { id: "nav" }, links: plainLinks },
  actions: [{ href: "/start", label: { id: "start" }, icon: actionIcon, emphasis: "primary" }],
};
export const mobileConfig: SiteFrameConfig = { ...config, site: { nav: mobileShell.nav, actions: mobileShell.actions } };
export const mobileSite = siteShellFor(mobileConfig, "site");

type ActionIcon = [import("../../index.js").SiteLinkInput["icon"], import("../index.js").SiteLinkInput["icon"], import("../server.js").SiteLinkInput["icon"]];
type HeaderSurface = [NonNullable<import("../../index.js").SiteShellInput["header"]>["surface"], NonNullable<import("../index.js").SiteShellInput["header"]>["surface"], NonNullable<import("../server.js").SiteShellInput["header"]>["surface"]];

export const actionIcons: ActionIcon = [actionIcon, undefined, actionIcon];
export const headerSurfaces: HeaderSurface = ["solid", "transparent", "glass"];
// @ts-expect-error mobile layout is removed
export const invalidMobileLayout: SiteShellInput = { ...shell, mobileLayout: "stacked" };
// @ts-expect-error the navigation trigger is no longer an input
export const invalidNavigationTrigger: SiteShellInput = { ...shell, nav: { label: { id: "nav" }, trigger: "drawer", links: [] } };
// @ts-expect-error icons are SVG shape data, not React nodes
export const actionIconNode: SiteLinkInput = { href: "/start", label: { id: "start" }, icon: <svg /> };
// @ts-expect-error icons belong to shell.actions, not navigation links
export const navigationIcon: SiteShellInput = { ...shell, nav: { label: { id: "nav" }, links: [{ href: "/", label: { id: "home" }, icon: actionIcon }] } };
// @ts-expect-error secondary actions use the single actions list
export const secondaryActionIcon: SiteShellInput = { ...shell, secondaryAction: { href: "/", label: { id: "home" }, icon: actionIcon } };
// @ts-expect-error ordinary footer links remain plain links
export const footerLinkIcon: SiteShellInput = { ...shell, footer: { legal: config.legal, links: [{ href: "/", label: { id: "home" }, icon: actionIcon }] } };
// @ts-expect-error footer column links remain plain links
export const footerColumnIcon: SiteShellInput = { ...shell, footer: { legal: config.legal, columns: [{ heading: { id: "help" }, links: [{ href: "/", label: { id: "home" }, icon: actionIcon }] }] } };
// @ts-expect-error legal links remain plain links
export const legalLinkIcon: SiteFrameConfig["legal"] = { entity: { id: "entity" }, links: [{ href: "/", label: { id: "home" }, icon: actionIcon }] };

export const semanticFrame = <SiteFrame {...{ shell, resolveCopy, resolveAsset }} presentation={{ headerSurface: "glass", headerTone: "inverse" }}><h1>View content</h1></SiteFrame>;
export type SemanticFrameEntryParity = [import("./index.js").SiteFramePresentationConfig, import("../index.js").SiteFramePresentationConfig, import("../server.js").SiteFramePresentationConfig];
// @ts-expect-error mandatory behavior is not a disabling option
export const noSticky: import("./index.js").SiteFramePresentationConfig = { sticky: false };
// @ts-expect-error semantic configuration is flat primitive data
export const nestedPresentation: import("./index.js").SiteFramePresentationConfig = { headerTone: {} };


// Frame-only renderer configuration must not become an ignored option on wrappers.
declare const errorDocumentInput: import("../views/GlobalErrorDocument.js").GlobalErrorDocumentFramedProps;
// @ts-expect-error GlobalErrorDocument forwards only shell and resolver ports, not presentation
export const ignoredWrapperPresentation: typeof errorDocumentInput = { ...errorDocumentInput, presentation: {} };

// The replacement header contract is positive and refuses each retired field.
export const solidHeaderSurface: SiteShellInput = { ...shell, header: { surface: "solid", tone: "inverse" } };
export const transparentHeaderSurface: SiteShellInput = { ...shell, header: { surface: "transparent", tone: "base" } };
export const glassHeaderSurface: SiteShellInput = { ...shell, header: { surface: "glass", tone: "inverse" } };
// @ts-expect-error placement is replaced by header.surface
export const staleShellPlacement: SiteShellInput = { ...shell, header: { placement: "overlay" } };
// @ts-expect-error a separate icon-actions list no longer exists
export const staleIconActions: SiteShellInput = { ...shell, iconActions: [] };
// @ts-expect-error a separate secondary action no longer exists
export const staleSecondaryAction: SiteShellInput = { ...shell, secondaryAction: plainLink };
// @ts-expect-error the surface badge is removed
export const staleSurfaceBadge: SiteShellInput = { ...shell, surfaceLabel: { id: "badge" } };
// @ts-expect-error only one mobile layout exists
export const staleMobileHeader: SiteShellInput = { ...shell, mobileLayout: "inline" };
// @ts-expect-error the navigation always uses its icon trigger
export const staleNavigationTrigger: SiteShellInput = { ...shell, nav: { label: { id: "nav" }, links: [], trigger: "label" } };
// @ts-expect-error navigation tone follows the header tone
export const staleNavigationTone: SiteShellInput = { ...shell, nav: { label: { id: "nav" }, links: [], tone: "inverse" } };

// @ts-expect-error the obsolete AuthView badge has no compatibility alias
export type RemovedAuthViewBadge = Pick<import("../views/AuthView.js").AuthViewProps, "surfaceLabel">;
// @ts-expect-error the obsolete PackReviewView badge has no compatibility alias
export type RemovedPackReviewViewBadge = Pick<import("../views/PackReviewView.js").PackReviewViewProps, "surfaceLabel">;

// @ts-expect-error shell global ground is removed.
export const staleGlobalGround: SiteShellInput = { ...shell, ground: "base" };
// @ts-expect-error config global ground is removed.
export const staleConfigGround: SiteFrameConfig = { ...config, ground: "base" };
// @ts-expect-error footer rule is removed.
export const staleFooterRule: SiteShellInput = { ...shell, footer: { legal: config.legal, rule: "top" } };

// @ts-expect-error even a former valid footer ground has no alias.
export const staleValidFooterGround: SiteShellInput = { ...shell, footer: { legal: config.legal, ground: "base" } };
