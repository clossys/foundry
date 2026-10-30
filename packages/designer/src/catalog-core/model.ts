import type { CellType, DtcgToken, DtcgValue, FillDoc, Mode, Slot } from "./types.js";
import { gradientColorAlias, gradientStops, isFluidDimension } from "../tokens/expressive.js";

export const compare = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
export const metaOf = (fill: FillDoc) => fill.$extensions["com.clossys.fill"];
export const leafOf = (member: string): string => member.split(".").slice(0, 2).join(".");
export const relativeOf = (member: string): string => member.split(".").slice(2).join(".");
export const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
export const aliasOf = (value: unknown): string | undefined => typeof value === "string" ? /^\{([^{}]+)\}$/.exec(value)?.[1] : undefined;
export const modeValue = (token: DtcgToken, mode: Mode): DtcgValue => mode === "dark" ? token.$extensions?.["com.clossys.modes"]?.dark ?? token.$value : token.$value;
export const typeOf = (slot: Slot, relative: string): CellType => slot.contract.kind === "token" ? slot.contract.memberTypes?.[relative] ?? slot.contract.$type : slot.contract.memberKinds?.[relative] ?? slot.contract.valueKind;
export function flatten(fill: FillDoc): Record<string, DtcgToken> {
  const result: Record<string, DtcgToken> = {};
  const walk = (node: unknown, path: string): void => {
    if (!object(node)) return;
    if (Object.hasOwn(node, "$value")) { result[path] = node as unknown as DtcgToken; return; }
    for (const key of Object.keys(node).filter(key => !key.startsWith("$")).sort(compare)) walk(node[key], `${path}.${key}`);
  };
  if (fill.tokens) walk(fill.tokens, "tokens");
  if (fill.assets) walk(fill.assets, "assets");
  return result;
}
/** Asset templates substitute resolved values. Exact $ref objects preserve JSON types. */
export function assetReferences(value: DtcgValue): string[] {
  const refs = new Set<string>();
  const visit = (v: DtcgValue): void => {
    if (typeof v === "string") for (const match of v.matchAll(/\{\{([^{}]+)\}\}/g)) refs.add(match[1]!);
    else if (Array.isArray(v)) v.forEach(visit);
    else if (object(v)) {
      if (typeof v.$ref === "string" && Object.keys(v).length === 1) refs.add(v.$ref);
      else Object.values(v).forEach(child => visit(child as DtcgValue));
    }
  };
  visit(value); return [...refs].sort(compare);
}
export function interpolateAsset(value: DtcgValue, read: (member: string, text: boolean) => DtcgValue | undefined): DtcgValue | undefined {
  let missing = false;
  const visit = (v: DtcgValue): DtcgValue => {
    if (typeof v === "string") return v.replace(/\{\{([^{}]+)\}\}/g, (_, id: string) => {
      const got = read(id, true); if (got === undefined) { missing = true; return ""; }
      return typeof got === "string" || typeof got === "number" ? String(got) : JSON.stringify(got);
    });
    if (Array.isArray(v)) return v.map(visit);
    if (object(v)) {
      if (typeof v.$ref === "string" && Object.keys(v).length === 1) {
        const got = read(v.$ref, false); if (got === undefined) missing = true; return got ?? null;
      }
      return Object.fromEntries(Object.entries(v).map(([k, child]) => [k, visit(child as DtcgValue)]));
    }
    return v;
  };
  const result = visit(value); return missing ? undefined : result;
}
export function references(token: DtcgToken): string[] {
  const result = new Set(token.$extensions?.["com.clossys.css"]?.reads ?? []);
  const origin = token.$extensions?.["com.clossys.origin"];
  if (origin?.kind === "derived" && Array.isArray(origin.inputs)) origin.inputs.filter((input): input is string => typeof input === "string").forEach(input => result.add(input));
  for (const mode of ["light", "dark"] as const) {
    const value = modeValue(token, mode); const alias = aliasOf(value);
    if (alias) result.add(alias);
    if (token.$type === "gradient" && gradientStops(value)) for (const stop of value) {
      const target = gradientColorAlias(stop.color); if (target) result.add(target);
    }
    assetReferences(value).forEach(ref => result.add(ref));
  }
  return [...result].sort(compare);
}
const generics = new Set("serif sans-serif monospace cursive fantasy system-ui ui-sans-serif ui-serif ui-monospace ui-rounded emoji math fangsong".split(" "));
export function cssText(type: CellType, value: DtcgValue, token?: DtcgToken, useRaw = true): string {
  const raw = token?.$extensions?.["com.clossys.css"]?.raw;
  if (useRaw && raw !== undefined && type !== "gradient") return raw;
  if (typeof value === "string" && type !== "fontFamily") return value;
  if (type === "fontFamily") return (Array.isArray(value) ? value : [value]).map(name => {
    const text = String(name); return generics.has(text) || text.startsWith("-") ? text : JSON.stringify(text);
  }).join(", ");
  if (type === "number" || type === "fontWeight") return String(value) + (token?.$extensions?.["com.clossys.unit"] === "em" ? "em" : "");
  if ((type === "dimension" || type === "duration") && object(value)) return String(value.value) + String(value.unit);
  if (type === "cubicBezier" && Array.isArray(value)) return `cubic-bezier(${value.join(", ")})`;
  if (type === "gradient" && Array.isArray(value)) return `linear-gradient(180deg, ${value.map(stop => object(stop) ? `${cssText("color", stop.color as DtcgValue)} ${Number(stop.position) * 100}%` : String(stop)).join(", ")})`;
  if (type === "color" && object(value)) {
    if (typeof value.hex === "string") return value.hex;
    const components = Array.isArray(value.components) ? value.components.join(" ") : "";
    const alpha = typeof value.alpha === "number" && value.alpha < 1 ? ` / ${value.alpha}` : "";
    return ["srgb", "srgb-linear", "display-p3", "a98-rgb", "prophoto-rgb", "rec2020", "xyz-d50", "xyz-d65"].includes(String(value.colorSpace)) ? `color(${String(value.colorSpace)} ${components}${alpha})` : `${String(value.colorSpace)}(${components}${alpha})`;
  }
  if (type === "shadow") return (Array.isArray(value) ? value : [value]).map(layer => {
    if (!object(layer)) return String(layer);
    const dimension = (v: unknown): string => object(v) ? `${v.value}${v.unit}` : String(v ?? "0px");
    return `${layer.inset ? "inset " : ""}${dimension(layer.offsetX)} ${dimension(layer.offsetY)} ${dimension(layer.blur)} ${dimension(layer.spread)} ${cssText("color", layer.color as DtcgValue)}`;
  }).join(", ");
  return typeof value === "string" ? value : JSON.stringify(value);
}
export function malformed(type: CellType, value: DtcgValue, raw?: string): boolean {
  if (type === "gradient" && raw !== undefined) return true;
  if (type === "dimension" && (typeof value === "string" && /^clamp/i.test(value.trim()) || raw !== undefined && /^clamp/i.test(raw.trim()))) return !isFluidDimension(value) || raw !== undefined && !isFluidDimension(raw);
  if (aliasOf(value)) return false;
  if (raw !== undefined && typeof value === "string") return false;
  const number = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
  const dim = (v: unknown): boolean => object(v) && number(v.value) && ["px", "rem"].includes(String(v.unit));
  if (type === "dimension") return !dim(value);
  if (type === "duration") return !object(value) || !number(value.value) || value.unit !== "ms";
  if (type === "number" || type === "fontWeight") return !number(value);
  if (type === "fontFamily") return !(typeof value === "string" || Array.isArray(value) && value.length > 0 && value.every(v => typeof v === "string"));
  if (type === "cubicBezier") return !Array.isArray(value) || value.length !== 4 || !value.every(number) || Number(value[0]) < 0 || Number(value[0]) > 1 || Number(value[2]) < 0 || Number(value[2]) > 1;
  if (type === "color") return !object(value) || !["srgb", "srgb-linear", "display-p3", "a98-rgb", "prophoto-rgb", "rec2020", "lab", "oklab", "lch", "oklch", "hsl", "hwb", "xyz-d50", "xyz-d65"].includes(String(value.colorSpace)) || !Array.isArray(value.components) || value.components.length !== 3 || !value.components.every(number) || value.alpha !== undefined && (!number(value.alpha) || value.alpha < 0 || value.alpha > 1) || value.hex !== undefined && (typeof value.hex !== "string" || !/^#[a-fA-F0-9]{6}(?:[a-fA-F0-9]{2})?$/.test(value.hex));
  if (type === "shadow") return !(Array.isArray(value) ? value.length > 0 && value.every(v => !malformed(type, v)) : object(value) && dim(value.offsetX) && dim(value.offsetY) && dim(value.blur) && dim(value.spread) && !malformed("color", value.color as DtcgValue));
  if (type === "gradient") return !gradientStops(value) || value.some(stop => !gradientColorAlias(stop.color) && malformed("color", stop.color));
  if (type === "svg") return typeof value !== "string";
  if (type === "glyph") return !Array.isArray(value);
  if (type === "raster") return !object(value);
  return !object(value);
}
/** First unsafe token, ordered by its position in the text. */
export function unsafeText(text: string): string | undefined {
  return /[;{}<>\\\x00-\x1f\x7f]|\/\*|\*\/|@|url\s*\(|expression\s*\(|!important/i.exec(text)?.[0];
}
