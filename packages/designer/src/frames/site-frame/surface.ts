import type { SiteFrameConfig, SiteShellInput, SiteSurfaceKind } from "./types.js";

/** The surface kinds {@link siteShellFor} accepts, in a fixed order. Frozen. */
export const SITE_SURFACE_KINDS: readonly SiteSurfaceKind[] = Object.freeze(["site", "front-door", "admin", "demo"] as const);

/**
 * The shell for one surface kind, from the brand's one frame configuration.
 *
 * - `"site"`, the public site on the canonical origin: the brand, the
 *   configured navigation, text and icon calls to action, footer columns,
 *   ungrouped footer links and social links, and the legal row, all with
 *   links as given.
 * - `"front-door"`, `"admin"` and `"demo"`, surfaces on other hosts: the same
 *   brand and legal row with no navigation, calls to action, columns,
 *   ungrouped footer links or social links; only the matching environment
 *   link, marked current, with the brand leading at every width; and
 *   `origin` set, so the brand and root-relative legal links point at the public site.
 *
 * Every kind shares the brand, the skip link, the footer ground and the legal row, so
 * a visitor sees one header and one footer across the brand's surfaces.
 */
export function siteShellFor(config: SiteFrameConfig, kind: SiteSurfaceKind): SiteShellInput {
  if (!SITE_SURFACE_KINDS.includes(kind)) {
    throw new Error("siteShellFor: unknown surface kind; expected site, front-door, admin or demo.");
  }
  const shared = {
    brand: config.brand,
    skipLink: config.skipLink,
    ...(config.ground === undefined ? {} : { ground: config.ground }),
  };
  if (kind === "site") {
    const site = config.site ?? {};
    return {
      ...shared,
      ...(site.header === undefined ? {} : { header: site.header }),
      ...(site.nav === undefined ? {} : { nav: site.nav }),
      ...(site.actions === undefined ? {} : { actions: site.actions }),
      ...(site.navPlacement === undefined ? {} : { navPlacement: site.navPlacement }),
      footer: {
        ...(site.footerBrandBand === undefined ? {} : { brandBand: site.footerBrandBand }),
        ...(site.columns === undefined ? {} : { columns: site.columns }),
        ...(site.footerLinks === undefined ? {} : { links: site.footerLinks }),
        ...(site.social === undefined ? {} : { social: site.social }),
        legal: config.legal,
      },
    };
  }
  return {
    ...shared,
    origin: config.origin,
    ...(config.environments === undefined
      ? {}
      : {
          environments: config.environments.filter(({ surface }) => surface === kind).map(({ href, label, icon }) => ({ href, label, icon, isCurrent: true })),
        }),
    footer: { legal: config.legal },
  };
}
