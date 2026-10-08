import type { SiteFrameConfig, SiteShellInput, SiteSurfaceKind } from "./types.js";

/** The surface kinds {@link siteShellFor} accepts, in a fixed order. Frozen. */
export const SITE_SURFACE_KINDS: readonly SiteSurfaceKind[] = Object.freeze(["site", "front-door", "admin", "demo"] as const);

/**
 * The shell for one surface kind, from the brand's one frame configuration.
 *
 * - `"site"`, the public site on the canonical origin: the brand, the
 *   configured navigation, calls to action and footer columns, and the legal
 *   row, all with links as given.
 * - `"front-door"`, `"admin"` and `"demo"`, surfaces on other hosts: the same
 *   brand and legal row with no navigation, calls to action or columns; the
 *   environment links instead, the one whose `surface` matches marked
 *   current; and `origin` set, so root-relative legal links point at the
 *   public site.
 *
 * Every kind shares the brand, the skip link, the ground and the legal row, so
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
      ...(site.nav === undefined ? {} : { nav: site.nav }),
      ...(site.actions === undefined ? {} : { actions: site.actions }),
      ...(site.secondaryAction === undefined ? {} : { secondaryAction: site.secondaryAction }),
      ...(site.navPlacement === undefined ? {} : { navPlacement: site.navPlacement }),
      footer: { ...(site.columns === undefined ? {} : { columns: site.columns }), legal: config.legal },
    };
  }
  return {
    ...shared,
    origin: config.origin,
    ...(config.environments === undefined
      ? {}
      : {
          environments: config.environments.map(({ surface, href, label, icon }) => ({ href, label, icon, isCurrent: surface === kind })),
        }),
    footer: { legal: config.legal },
  };
}
