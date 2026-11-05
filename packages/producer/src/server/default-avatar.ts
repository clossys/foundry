/**
 * The default placeholder image: the consumer's pinned `assets.image` placeholder entry.
 *
 * Stock shadcn blocks carry sample users whose avatar is a site-root placeholder such as
 * `/avatars/shadcn.jpg`. Those files are not shipped, and the blocks are adopted verbatim, so
 * Producer answers every such request with the one placeholder image instead: Studio, its
 * specimens and previews all show the same brand placeholder without editing any block.
 *
 * Source order: the pinned `assets.image` candidate's `assets.image.placeholder` entry, then the
 * pinned `assets.mark` candidate's `assets.mark.positive` token, then the consumer brand's mark.
 * Without any, the route answers 404: nothing falls back to Foundry's own mark. A pinned
 * candidate whose bytes drifted from its pin is never served.
 */
import { join } from "node:path";
import { pinnedAssetSvg, pinnedImageSvg } from "./consumer-brand.js";
import { consumerBrand } from "./designer-globals.js";

/**
 * A placeholder image path a stock block references but does not ship: one file directly under
 * `/avatars/`. Widen it only for paths a rendered specimen actually requests and gets a 404 for.
 */
export const DEFAULT_AVATAR_PATH = /^\/avatars\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}\.(?:jpe?g|png|webp|avif|gif|svg)$/;

/** The pinned slot-model mark's positive SVG, if the library pins one. */
export function pinnedMarkSvg(library: string): string | undefined {
  return pinnedAssetSvg(library, "mark", "positive");
}

/** The pinned `assets.image` placeholder entry's SVG (an SVG data URI in its rules), if pinned. */
export function pinnedPlaceholderSvg(library: string): string | undefined {
  return pinnedImageSvg(library, "placeholder");
}

/** The default placeholder SVG for a workspace root, or undefined when it has neither placeholder nor mark. */
export async function defaultAvatarSvg(root: string, library = join(root, "clossys")): Promise<string | undefined> {
  return pinnedPlaceholderSvg(library) ?? pinnedMarkSvg(library)
    ?? (await consumerBrand(root).catch(() => ({} as Awaited<ReturnType<typeof consumerBrand>>))).mark?.light;
}
