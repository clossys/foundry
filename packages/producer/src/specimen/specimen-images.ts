/**
 * Placeholder images for Studio specimens only.
 *
 * Stock shadcn examples (item-example, aspect-ratio-example, message-example, ...) hard-code
 * remote images such as `https://avatar.vercel.sh/Project`. A specimen site's CSP allows images
 * from its own build and `data:` only (`img-src <site> data:`, installed-specimens.ts), so those
 * requests are refused and capture fails on console errors. A built specimen dist swaps every
 * image URL on a placeholder host for one inline `data:` SVG. The candidates stay byte-identical
 * (the swap runs on build output, never on installed or recorded files) and the CSP is unchanged.
 * Real consumer site builds (install-site, the Next install paths) never call this.
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Hosts whose image `src` the pinned library uses, from a grep of the image `src` hosts in
 * `packages/designer/references/**` and the pinned candidates under `clossys/agents/designer/**`
 * (2026-11-13: avatar.vercel.sh 737, github.com 204, images.unsplash.com 120 `src=` uses;
 * avatars.githubusercontent.com in `avatar:` fields fed to `<img src>`). These hosts serve only
 * images, so any URL on them is one; github.com also serves pages, so only its image files
 * (`github.com/<user>.png`) are swapped and every other github.com link is kept.
 */
export const PLACEHOLDER_IMAGE_HOSTS = ["avatar.vercel.sh", "images.unsplash.com", "avatars.githubusercontent.com"] as const;
/** Hosts that serve pages as well as images: only a path ending in an image extension is swapped. */
export const PLACEHOLDER_IMAGE_FILE_HOSTS = ["github.com"] as const;

/** One neutral square, scaled by its `<img>`; base64, so it is safe inside any quote or template literal. */
export const SPECIMEN_IMAGE_PLACEHOLDER = `data:image/svg+xml;base64,${Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" preserveAspectRatio="xMidYMid slice"><rect width="64" height="64" fill="#a1a1aa" fill-opacity="0.35"/></svg>',
).toString("base64")}`;

const escape = (host: string) => host.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
/** A URL character: never a quote, whitespace, markup, a template `${`, a paren or an escape, so a match never runs past its own string. */
const URL_CHAR = "[^\"'`\\s<>(){}$\\\\]";
const PLACEHOLDER_URL = new RegExp([
  `https?://(?:${PLACEHOLDER_IMAGE_HOSTS.map(escape).join("|")})(?:[/?#]${URL_CHAR}*)?`,
  `https?://(?:${PLACEHOLDER_IMAGE_FILE_HOSTS.map(escape).join("|")})/[^"'\`\\s<>(){}$\\\\?#]*\\.(?:png|jpe?g|gif|webp|avif|svg)(?:\\?${URL_CHAR}*)?`,
].join("|"), "gi");

/** `text` with every placeholder-host image URL swapped for SPECIMEN_IMAGE_PLACEHOLDER. */
export function placeholderImageText(text: string): string {
  return text.replace(PLACEHOLDER_URL, SPECIMEN_IMAGE_PLACEHOLDER);
}

const TEXT_OUTPUT = /\.(?:m?js|css|html)$/;

/** Swap placeholder-host image URLs in every script, stylesheet and page of a built specimen dist. */
export async function placeholderImages(dist: string): Promise<void> {
  for (const entry of await readdir(dist, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile() || !TEXT_OUTPUT.test(entry.name)) continue;
    const file = join(entry.parentPath, entry.name);
    const text = await readFile(file, "utf8");
    const swapped = placeholderImageText(text);
    if (swapped !== text) await writeFile(file, swapped);
  }
}
