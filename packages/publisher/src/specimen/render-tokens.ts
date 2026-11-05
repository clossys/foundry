/**
 * Token (data) and asset (media) specimens: the record's own values drawn the way a reader checks
 * them, with no bundle to build.
 *
 * - data: a shadcn `registry:theme` item's `cssVars` (colour swatches, radius ramp, spacing ladder,
 *   shadow ramp, tracking and motion samples) or a `registry:font` item's type ladder;
 * - media: an asset item's DTCG members (`$type` svg, glyph or rules) as the asset itself: marks,
 *   lockups, icons, image and video posters, ratio boxes and pattern tiles.
 *
 * Every value becomes CSS or markup only after the same checks a theme's `cssVars` pass (no
 * declaration, block or markup breakouts), and every string is escaped. A record with nothing that
 * can be drawn returns a problem instead, so the page reports a failure and its host shows the
 * "Preview unavailable" state rather than a blank or a raw note.
 */
import type { SpecimenProblem } from "./render.js";
import type { SpecimenRecord } from "./types.js";
import type { SpecimenMode } from "./theme.js";

export interface RenderedSpecimen { readonly html: string; readonly problems: readonly SpecimenProblem[] }

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
const isRecord = (value: unknown): value is Record<string, any> => typeof value === "object" && value !== null && !Array.isArray(value);
const VAR_NAME = /^[a-z][a-z0-9-]*$/;
/** A value that may be written into CSS: no declaration, block, markup or escape breakouts. */
const cssValue = (value: unknown): string | undefined => typeof value === "string" && value.trim() && !/[;{}<>\\]/.test(value) ? value.trim() : undefined;
const label = (name: string) => name.replace(/-/g, " ").replace(/^./, c => c.toUpperCase());

function parse(raw: string): unknown {
  try { return JSON.parse(raw); } catch { return undefined; }
}

function unavailable(record: SpecimenRecord, message: string): RenderedSpecimen {
  return { html: `<div class="specimen-unavailable" data-specimen-unavailable="${record.kind}"></div>`, problems: [{ source: "render", message: `${record.id}: ${message}` }] };
}

function cssVars(value: unknown): Record<string, string> {
  const vars: Record<string, string> = {};
  if (!isRecord(value)) return vars;
  for (const [name, raw] of Object.entries(value)) {
    const key = name.replace(/^--/, ""), css = cssValue(raw);
    if (VAR_NAME.test(key) && css) vars[key] = css;
  }
  return vars;
}

/**
 * The Writer keys the token specimens set their samples in (the consumer's strings.common
 * `studio.specimen-sample.*`). The record source supplies their pinned text in `preview.copy`; a key
 * it does not supply shows a visible marker and reports a problem, never an English literal.
 */
export const SPECIMEN_SAMPLE_COPY_KEYS = {
  glyph: "studio.specimen-sample.glyph",
  pangram: "studio.specimen-sample.pangram",
  pangramAlt: "studio.specimen-sample.pangram-alt",
  characters: "studio.specimen-sample.characters",
  motion: "studio.specimen-sample.motion",
} as const;

function sampleCopy(record: SpecimenRecord, key: string, problems: SpecimenProblem[]): string {
  const text = record.preview.copy?.[key]?.text;
  if (typeof text === "string") return text;
  if (!problems.some(problem => problem.message.endsWith(` ${key}`))) problems.push({ source: "render", message: `${record.id}: no pinned Writer copy for ${key}` });
  return `[missing copy ${key}]`;
}

const tile = (kind: string, name: string, body: string, value?: string) =>
  `<figure class="specimen-token" data-token="${escapeHtml(kind)}"><div class="specimen-token-sample">${body}</div><figcaption><span class="specimen-token-name">${escapeHtml(label(name))}</span>${value ? `<code class="specimen-token-value">${escapeHtml(value)}</code>` : ""}</figcaption></figure>`;

