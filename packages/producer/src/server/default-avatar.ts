/**
 * The default user avatar: the consumer's pinned `assets.mark`.
 *
 * Stock shadcn blocks carry sample users whose avatar is a site-root placeholder such as
 * `/avatars/shadcn.jpg`. Those files are not shipped, and the blocks are adopted verbatim, so
 * Producer answers every `/avatars/<file>` request with the one brand mark instead: Studio, its
 * specimens and previews all show the same default avatar without editing any block.
 *
 * Source order: the pinned `assets.mark` slot candidate (its `assets.mark.positive` token), then
 * the old-store Designer mark cell. Without either, the caller falls back to Studio's own mark.
 */
import { join } from "node:path";
import { readCandidate, readPin } from "../records/slots.js";
import { consumerBrand } from "./designer-globals.js";

/** A placeholder avatar path a stock block can reference: one file directly under `/avatars/`. */
export const DEFAULT_AVATAR_PATH = /^\/avatars\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}\.(?:jpe?g|png|webp|avif|gif|svg)$/;

const object = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const safeSvg = (value: unknown): string | undefined => {
  const svg = typeof value === "string" ? value.trim() : "";
  return svg.startsWith("<svg") && svg.endsWith("</svg>") && !/<script|\son[a-z]+=|javascript:|<foreignObject/i.test(svg) ? svg : undefined;
};

/** The pinned slot-model mark's positive SVG, if the library pins one. */
export function pinnedMarkSvg(library: string): string | undefined {
  try {
    const pin = readPin(library, "designer", "assets.mark");
    if (!pin) return undefined;
    const candidate = readCandidate(library, "designer", "assets.mark", pin.candidate);
    // A drifted candidate is not the pinned one; never serve it.
    if (candidate.sha256 !== pin.sha256) return undefined;
    const item: unknown = JSON.parse(candidate.bytes);
    const files = object(item) && Array.isArray(item.files) ? item.files : [];
    for (const file of files) {
      if (!object(file) || typeof file.content !== "string" || !String(file.path).endsWith(".json")) continue;
      let tokens: unknown;
      try { tokens = JSON.parse(file.content); } catch { continue; }
      const mark = object(tokens) && object(tokens.assets) && object(tokens.assets.mark) ? tokens.assets.mark : undefined;
      const positive = mark && object(mark.positive) ? safeSvg(mark.positive.$value) : undefined;
      if (positive) return positive;
    }
  } catch { /* no slot model, or no readable pin: fall through */ }
  return undefined;
}

/** The default avatar SVG for a workspace root, or undefined when it has no mark. */
export async function defaultAvatarSvg(root: string, library = join(root, "clossys")): Promise<string | undefined> {
  return pinnedMarkSvg(library) ?? (await consumerBrand(root).catch(() => ({} as Awaited<ReturnType<typeof consumerBrand>>))).mark?.light;
}
