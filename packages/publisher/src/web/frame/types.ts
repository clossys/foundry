import type { SiteFramePresentationConfig } from "./site-frame-contract.js";
import type { ReactNode } from "react";
import type { CopyRef, CopyResolver } from "@clossys/writer";
import type { IconNode } from "@clossys/designer/atoms/server";
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
  /** Header action look; accepted only in shell.actions. @default "secondary" */
  readonly emphasis?: "primary" | "secondary" | "ghost";
  /** Header action glyph; accepted only in shell.actions and validated as SVG shape data. */
  readonly icon?: IconNode;
}

type PlainSiteLinkInput = Omit<SiteLinkInput, "emphasis" | "icon">;

/** An icon-only link: its copy reference supplies the accessible name. */
export type SiteIconLinkInput = {
  readonly href: string;
  readonly label: CopyRef;
  /** Plain SVG shape data validated against the same allowlist as environment icons. */
  readonly icon: IconNode;
};

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
  /** Omitted inherits inverse overlay header ink; explicit auto keeps ordinary ink. */
  readonly tone?: "auto" | "inverse";
  /**
   * How the header's logomark is painted. Omitted or `"accent"` paints the
   * mark's shape in the accent token, using the asset as a mask, so supply a
   * single-colour mark. `"image"` opts out and renders the asset as it is, for
   * a multi-colour logo that the mask would flatten to a one-colour silhouette.
   */
  readonly markInk?: "image" | "accent";
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

export { SITE_CHROME_GROUNDS } from "../internal/viewChromeGround.js";
export type { SiteChromeGround } from "../internal/viewChromeGround.js";

/**
 * The footer: optional headed columns, ungrouped links and social profiles, then the legal row.
 *
 * Contract (`SITE_FRAME_CONTRACT.constituents.Footer.constraints`): `links` and
 * `legal.links` together form one flat row of at most five; further links go in
 * labelled `columns`. `social` takes at most four icons, because the `shell.brand` mark always fills the fifth and last slot. No footer link may
 * repeat home, a `shell.nav` destination or the `#privacy-choices` control.
 * Breaches throw a `SiteFooterContractError` (`name` and `code`), never truncate.
 */
interface SiteFooterFields {
  /** Footer-local surface and ink, independent of the global theme. @default "dark" */
  readonly tone?: "dark" | "light";
  readonly columns?: readonly { readonly heading: CopyRef; readonly links: readonly PlainSiteLinkInput[] }[];
  readonly links?: readonly PlainSiteLinkInput[];
  readonly social?: { readonly label?: CopyRef; readonly links: readonly SiteIconLinkInput[] };
  readonly legal: {
    readonly entity: CopyRef;
    readonly links: readonly PlainSiteLinkInput[];
    /** When given, the legal links sit in a `<nav>` with this name. */
    readonly linksLabel?: CopyRef;
  };
}

/** Flow follows page content; overlay reserves its opaque footer within a growing hero scene. */
export type SiteFooterInput = SiteFooterFields & { readonly placement?: "flow" | "overlay" };

/**
 * Everything the frame's chrome shows, as data only. There is no node slot for
 * a header, a footer or a mark: Publisher mounts Designer's chrome from this.
 */
export interface SiteShellInput {
  readonly brand: SiteBrandInput;
  /** The skip link's words. Its target is always {@link SITE_MAIN_ID}. */
  readonly skipLink: CopyRef;
  /**
   * Primary navigation in the banner, in a `<nav>` named by `label`. When it is
   * omitted and the header has any action, the frame still renders a menu with
   * no links and resolves its name and toggle through `resolveCopy` from the
   * copy references in `SITE_FRAME_CONTRACT.defaults` (`site-frame.nav.label`
   * and `site-frame.nav.trigger-label`). Unresolved default copy fails closed,
   * like any other shell label. Supply `nav` (links may be empty) to use other
   * copy references.
   */
  readonly nav?: {
    readonly label: CopyRef;
    /** The disclosure toggle copy; defaults to the resolved navigation label. */
    readonly triggerLabel?: CopyRef;
    readonly links: readonly (PlainSiteLinkInput & { readonly isCurrent?: boolean })[];
  };
  /** Calls to action at the trailing end of the banner. */
  readonly actions?: readonly SiteLinkInput[];
  /** Environment links, after text and icon actions. */
  readonly environments?: readonly SiteEnvironmentLinkInput[];
  readonly navPlacement?: "leading" | "centered";
  /** One header surface and theme-relative ink polarity. Glass follows declared page ground through the existing client island. */
  readonly header?: { readonly surface?: "solid" | "transparent" | "glass"; readonly tone?: "base" | "inverse" };
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
  /** Flat semantic presentation overrides; content remains in shell bindings. */
  readonly presentation?: SiteFramePresentationConfig;
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
    readonly header?: SiteShellInput["header"];
    readonly nav?: SiteShellInput["nav"];
    readonly actions?: SiteShellInput["actions"];
    readonly footerLinks?: SiteFooterInput["links"];
    readonly social?: SiteFooterInput["social"];
    readonly navPlacement?: SiteShellInput["navPlacement"];
    readonly columns?: SiteFooterInput["columns"];
  };
  /** One link per non-site surface; the one matching the surface kind is marked current. */
  readonly environments?: readonly (Omit<SiteEnvironmentLinkInput, "isCurrent"> & { readonly surface: Exclude<SiteSurfaceKind, "site"> })[];
  readonly legal: SiteFooterInput["legal"];
}

/** One row of the page-assembly contract: a layer, the package that owns it and who mounts it. */
export interface SitePageLayer {
  readonly id: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
  readonly name: string;
  readonly owner: string;
  readonly mountOwner: string;
  /**
   * What this Publisher release does for the layer:
   * - `"implemented"`: the frame mounts it.
   * - `"supplier"`: Publisher ships parts a host mounts itself; the frame does not mount them yet.
   * - `"contract-only"`: named in the contract; nothing ships in Publisher for it yet.
   * - `"out-of-scope"`: not part of the page contract.
   */
  readonly implementationScope: "implemented" | "supplier" | "contract-only" | "out-of-scope";
  /** Named parts of the layer that are not yet built, so a consumer does not assume them. */
  readonly deferred: readonly string[];
}
