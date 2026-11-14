/** SVG criteria (assets): a viewBox on the scale, light and dark modes, legibility at small sizes, no raster. */
import { num, strings, svgRoot, tags, viewBox } from "./lib.js";
import type { Criterion } from "./types.js";

/** The SVG markup of the subject: the text, or a JSON `svg` field. */
const svgText = (subject: { text: string; json?: unknown }): string => {
  const json = subject.json as { svg?: unknown } | undefined;
  return typeof json?.svg === "string" ? json.svg : subject.text;
};

/** svg.viewbox: the root `<svg>` has a viewBox of four numbers with a positive size, `params.size` square when set. */
export const svgViewbox: Criterion = (subject, params) => {
  const root = svgRoot(svgText(subject));
  if (!root) return ["no <svg> element"];
  const box = viewBox(root);
  if (!box) return ["the root <svg> has no valid viewBox (four numbers)"];
  if (box[2] <= 0 || box[3] <= 0) return [`viewBox size ${box[2]}x${box[3]} is not positive`];
  if (params.size !== undefined) {
    const size = num(params.size, 0);
    if (box[2] !== size || box[3] !== size) return [`viewBox is ${box[2]}x${box[3]}; the standard draws on ${size}x${size}`];
  }
  return [];
};

const PAINT_ATTRS = ["fill", "stroke", "stop-color", "color", "flood-color", "lighting-color"];
const NEUTRAL = /^(?:none|currentcolor|inherit|transparent|context-fill|context-stroke|var\(--[a-z0-9-]+(?:,[^)]*)?\)|url\(#[^)]+\))$/i;
/**
 * svg.modes: the drawing works in light and dark: every paint (attribute or style) is `currentColor`,
 * `none`, a CSS variable, a gradient reference or one of `params.allow`; never a fixed colour.
 */
export const svgModes: Criterion = (subject, params) => {
  const allow = new Set(strings(params.allow).map(item => item.toLowerCase()));
  const failures: string[] = [];
  const check = (value: string, where: string) => {
    const trimmed = value.trim();
    if (!NEUTRAL.test(trimmed) && !allow.has(trimmed.toLowerCase())) failures.push(`${where} paints a fixed colour "${trimmed}"`);
  };
  for (const tag of tags(svgText(subject))) {
    for (const attr of PAINT_ATTRS) { const value = tag.attrs.get(attr); if (value !== undefined) check(value, `<${tag.name} ${attr}>`); }
    const style = tag.attrs.get("style");
    if (style) for (const decl of style.matchAll(/(fill|stroke|stop-color|color)\s*:\s*([^;]+)/gi)) check(decl[2]!, `<${tag.name} style ${decl[1]}>`);
  }
  return failures;
};

/**
 * render.small-size: drawn at `params.size` px (default 16), every stroke stays at least
 * `params.minStrokePx` (default 1) wide and the drawing has at most `params.maxShapes` (default 12)
 * shapes, so it reads at its smallest use.
 */
export const smallSize: Criterion = (subject, params) => {
  const text = svgText(subject);
  const box = viewBox(svgRoot(text));
  if (!box) return ["no viewBox: the small-size scale is undefined"];
  const scale = num(params.size, 16) / box[2];
  const minPx = num(params.minStrokePx, 1);
  const failures: string[] = [];
  const all = tags(text);
  const rootStroke = all.find(tag => tag.name === "svg")?.attrs.get("stroke-width");
  for (const tag of all) {
    const width = tag.attrs.get("stroke-width") ?? (tag.name === "svg" ? undefined : rootStroke);
    if (width === undefined || tag.name === "svg") continue;
    const px = Number.parseFloat(width) * scale;
    if (Number.isFinite(px) && px < minPx) failures.push(`<${tag.name}> stroke is ${px.toFixed(2)}px at ${num(params.size, 16)}px; at least ${minPx}px`);
  }
  const shapes = all.filter(tag => /^(?:path|circle|rect|line|polyline|polygon|ellipse)$/.test(tag.name)).length;
  const max = num(params.maxShapes, 12);
  if (shapes > max) failures.push(`${shapes} shapes; at most ${max} read at small sizes`);
  return failures;
};

/** svg.no-raster: no embedded raster image, data URI or foreign object. */
export const noRaster: Criterion = subject => {
  const text = svgText(subject);
  const failures: string[] = [];
  if (/<image\b/i.test(text)) failures.push("embeds an <image>");
  if (/data:image\//i.test(text)) failures.push("embeds a data:image URI");
  if (/<foreignObject\b/i.test(text)) failures.push("embeds a <foreignObject>");
  return failures;
};
