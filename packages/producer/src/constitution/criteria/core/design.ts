/**
 * Design criteria (section 5b, visual rows): spacing and type on the pinned scale, a bounded number
 * of type levels, the reading measure, colour contrast, grid alignment, tokens only and restraint.
 * Each reads the subject's CSS, markup or JSON; the scale and limits come from the slot's params.
 */
import {
  contrast, declarations, excerpt, fontSizes, fontWeights, isRecord, namedTypeSizes, num, numbers, rawColors,
  rgb, spacingLengths, strings, stringLeaves, tags, withoutCustomProperties,
} from "./lib.js";
import type { Criterion, Params } from "./types.js";

const onScale = (value: number, scale: readonly number[]) => scale.some(step => Math.abs(step - value) < 0.01);

/** space.on-scale: every spacing length (CSS spacing declarations and Tailwind arbitrary spacing) is on `params.scale` (px). */
export const spaceOnScale: Criterion = (subject, params) => {
  const scale = numbers(params.scale);
  if (!scale.length) return ["params.scale must list the spacing steps in px"];
  return spacingLengths(subject.text).filter(item => item.value !== 0 && !onScale(item.value, scale)).map(item => `spacing ${item.value}px is off the scale: ${excerpt(item.at)}`);
};

/** type.on-scale: every font size (px, rem, em, Tailwind arbitrary) is on `params.scale` (px). */
export const typeOnScale: Criterion = (subject, params) => {
  const scale = numbers(params.scale);
  if (!scale.length) return ["params.scale must list the type steps in px"];
  return fontSizes(subject.text).filter(item => !onScale(item.value, scale)).map(item => `font size ${item.value}px is off the scale: ${excerpt(item.at)}`);
};

/** type.levels: at most `params.max` (default 6) distinct type sizes, explicit or named. */
export const typeLevels: Criterion = (subject, params) => {
  const levels = new Set<string>([...fontSizes(subject.text).map(item => `${item.value}px`), ...namedTypeSizes(subject.text)]);
  const max = num(params.max, 6);
  return levels.size > max ? [`${levels.size} type levels (${[...levels].join(", ")}); at most ${max}`] : [];
};

/**
 * type.measure: every `max-width` / `max-inline-size` in `ch` sits within [min, max] (default 45-75),
 * and with `params.required: true` at least one measure is set.
 */
export const typeMeasure: Criterion = (subject, params) => {
  const min = num(params.min, 45), max = num(params.max, 75);
  const measures: { value: number; at: string }[] = [];
  for (const decl of declarations(subject.text)) {
    if (decl.prop !== "max-width" && decl.prop !== "max-inline-size") continue;
    for (const match of decl.value.matchAll(/(\d*\.?\d+)ch\b/g)) measures.push({ value: Number(match[1]), at: `${decl.prop}: ${decl.value}` });
  }
  for (const match of subject.text.matchAll(/(?<![\w-])max-w-\[(\d*\.?\d+)ch\]/g)) measures.push({ value: Number(match[1]), at: match[0] });
  const failures = measures.filter(item => item.value < min || item.value > max).map(item => `measure ${item.value}ch is outside ${min}-${max}ch: ${excerpt(item.at)}`);
  if (params.required === true && !measures.length) failures.push(`no reading measure set (${min}-${max}ch)`);
  return failures;
};

/** A colour named by a pair: a literal colour, or a dotted path into the subject's JSON (flattened). */
function resolveColor(name: string, json: unknown): string | undefined {
  if (rgb(name)) return name;
  const leaf = stringLeaves(json).find(item => item.path === name || item.path.endsWith(`.${name}`));
  return leaf && rgb(leaf.value) ? leaf.value : undefined;
}

/**
 * color.contrast: every pair of `params.pairs` (`{fg, bg, size}`; size text, large or ui) meets
 * WCAG 2.2 AA: 4.5:1 for text, 3:1 for large text and UI. Names resolve in the subject's JSON.
 */
