/** Text, CSS and colour helpers shared by the core criteria. Pure. */
import type { Params } from "./types.js";

export const num = (value: unknown, fallback: number): number => typeof value === "number" && Number.isFinite(value) ? value : fallback;
export const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
export const numbers = (value: unknown): number[] => Array.isArray(value) ? value.filter((item): item is number => typeof item === "number" && Number.isFinite(item)) : [];
export const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);

/** A required numeric param, or the message saying it is missing. */
export function needNumber(params: Params, key: string): number | string {
  const value = params[key];
  return typeof value === "number" && Number.isFinite(value) ? value : `params.${key} must be a number`;
}

/** Words: letter or digit runs, apostrophes and hyphens inside. */
export const words = (text: string): string[] => text.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) ?? [];

/** Sentences: runs ended by . ! ? (or the end), ignoring blank ones and Markdown headings' markers. */
export function sentences(text: string): string[] {
  const plain = text.replace(/^#+\s*/gm, "").replace(/\s+/g, " ").trim();
  if (!plain) return [];
  return (plain.match(/[^.!?]+(?:[.!?]+|$)/g) ?? []).map(item => item.trim()).filter(item => words(item).length > 0);
}

/** Syllables of one English word (vowel-group heuristic, silent final e). */
export function syllables(word: string): number {
  const lower = word.toLowerCase().replace(/[^a-z]/g, "");
  if (!lower) return 0;
  if (lower.length <= 3) return 1;
  const trimmed = lower.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "").replace(/^y/, "");
  return Math.max(1, (trimmed.match(/[aeiouy]{1,2}/g) ?? []).length);
}

/** A literal pattern: `/re/flags` as a regular expression, anything else as a whole-word, case-insensitive phrase. */
export function pattern(source: string): RegExp {
  const regex = /^\/(.+)\/([a-z]*)$/.exec(source);
  if (regex) return new RegExp(regex[1]!, regex[2]!.includes("g") ? regex[2] : `${regex[2]}g`);
  const escaped = source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "giu");
}

