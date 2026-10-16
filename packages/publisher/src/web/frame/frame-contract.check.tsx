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
import type { SiteBrandInput, SiteFrameConfig, SiteIconLinkInput, SiteShellInput } from "./types.js";

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


export const reservedHeader: SiteShellInput = { ...shell, header: { placement: "reserved", ground: "inverse" } };
export const overlayHeader: SiteShellInput = { ...shell, header: { placement: "overlay", tone: "inverse" } };
export const defaultHeader: SiteShellInput = { ...shell, header: {} };
// @ts-expect-error reserved headers take a ground, not an overlay tone
export const reservedTone: SiteShellInput = { ...shell, header: { placement: "reserved", tone: "inverse" } };
// @ts-expect-error omitting placement still selects reserved chrome
export const omittedPlacementTone: SiteShellInput = { ...shell, header: { tone: "inverse" } };
// @ts-expect-error overlay headers take a tone, not a reserved ground
export const overlayGround: SiteShellInput = { ...shell, header: { placement: "overlay", ground: "base" } };

export const independentFooter: SiteShellInput = { ...shell, footer: { ground: "inverse", legal: config.legal } };
export const disclosureCopy: SiteShellInput = { ...shell, nav: { label: { id: "nav.label" }, triggerLabel: { id: "nav.toggle" }, links: [] } };
// @ts-expect-error the disclosure toggle label is a copy reference, never literal text
export const literalDisclosureCopy: SiteShellInput = { ...shell, nav: { label: { id: "nav.label" }, triggerLabel: "Menu", links: [] } };
// @ts-expect-error footer ground accepts only the existing chrome grounds
export const invalidFooterGround: SiteShellInput = { ...shell, footer: { ground: "unknown", legal: config.legal } };


export const overlayFooter: SiteShellInput = { ...shell, header: { placement: "overlay", tone: "inverse" }, footer: { placement: "overlay", legal: config.legal } };
export const flowFooter: SiteShellInput = { ...shell, footer: { placement: "flow", ground: "transparent", legal: config.legal } };
// @ts-expect-error footer placement accepts only flow or overlay
export const invalidFooterPlacement: SiteShellInput = { ...shell, footer: { placement: "fixed", legal: config.legal } };
// @ts-expect-error overlay placement requires an opaque footer ground
export const transparentOverlayFooter: SiteShellInput = { ...shell, footer: { placement: "overlay", ground: "transparent", legal: config.legal } };