export const colorContrast: Criterion = (subject, params) => {
  const pairs = Array.isArray(params.pairs) ? params.pairs.filter(isRecord) : [];
  if (!pairs.length) return ["params.pairs must list the foreground/background pairs"];
  const failures: string[] = [];
  for (const pair of pairs) {
    const fg = typeof pair.fg === "string" ? resolveColor(pair.fg, subject.json) : undefined;
    const bg = typeof pair.bg === "string" ? resolveColor(pair.bg, subject.json) : undefined;
    if (!fg || !bg) { failures.push(`pair ${String(pair.fg)} on ${String(pair.bg)} does not resolve to two colours`); continue; }
    const ratio = contrast(rgb(fg)!, rgb(bg)!);
    const need = pair.size === "large" || pair.size === "ui" ? 3 : 4.5;
    if (ratio + 1e-9 < need) failures.push(`${String(pair.fg)} on ${String(pair.bg)} is ${ratio.toFixed(2)}:1; needs ${need}:1`);
  }
  return failures;
};

/** Geometry the grid judges: SVG coordinates and sizes, and JSON boxes (x, y, width, height). */
function coordinates(subject: { text: string; json?: unknown }): { value: number; at: string }[] {
  const found: { value: number; at: string }[] = [];
  for (const tag of tags(subject.text)) {
    for (const attr of ["x", "y", "width", "height", "x1", "y1", "x2", "y2"]) {
      const raw = tag.attrs.get(attr);
      if (raw !== undefined && /^-?\d*\.?\d+$/.test(raw)) found.push({ value: Number(raw), at: `<${tag.name} ${attr}=${raw}>` });
    }
  }
  const walk = (value: unknown, at: string) => {
    if (Array.isArray(value)) value.forEach((item, index) => walk(item, `${at}[${index}]`));
    else if (isRecord(value)) for (const [key, item] of Object.entries(value)) {
      if (["x", "y", "width", "height", "w", "h"].includes(key) && typeof item === "number") found.push({ value: item, at: at ? `${at}.${key}` : key });
      else walk(item, at ? `${at}.${key}` : key);
    }
  };
  walk(subject.json, "");
  return found;
}

/** grid.aligned: every coordinate and size sits on the `params.unit` grid (default 4). */
export const gridAligned: Criterion = (subject, params) => {
  const unit = num(params.unit, 4);
  if (unit <= 0) return ["params.unit must be positive"];
  return coordinates(subject).filter(item => Math.abs(item.value / unit - Math.round(item.value / unit)) > 1e-6).map(item => `${item.at} is off the ${unit}px grid`);
};

/**
 * tokens.only: no raw colour literal and no raw px length outside token definitions; custom-property
 * definitions count only with `params.definitions: true`. `params.allow` lists permitted literals.
 */
export const tokensOnly: Criterion = (subject, params: Params) => {
  const allow = new Set(strings(params.allow).map(item => item.toLowerCase()));
  const text = params.definitions === true ? subject.text : withoutCustomProperties(subject.text);
  const raw = [...rawColors(text), ...(text.match(/(?<![\w.-])\d*\.?\d+px\b/g) ?? []).filter(item => !/^0+(?:\.0+)?px$/.test(item))];
  return [...new Set(raw.filter(item => !allow.has(item.toLowerCase())))].map(item => `raw value ${item}; use a token`);
};

/** restraint.counts: at most `params.colors` raw colours, `params.sizes` type sizes and `params.weights` weights (each optional). */
export const restraintCounts: Criterion = (subject, params) => {
  const failures: string[] = [];
  const limit = (key: string, found: Set<string>, label: string) => {
    if (params[key] === undefined) return;
    const max = num(params[key], Number.POSITIVE_INFINITY);
    if (found.size > max) failures.push(`${found.size} ${label} (${[...found].join(", ")}); at most ${max}`);
  };
  limit("colors", new Set(rawColors(subject.text).map(item => item.toLowerCase())), "colours");
  limit("sizes", new Set([...fontSizes(subject.text).map(item => `${item.value}px`), ...namedTypeSizes(subject.text)]), "type sizes");
  limit("weights", new Set(fontWeights(subject.text)), "weights");
  if (!["colors", "sizes", "weights"].some(key => params[key] !== undefined)) failures.push("params must set at least one of colors, sizes, weights");
  return failures;
};
