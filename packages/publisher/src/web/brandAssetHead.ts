import type { PublicationMap } from "../core/publication-map.js";
import { checkBrandAssetRoster, type BrandAssetEntry } from "../media/brand-assets.js";

export interface BrandAssetHeadLink {
  rel: "icon" | "apple-touch-icon";
  href: string;
  type?: string;
  sizes?: string;
}

/**
 * Links a web document head should emit for a complete brand-asset roster.
 * An incomplete roster emits nothing: the check fails closed instead of
 * publishing a partial icon set.
 */
export function brandAssetHeadLinks(entries: readonly BrandAssetEntry[]): BrandAssetHeadLink[] {
  if (checkBrandAssetRoster(entries).length > 0) return [];
  const favicon = entries.find((entry) => entry.role === "favicon-svg");
  const touch = entries.find((entry) => entry.role === "apple-touch-180");
  if (favicon === undefined || touch === undefined) return [];
  return [
    { rel: "icon", href: favicon.src, type: "image/svg+xml" },
    { rel: "apple-touch-icon", href: touch.src, sizes: "180x180" },
  ];
}

/** Web paths on the publication map are what emit icons. A slide-only map does not. */
export function publicationMapEmitsBrandAssets(map: PublicationMap): boolean {
  return map.entries.some((entry) => entry.location.kind === "path");
}