/** `@keyframes` blocks from a theme item's `css`, kept only when every part is a plain name or value. */
function keyframes(css: unknown): Map<string, string> {
  const found = new Map<string, string>();
  if (!isRecord(css)) return found;
  for (const [at, frames] of Object.entries(css)) {
    const name = /^@keyframes ([a-z][a-z0-9-]*)$/.exec(at)?.[1];
    if (!name || !isRecord(frames)) continue;
    const steps: string[] = [];
    let ok = true;
    for (const [step, decls] of Object.entries(frames)) {
      if (!/^(?:from|to|\d{1,3}(?:\.\d+)?%)(?:\s*,\s*(?:from|to|\d{1,3}(?:\.\d+)?%))*$/.test(step) || !isRecord(decls)) { ok = false; break; }
      const body = Object.entries(decls).map(([prop, value]) => /^[a-z-]+$/.test(prop) && cssValue(value) ? `${prop}:${cssValue(value)}` : undefined);
      if (body.some(part => part === undefined)) { ok = false; break; }
      steps.push(`${step}{${body.join(";")}}`);
    }
    if (ok && steps.length) found.set(name, `@keyframes ${name}{${steps.join("")}}`);
  }
  return found;
}

const isColor = (value: string) => /^(?:#[0-9a-f]{3,8}|(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color|color-mix|light-dark)\(|var\(--|[a-z]+$)/i.test(value);

function themeTokens(record: SpecimenRecord, item: Record<string, any>, mode: SpecimenMode): RenderedSpecimen {
  const vars = isRecord(item.cssVars) ? item.cssVars : {};
  const light = cssVars(vars.light), dark = cssVars(vars.dark);
  const values = { ...cssVars(vars.theme), ...light, ...(mode === "dark" ? dark : {}) };
  const frames = keyframes(item.css);
  const tiles: string[] = [], styles: string[] = [], problems: SpecimenProblem[] = [];
  const shadows = Object.entries(values).filter(([name]) => /^shadow(?:-|$)/.test(name));
  if (shadows.length) {
    for (const [name, value] of shadows) tiles.push(tile("shadow", name, `<div class="specimen-shadow" style="box-shadow:${escapeHtml(value)}"></div>`, value));
  }
  for (const [name, value] of Object.entries(values)) {
    if (/^shadow(?:-|$)/.test(name)) continue;
    if (/^radius(?:-|$)/.test(name)) {
      const ramp = [["sm", "- 4px"], ["md", "- 2px"], ["lg", ""], ["xl", "+ 4px"]] as const;
      const boxes = ramp.map(([step, delta]) => `<div class="specimen-radius-step"><div class="specimen-radius" style="border-radius:${escapeHtml(delta ? `calc(${value} ${delta})` : value)}"></div><span>${step}</span></div>`).join("");
      tiles.push(tile("radius", name, `<div class="specimen-radius-ramp">${boxes}</div>`, value));
    } else if (/^spacing(?:-|$)/.test(name)) {
      const steps = [1, 2, 3, 4, 6, 8, 12, 16].map(step => `<div class="specimen-space-step"><span>${step}</span><div class="specimen-space" style="width:calc(${escapeHtml(value)} * ${step})"></div></div>`).join("");
      tiles.push(tile("spacing", name, `<div class="specimen-space-ladder">${steps}</div>`, value));
    } else if (/^tracking(?:-|$)/.test(name)) {
      tiles.push(tile("tracking", name, `<p class="specimen-type-sample" style="letter-spacing:${escapeHtml(value)}">${escapeHtml(sampleCopy(record, SPECIMEN_SAMPLE_COPY_KEYS.pangram, problems))}</p>`, value));
    } else if (/^animate-/.test(name)) {
      const keyframe = /^([a-z][a-z0-9-]*)\s/.exec(value)?.[1];
      const block = keyframe ? frames.get(keyframe) : undefined;
      if (!block) continue;
      styles.push(block);
      const sample = /background-position/.test(block)
        ? `<p class="specimen-motion-shine" style="animation:${escapeHtml(value)}">${escapeHtml(sampleCopy(record, SPECIMEN_SAMPLE_COPY_KEYS.motion, problems))}</p>`
        : `<div class="specimen-motion-track"><div class="specimen-motion-row" style="animation:${escapeHtml(value)}">${[1, 2, 3, 4, 5, 6].map(n => `<span class="specimen-motion-chip">${n}</span>`).join("")}</div></div>`;
      tiles.push(tile("motion", name, sample, value));
    } else if (isColor(value)) {
      const other = mode === "dark" ? light[name] : dark[name];
      const caption = other && other !== value ? `${value} · ${mode === "dark" ? "light" : "dark"} ${other}` : value;
      tiles.push(tile("color", name, `<div class="specimen-swatch" style="background:${escapeHtml(value)}"></div>`, caption));
    } else {
      tiles.push(tile("value", name, `<code class="specimen-token-raw">${escapeHtml(value)}</code>`));
    }
  }
  if (!tiles.length) return unavailable(record, "the theme item has no token values to draw");
  return { html: `${styles.length ? `<style>${styles.join("")}</style>` : ""}<section class="specimen-tokens" data-specimen-tokens="theme">${tiles.join("")}</section>`, problems };
}

function fontTokens(record: SpecimenRecord, item: Record<string, any>): RenderedSpecimen {
  const font = isRecord(item.font) ? item.font : {};
  const family = cssValue(font.family);
  if (!family) return unavailable(record, "the font item names no family");
  const variable = typeof font.variable === "string" && /^--[a-z][a-z0-9-]*$/.test(font.variable) ? font.variable : undefined;
  const style = `font-family:${escapeHtml(family)}`;
  const problems: SpecimenProblem[] = [];
  const keys = SPECIMEN_SAMPLE_COPY_KEYS;
  const ladder = ([["3rem", keys.glyph], ["1.5rem", keys.pangramAlt], ["1rem", keys.pangram], ["0.75rem", keys.characters]] as const)
    .map(([size, key]) => `<p class="specimen-type-sample" style="${style};font-size:${size}">${escapeHtml(sampleCopy(record, key, problems))}</p>`).join("");
  return { html: `<section class="specimen-tokens specimen-tokens-wide" data-specimen-tokens="font">${tile("font", item.name ?? record.id, `<div class="specimen-type-ladder">${ladder}</div>`, `${variable ? `${variable}: ` : ""}${family}`)}</section>`, problems };
}

export function renderDataSpecimen(record: SpecimenRecord, mode: SpecimenMode): RenderedSpecimen {
  const item = parse(record.payload.raw);
  if (!isRecord(item)) return unavailable(record, "the payload is not a registry item");
  if (item.type === "registry:font" || isRecord(item.font)) return fontTokens(record, item);
  if (isRecord(item.cssVars)) return themeTokens(record, item, mode);
  return unavailable(record, `no data renderer for ${String(item.type ?? "this payload")}`);
}

/* Media: asset items. */

const SVG_TAGS = new Set(["path", "circle", "rect", "line", "polyline", "polygon", "ellipse"]);
const SVG_ATTRS = new Set(["d", "cx", "cy", "r", "rx", "ry", "x", "y", "x1", "x2", "y1", "y2", "width", "height", "points"]);
const DATA_IMAGE = /^data:image\/(?:svg\+xml|png|jpeg|webp|gif|avif);base64,[A-Za-z0-9+/=]+$/;

const svgUri = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
const image = (src: string, alt: string, ratio?: string) => `<img class="specimen-asset-image" src="${escapeHtml(src)}" alt="${escapeHtml(alt)}"${ratio ? ` style="aspect-ratio:${ratio}"` : ""}>`;

/** A glyph (`[tag, attrs][]`, lucide's node list) as inline SVG drawn in the text colour. */
function glyph(nodes: unknown): string | undefined {
  if (!Array.isArray(nodes) || !nodes.length) return undefined;
  const parts: string[] = [];
  for (const node of nodes) {
    if (!Array.isArray(node) || typeof node[0] !== "string" || !SVG_TAGS.has(node[0]) || !isRecord(node[1])) return undefined;
    const attrs = Object.entries(node[1]).filter(([name, value]) => SVG_ATTRS.has(name) && (typeof value === "string" || typeof value === "number"))
      .map(([name, value]) => `${name}="${escapeHtml(String(value))}"`);
    parts.push(`<${node[0]} ${attrs.join(" ")}/>`);
  }
  return `<svg class="specimen-asset-glyph" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${parts.join("")}</svg>`;
}

const ratioOf = (rules: Record<string, any>) => typeof rules.width === "number" && typeof rules.height === "number" && rules.width > 0 && rules.height > 0 ? `${rules.width} / ${rules.height}` : undefined;

const PATTERNS: Record<string, string> = {
  dots: "radial-gradient(circle, var(--specimen-ink) 1.5px, transparent 1.6px) 0 0 / var(--specimen-tile) var(--specimen-tile)",
  grid: "linear-gradient(var(--specimen-ink) 1px, transparent 1px) 0 0 / var(--specimen-tile) var(--specimen-tile), linear-gradient(90deg, var(--specimen-ink) 1px, transparent 1px) 0 0 / var(--specimen-tile) var(--specimen-tile)",
  lines: "repeating-linear-gradient(45deg, var(--specimen-ink) 0 1px, transparent 1px calc(var(--specimen-tile) / 2))",
  grain: "radial-gradient(circle, var(--specimen-ink) 0.6px, transparent 0.8px) 0 0 / 5px 5px, radial-gradient(circle, var(--specimen-ink) 0.6px, transparent 0.8px) 2px 3px / 7px 7px",
  noise: "radial-gradient(circle, var(--specimen-ink) 0.7px, transparent 0.9px) 1px 1px / 4px 6px, radial-gradient(circle, var(--specimen-ink) 0.7px, transparent 0.9px) 3px 2px / 6px 5px",
  topo: "repeating-radial-gradient(circle at 30% 40%, transparent 0 calc(var(--specimen-tile) / 2 - 1px), var(--specimen-ink) calc(var(--specimen-tile) / 2 - 1px) calc(var(--specimen-tile) / 2))",
};

function pattern(rules: Record<string, any>): string | undefined {
  const shape = typeof rules.shape === "string" ? PATTERNS[rules.shape] : undefined;
  if (!shape) return undefined;
  const ref = (value: unknown, fallback: string) => typeof value === "string" && /^--[a-z][a-z0-9-]*$/.test(value) ? `var(${value}, ${fallback})` : fallback;
  return `<div class="specimen-asset-pattern" style="--specimen-ink:${ref(rules.ink, "var(--border)")};--specimen-tile:${ref(rules.tile, "24px")};background:${shape}"></div>`;
}

/** One DTCG member drawn as the asset, or undefined when it cannot be drawn. */
function member(name: string, token: Record<string, any>, svgFiles: readonly { path: string; content: string }[]): string | undefined {
  const value = token.$value;
  if (token.$type === "svg" && typeof value === "string") {
    if (value.trim().startsWith("<svg")) return image(svgUri(value), name);
    // An alias (`{{assets.mark.positive}}`): the item ships the resolved file beside its tokens.
    const file = svgFiles.find(row => row.path.replace(/^.*\//, "").replace(/\.svg$/, "") === name) ?? (svgFiles.length === 1 ? svgFiles[0] : undefined);
    return file ? image(svgUri(file.content), name) : undefined;
  }
  if (token.$type === "glyph") return glyph(value);
  if (token.$type === "rules" && isRecord(value)) {
    const ratio = ratioOf(value);
    if (typeof value.src === "string" && DATA_IMAGE.test(value.src)) return image(value.src, name, ratio);
    if (typeof value.poster === "string" && DATA_IMAGE.test(value.poster)) return image(value.poster, `${name} poster`, ratio);
    if (typeof value.shape === "string") return pattern(value);
    if (ratio) return `<div class="specimen-asset-ratio" style="aspect-ratio:${ratio}"><span>${value.width}:${value.height}</span></div>`;
  }
  return undefined;
}

export function renderMediaSpecimen(record: SpecimenRecord): RenderedSpecimen {
  const files = record.payload.files;
  const svgFiles = files.filter(file => file.path.endsWith(".svg") && file.content.trim().startsWith("<svg"));
  const tiles: string[] = [];
  for (const file of files) {
    if (!file.path.endsWith(".json")) continue;
    const doc = parse(file.content);
    if (!isRecord(doc)) continue;
    for (const group of Object.values(doc)) {
      if (!isRecord(group)) continue;
      for (const asset of Object.values(group)) {
        if (!isRecord(asset)) continue;
        for (const [name, token] of Object.entries(asset)) {
          if (!isRecord(token) || !("$value" in token)) continue;
          const body = member(name, token, svgFiles);
          if (body) tiles.push(tile(`asset-${String(token.$type)}`, name, body));
        }
      }
    }
  }
  // An item with no token file still shows the SVG files it ships.
  if (!tiles.length) for (const file of svgFiles) tiles.push(tile("asset-svg", file.path.replace(/^.*\//, "").replace(/\.svg$/, ""), image(svgUri(file.content), file.path)));
  if (!tiles.length) return unavailable(record, "the asset item has no member that can be drawn");
  return { html: `<section class="specimen-tokens" data-specimen-tokens="asset">${tiles.join("")}</section>`, problems: [] };
}
