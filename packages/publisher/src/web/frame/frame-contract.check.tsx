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
import type { SiteBrandInput, SiteFrameConfig, SiteShellInput } from "./types.js";

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
// @ts-expect-error SiteShellInput has no header slot
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
