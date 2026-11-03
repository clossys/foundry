/**
 * The default placeholder image: the consumer's pinned `assets.image` placeholder entry.
 *
 * Stock shadcn blocks carry sample users whose avatar is a site-root placeholder such as
 * `/avatars/shadcn.jpg`. Those files are not shipped, and the blocks are adopted verbatim, so
 * Producer answers every such request with the one placeholder image instead: Studio, its
 * specimens and previews all show the same brand placeholder without editing any block.
 *
 * Source order: the pinned `assets.image` candidate's `assets.image.placeholder` entry, then the
 * pinned `assets.mark` candidate's `assets.mark.positive` token, then the old-store Designer mark
 * cell. Without any, the caller falls back to Studio's own mark. A pinned candidate whose bytes
 * drifted from its pin is never served.
 */
import { join } from "node:path";
import { readCandidate, readPin } from "../records/slots.js";
import { consumerBrand } from "./designer-globals.js";

/**
 * A placeholder image path a stock block references but does not ship: one file directly under
 * `/avatars/`. Widen it only for paths a rendered specimen actually requests and gets a 404 for.
 */
export const DEFAULT_AVATAR_PATH = /^\/avatars\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}\.(?:jpe?g|png|webp|avif|gif|svg)$/;

const object = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const safeSvg = (value: unknown): string | undefined => {
  const svg = typeof value === "string" ? value.trim() : "";
  return svg.startsWith("<svg") && svg.endsWith("</svg>") && !/<script|\son[a-z]+=|javascript:|<foreignObject/i.test(svg) ? svg : undefined;
};
const SVG_DATA_URI = /^data:image\/svg\+xml;base64,([A-Za-z0-9+/]+={0,2})$/;

/** The pinned candidate's design tokens for `assets.<name>`, or undefined (no pin, drifted bytes, unreadable). */
function pinnedAssetTokens(library: string, name: string): Record<string, unknown> | undefined {
  const slot = `assets.${name}`;
  try {
    const pin = readPin(library, "designer", slot);
    if (!pin) return undefined;
    const candidate = readCandidate(library, "designer", slot, pin.candidate);
    // A drifted candidate is not the pinned one; never serve it.
    if (candidate.sha256 !== pin.sha256) return undefined;
    const item: unknown = JSON.parse(candidate.bytes);
    const files = object(item) && Array.isArray(item.files) ? item.files : [];
    for (const file of files) {
      if (!object(file) || typeof file.content !== "string" || !String(file.path).endsWith(".json")) continue;
      let tokens: unknown;
      try { tokens = JSON.parse(file.content); } catch { continue; }
      const group = object(tokens) && object(tokens.assets) ? tokens.assets[name] : undefined;
      if (object(group)) return group;
    }
  } catch { /* no slot model, or no readable pin: fall through */ }
  return undefined;
}

/** The pinned slot-model mark's positive SVG, if the library pins one. */
export function pinnedMarkSvg(library: string): string | undefined {
  const mark = pinnedAssetTokens(library, "mark");
  return mark && object(mark.positive) ? safeSvg(mark.positive.$value) : undefined;
}

/** The pinned `assets.image` placeholder entry's SVG (an SVG data URI in its rules), if pinned. */
export function pinnedPlaceholderSvg(library: string): string | undefined {
  const image = pinnedAssetTokens(library, "image");
  const entry = image && object(image.placeholder) && object(image.placeholder.$value) ? image.placeholder.$value : undefined;
  const base64 = typeof entry?.src === "string" ? SVG_DATA_URI.exec(entry.src)?.[1] : undefined;
  return base64 ? safeSvg(Buffer.from(base64, "base64").toString("utf8")) : undefined;
}

/** The default placeholder SVG for a workspace root, or undefined when it has neither placeholder nor mark. */
export async function defaultAvatarSvg(root: string, library = join(root, "clossys")): Promise<string | undefined> {
  return pinnedPlaceholderSvg(library) ?? pinnedMarkSvg(library)
    ?? (await consumerBrand(root).catch(() => ({} as Awaited<ReturnType<typeof consumerBrand>>))).mark?.light;
}
