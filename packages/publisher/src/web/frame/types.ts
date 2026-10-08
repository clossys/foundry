import type { ReactNode } from "react";
import type { CopyRef, CopyResolver } from "@clossys/writer";
import type { IconNode } from "@clossys/designer/atoms/server";
import type { SiteHeaderProps } from "@clossys/designer/shell/server";
import type { AssetResolver } from "../types.js";

/**
 * The fixed `id` of the one `<main>` a `SiteFrame` renders, and the target of
 * its skip link. Views never carry it: the frame owns the page's only main.
 */
export const SITE_MAIN_ID = "publisher-main-content" as const;

/** A link in the shell: a destination and the copy reference for its words. */
export interface SiteLinkInput {
  /**
   * A root-relative path (`/terms`), a fragment or query, or an absolute
   * `https:`, `http:`, `mailto:` or `tel:` URL. Anything else, including a
   * protocol-relative `//host` link, is refused.
   */
  readonly href: string;
  readonly label: CopyRef;
}

/**
 * The brand in the banner, as data: an asset id the frame resolves to an image
 * through `resolveAsset`, and copy references for the link's accessible name
 * and (for a lockup) the live-text wordmark. Rendered by Designer's
 * `Brandmark`; there is no node slot for a mark.
 */
export type SiteBrandInput = {
  readonly assetId: string;
  readonly label: CopyRef;
  readonly size: "sm" | "md" | "lg";
  readonly plate?: "self" | "shared";
} & ({ readonly variant: "mark"; readonly wordmark?: never } | { readonly variant: "lockup"; readonly wordmark: CopyRef });

/**
 * An environment link in the banner (an app, an admin, a demo), rendered as
 * Designer's `SiteHeader.ActionLink`: icon plus label from the tablet
 * breakpoint up, icon alone below it with the label kept as its name.
 */
export interface SiteEnvironmentLinkInput {
  readonly href: string;
  readonly label: CopyRef;
  /** Plain SVG shape data (`path`, `circle`, `rect`, ...). Event-handler and link attributes are refused. */
  readonly icon: IconNode;
  /** Marks the environment the page belongs to (`aria-current="true"`). */
  readonly isCurrent?: boolean;
}

/** The plate of the banner and footer: Designer's site-chrome grounds. */
export type SiteChromeGround = NonNullable<SiteHeaderProps["ground"]>;

/** The footer: optional link columns, then the legal row. */
export interface SiteFooterInput {
  readonly columns?: readonly { readonly heading: CopyRef; readonly links: readonly SiteLinkInput[] }[];
  readonly legal: {
    readonly entity: CopyRef;
    readonly links: readonly SiteLinkInput[];
    /** When given, the legal links sit in a `<nav>` with this name. */
    readonly linksLabel?: CopyRef;
  };
}

/**
 * Everything the frame's chrome shows, as data only. There is no node slot for
 * a header, a footer or a mark: Publisher mounts Designer's chrome from this.
 */
export interface SiteShellInput {
  readonly brand: SiteBrandInput;
  /** The skip link's words. Its target is always {@link SITE_MAIN_ID}. */
  readonly skipLink: CopyRef;
  /** Primary navigation in the banner, in a `<nav>` named by `label`. */
  readonly nav?: { readonly label: CopyRef; readonly links: readonly SiteLinkInput[] };
  /** Calls to action at the trailing end of the banner. */
  readonly actions?: readonly SiteLinkInput[];
  /** A secondary call to action, just before `actions`. */
  readonly secondaryAction?: SiteLinkInput;
  /** Environment links, after `actions`. */
  readonly environments?: readonly SiteEnvironmentLinkInput[];
  /** A text badge naming the surface. Prefer `environments` with `isCurrent`. */
  readonly surfaceLabel?: CopyRef;
  readonly navPlacement?: "leading" | "centered";
  /** @default "base" */
  readonly ground?: SiteChromeGround;
  readonly footer?: SiteFooterInput;
  /**
   * The canonical public origin (`https://example.com`), for a surface served
   * from another host. When set, every root-relative link in the nav, the
   * actions and the footer resolves against it, so a sign-in page on an app
   * host links to the public site's terms rather than its own host's.
   */
  readonly origin?: string;
}

/** What the frame needs besides its children: the shell and the runtime ports that resolve its copy and assets. */
export interface SiteFrameInput {
  readonly shell: SiteShellInput;
  readonly resolveCopy: CopyResolver;
  readonly resolveAsset: AssetResolver;
}

export interface SiteFrameProps extends SiteFrameInput {
  /** The page content: one chrome-free view, rendered inside the frame's `<main>`. */
  readonly children: ReactNode;
}

/** The surfaces one brand ships: its public site, its front door (sign-in and friends), an admin console and a demo. */
export type SiteSurfaceKind = "site" | "front-door" | "admin" | "demo";

/**
 * One declared frame configuration for a brand. {@link siteShellFor} turns it
 * into the shell for each surface kind, so every surface shares the brand,
 * skip link and legal row and differs only where the kind says it should.
 */
export interface SiteFrameConfig {
  readonly brand: SiteBrandInput;
  readonly skipLink: CopyRef;
  /** The canonical public origin. Surfaces other than `"site"` resolve their legal links against it. */
  readonly origin: string;
  /** Chrome the public site shows and the other surfaces do not. */
  readonly site?: {
    readonly nav?: SiteShellInput["nav"];
    readonly actions?: SiteShellInput["actions"];
    readonly secondaryAction?: SiteShellInput["secondaryAction"];
    readonly navPlacement?: SiteShellInput["navPlacement"];
    readonly columns?: SiteFooterInput["columns"];
  };
  /** One link per non-site surface; the one matching the surface kind is marked current. */
  readonly environments?: readonly (Omit<SiteEnvironmentLinkInput, "isCurrent"> & { readonly surface: Exclude<SiteSurfaceKind, "site"> })[];
  readonly legal: SiteFooterInput["legal"];
  readonly ground?: SiteChromeGround;
}

/** One row of the page-assembly contract: a layer, the package that owns it and who mounts it. */
export interface SitePageLayer {
  readonly id: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
  readonly name: string;
  readonly owner: string;
  readonly mountOwner: string;
  readonly implementationScope: "contract-only" | "supplier" | "this-unit" | "out-of-scope";
}