/** CSS declarations anywhere in the text (`prop: value`, inside rules or style attributes), lower-cased property. */
export function declarations(text: string): { prop: string; value: string }[] {
  const found: { prop: string; value: string }[] = [];
  for (const match of text.matchAll(/(?<![\w-])(-{0,2}[a-z][a-z0-9-]*)\s*:\s*([^;{}"'\n]+)/gi)) {
    found.push({ prop: match[1]!.toLowerCase(), value: match[2]!.trim() });
  }
  return found;
}

/** A CSS length in px (px, rem and em at 16px; a bare 0), or undefined for anything else. */
export function lengthPx(token: string): number | undefined {
  const match = /^(-?\d*\.?\d+)(px|rem|em)?$/.exec(token.trim());
  if (!match) return undefined;
  const value = Number(match[1]);
  if (!match[2]) return value === 0 ? 0 : undefined;
  return match[2] === "px" ? value : value * 16;
}

/** Every length token (px, rem, em) in a declaration value, in px. */
export const lengthsIn = (value: string): number[] => (value.match(/-?\d*\.?\d+(?:px|rem|em)\b/g) ?? []).map(token => lengthPx(token)!).filter(item => item !== undefined);

const SPACING = /^(?:margin|padding|gap|row-gap|column-gap|inset|top|right|bottom|left)(?:-[a-z-]+)?$/;
const TW_SPACING = /(?<![\w-])-?(?:p|px|py|pt|pr|pb|pl|ps|pe|m|mx|my|mt|mr|mb|ml|ms|me|gap|gap-x|gap-y|space-x|space-y|inset|top|right|bottom|left)-\[(-?\d*\.?\d+(?:px|rem|em))\]/g;

/** Spacing lengths in px: CSS spacing declarations and Tailwind arbitrary spacing values. */
export function spacingLengths(text: string): { value: number; at: string }[] {
  const found: { value: number; at: string }[] = [];
  for (const decl of declarations(text)) if (SPACING.test(decl.prop)) for (const value of lengthsIn(decl.value)) found.push({ value: Math.abs(value), at: `${decl.prop}: ${decl.value}` });
  for (const match of text.matchAll(TW_SPACING)) found.push({ value: Math.abs(lengthPx(match[1]!)!), at: match[0] });
  return found;
}

/** Font sizes in px: `font-size` declarations, `font:` shorthands and Tailwind `text-[<len>]`. */
export function fontSizes(text: string): { value: number; at: string }[] {
  const found: { value: number; at: string }[] = [];
  for (const decl of declarations(text)) {
    if (decl.prop === "font-size") for (const value of lengthsIn(decl.value)) found.push({ value, at: `${decl.prop}: ${decl.value}` });
    if (decl.prop === "font") { const first = lengthsIn(decl.value)[0]; if (first !== undefined) found.push({ value: first, at: `${decl.prop}: ${decl.value}` }); }
  }
  for (const match of text.matchAll(/(?<![\w-])text-\[(\d*\.?\d+(?:px|rem|em))\]/g)) found.push({ value: lengthPx(match[1]!)!, at: match[0] });
  return found;
}

/** Named Tailwind type sizes (`text-sm`, `text-2xl`) used in the text. */
export const namedTypeSizes = (text: string): string[] => [...text.matchAll(/(?<![\w-])text-(xs|sm|base|lg|xl|[2-9]xl)(?![\w-])/g)].map(match => match[0]);

/** Font weights: `font-weight` values and Tailwind weight utilities. */
export function fontWeights(text: string): string[] {
  const found = declarations(text).filter(decl => decl.prop === "font-weight").map(decl => decl.value.trim());
  for (const match of text.matchAll(/(?<![\w-])font-(thin|extralight|light|normal|medium|semibold|bold|extrabold|black)(?![\w-])/g)) found.push(match[1]!);
  return found;
}

const RAW_COLOR = /#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})(?![0-9a-z])|\b(?:rgba?|hsla?|oklch|oklab|lab|lch|hwb)\([^)]*\)/gi;
/** Raw colour literals (hex and colour functions). */
export const rawColors = (text: string): string[] => text.match(RAW_COLOR) ?? [];

/** The text with every custom-property declaration (`--name: value`) removed: a token definition is not a raw use. */
export const withoutCustomProperties = (text: string): string => text.replace(/(?<![\w-])--[a-z0-9-]+\s*:\s*[^;{}\n]+;?/gi, "");

/** sRGB channels 0-255 of a hex or rgb() colour, or undefined. */
export function rgb(color: string): [number, number, number] | undefined {
  const value = color.trim().toLowerCase();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(value);
  if (hex) {
    const digits = hex[1]!.length === 3 ? [...hex[1]!].map(digit => digit + digit).join("") : hex[1]!;
    return [0, 2, 4].map(at => parseInt(digits.slice(at, at + 2), 16)) as [number, number, number];
  }
  const fn = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/.exec(value);
  return fn ? [Number(fn[1]), Number(fn[2]), Number(fn[3])] : undefined;
}

/** WCAG 2 contrast ratio of two sRGB colours. */
export function contrast(a: [number, number, number], b: [number, number, number]): number {
  const lum = (channels: [number, number, number]) => {
    const [r, g, bl] = channels.map(channel => { const c = channel / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }) as [number, number, number];
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** Every string leaf of a JSON value with its dotted path. */
export function stringLeaves(value: unknown, at = ""): { path: string; value: string }[] {
  if (typeof value === "string") return [{ path: at, value }];
  if (Array.isArray(value)) return value.flatMap((item, index) => stringLeaves(item, `${at}[${index}]`));
  if (isRecord(value)) return Object.entries(value).flatMap(([key, item]) => stringLeaves(item, at ? `${at}.${key}` : key));
  return [];
}

/** The opening tags of the markup in the text (`<name attrs>`), with their attributes. */
export function tags(text: string): { name: string; attrs: Map<string, string>; source: string }[] {
  const found: { name: string; attrs: Map<string, string>; source: string }[] = [];
  for (const match of text.matchAll(/<([A-Za-z][\w.:-]*)((?:\s+[^\s=>/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|\{[^}]*\}|[^\s>]+))?)*)\s*\/?>/g)) {
    const attrs = new Map<string, string>();
    for (const attr of match[2]!.matchAll(/([^\s=>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|\{([^}]*)\}|([^\s>]+)))?/g)) {
      attrs.set(attr[1]!, attr[2] ?? attr[3] ?? attr[4] ?? attr[5] ?? "");
    }
    found.push({ name: match[1]!, attrs, source: match[0] });
  }
  return found;
}

/** The first `<svg>` tag of the text, or undefined. */
export const svgRoot = (text: string) => tags(text).find(tag => tag.name === "svg");

/** viewBox numbers of an svg tag ([minX, minY, width, height]) or undefined. */
export function viewBox(tag: { attrs: Map<string, string> } | undefined): [number, number, number, number] | undefined {
  const value = tag?.attrs.get("viewBox");
  if (!value) return undefined;
  const parts = value.trim().split(/[\s,]+/).map(Number);
  return parts.length === 4 && parts.every(Number.isFinite) ? parts as [number, number, number, number] : undefined;
}

/** Shortens a quoted excerpt for a message. */
export const excerpt = (text: string, max = 60): string => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};
