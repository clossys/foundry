/**
 * The consumer brand, resolved from the consumer's own pinned `assets.*` Designer slots.
 *
 * The workspace mark, favicon, app icon, lockup and image each come from the pinned candidate of
 * `assets.mark`, `assets.favicon`, `assets.app-icon`, `assets.lockup` and `assets.image`; an
 * `{{assets.<name>.<variant>}}` alias resolves inside the same pins. The workspace name is the
 * mark's (or lockup's) accessible name. Nothing falls back to Foundry's own mark: a consumer that
 * pins no brand asset has none, and the routes answer 404. A candidate whose bytes drifted from
 * its pin is never served.
 */
import { readCandidate, readSlotEntry } from "../records/slots.js";

const object = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
export const safeSvg = (value: unknown): string | undefined => {
  const svg = typeof value === "string" ? value.trim() : "";
  return svg.startsWith("<svg") && svg.endsWith("</svg>") && !/<script|\son[a-z]+=|javascript:|<foreignObject/i.test(svg) ? svg : undefined;
};
const SVG_DATA_URI = /^data:image\/svg\+xml;base64,([A-Za-z0-9+/]+={0,2})$/;
const ALIAS = /^\{\{assets\.([a-z0-9-]+)\.([a-z0-9-]+)\}\}$/;

/**
 * The pinned candidate's design tokens for `assets.<name>`, or undefined when the consumer has no
 * such slot, no valid pin, drifted bytes, or no token group for it. A pinned candidate that cannot
 * be read, or a token file in it that is not JSON, surfaces as an error.
 */
export function pinnedAssetTokens(library: string, name: string): Record<string, unknown> | undefined {
  const slot = `assets.${name}`;
  const pin = readSlotEntry(library, "designer", slot)?.pin;
  if (!pin) return undefined;
  const candidate = readCandidate(library, "designer", slot, pin.candidate);
  // A drifted candidate is not the pinned one; never serve it.
  if (candidate.sha256 !== pin.sha256) return undefined;
  const item: unknown = JSON.parse(candidate.bytes);
  const files = object(item) && Array.isArray(item.files) ? item.files : [];
  for (const file of files) {
    if (!object(file) || typeof file.content !== "string" || !String(file.path).endsWith(".json")) continue;
    let tokens: unknown;
    try { tokens = JSON.parse(file.content); }
    catch (error) { throw new Error(`designer/${slot}/${pin.candidate}: ${String(file.path)} is not JSON (${error instanceof Error ? error.message : String(error)})`); }
    const group = object(tokens) && object(tokens.assets) ? tokens.assets[name] : undefined;
    if (object(group)) return group;
  }
  return undefined;
}

/** One pinned asset variant's SVG, following `{{assets.<name>.<variant>}}` aliases inside the consumer's pins. */
export function pinnedAssetSvg(library: string, name: string, variant: string, seen = new Set<string>()): string | undefined {
  const key = `${name}.${variant}`;
  if (seen.has(key)) return undefined;
  seen.add(key);
  const token = pinnedAssetTokens(library, name)?.[variant];
  const value = object(token) ? token.$value : undefined;
  const alias = typeof value === "string" ? ALIAS.exec(value.trim()) : null;
  return alias ? pinnedAssetSvg(library, alias[1]!, alias[2]!, seen) : safeSvg(value);
}

/** The pinned `assets.image` rule's SVG (an SVG data URI in its rules), if pinned. */
export function pinnedImageSvg(library: string, variant: "default" | "placeholder"): string | undefined {
  const image = pinnedAssetTokens(library, "image");
  const entry = image && object(image[variant]) && object((image[variant] as Record<string, unknown>).$value) ? (image[variant] as { $value: Record<string, unknown> }).$value : undefined;
  const base64 = typeof entry?.src === "string" ? SVG_DATA_URI.exec(entry.src)?.[1] : undefined;
  return base64 ? safeSvg(Buffer.from(base64, "base64").toString("utf8")) : undefined;
}

export interface Grounded { light: string; dark: string }
export interface ConsumerBrand {
  name?: string;
  mark?: Grounded;
  favicon?: string;
  appIcon?: string;
  lockup?: Grounded;
  image?: { default?: string; placeholder?: string };
}

const first = (library: string, name: string, ...variants: string[]) => {
  for (const variant of variants) { const svg = pinnedAssetSvg(library, name, variant); if (svg) return svg; }
  return undefined;
};

/** The consumer brand from its pinned assets.* slots: positive variants on light grounds, reversed on dark. */
export function pinnedBrand(library: string): ConsumerBrand {
  const markLight = first(library, "mark", "positive", "mono");
  const lockupLight = first(library, "lockup", "positive");
  const favicon = first(library, "favicon", "vector", "raster");
  const appIcon = first(library, "app-icon", "maskable", "standard");
  const image = { default: pinnedImageSvg(library, "default"), placeholder: pinnedImageSvg(library, "placeholder") };
  const name = /\baria-label="([^"<>]{1,80})"/.exec(markLight ?? lockupLight ?? "")?.[1];
  return {
    ...(name ? { name } : {}),
    ...(markLight ? { mark: { light: markLight, dark: first(library, "mark", "reversed") ?? markLight } } : {}),
    ...(favicon ? { favicon } : {}),
    ...(appIcon ? { appIcon } : {}),
    ...(lockupLight ? { lockup: { light: lockupLight, dark: first(library, "lockup", "reversed") ?? lockupLight } } : {}),
    ...(image.default || image.placeholder ? { image } : {}),
  };
}
