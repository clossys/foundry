import type { DtcgValue } from "../catalog-core/types.js";

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const COLOR_ROLE = /^\{(tokens\.(?:surface|text|border|accent|action|control|status|focus|scrim|chart|categorical|sequential|diverging)-color\.[a-z0-9]+(?:-[a-z0-9]+)*)\}$/;
/** Only a complete semantic colour-role alias is legal inside a gradient stop. */
export function gradientColorAlias(value: unknown): string | undefined {
  return typeof value === "string" ? COLOR_ROLE.exec(value)?.[1] : undefined;
}
export interface GradientStop { readonly color: DtcgValue; readonly position: number }
/** Validate the stop container separately from the existing typed colour validator. */
export function gradientStops(value: unknown): value is readonly GradientStop[] {
  return Array.isArray(value) && value.length >= 2 && value.every((stop, index) =>
    record(stop) && Object.keys(stop).length === 2 && Object.hasOwn(stop, "color") && Object.hasOwn(stop, "position")
    && (gradientColorAlias(stop.color) !== undefined || record(stop.color))
    && typeof stop.position === "number" && Number.isFinite(stop.position) && stop.position >= 0 && stop.position <= 1
    && (index === 0 || stop.position >= value[index - 1].position));
}

const DECIMAL = String.raw`[+-]?(?:\d+(?:\.\d+)?|\.\d+)`;
const OKLCH = new RegExp(`^oklch\\(\\s*(${DECIMAL})\\s+(${DECIMAL})\\s+(${DECIMAL})(?:\\s*/\\s*(${DECIMAL}))?\\s*\\)$`);
/** Materialize the legacy standalone colour forms used by selected colour roles. */
export function gradientRoleColor(value: DtcgValue): DtcgValue | undefined {
  if (typeof value !== "string") return value;
  const text = value.trim(), match = OKLCH.exec(text);
  if (match) {
    const [lightness, chroma, hue, alpha] = [Number(match[1]), Number(match[2]), Number(match[3]), match[4] === undefined ? 1 : Number(match[4])];
    if (![lightness, chroma, hue, alpha].every(Number.isFinite) || lightness! < 0 || lightness! > 1 || chroma! < 0 || hue! < 0 || hue! > 360 || alpha! < 0 || alpha! > 1) return undefined;
    return { colorSpace: "oklch", components: [lightness!, chroma!, hue!], ...(alpha !== 1 ? { alpha: alpha! } : {}) };
  }
  if (!/^#(?:[a-f\d]{3,4}|[a-f\d]{6}|[a-f\d]{8})$/i.test(text)) return undefined;
  const body = text.slice(1), expanded = body.length < 5 ? [...body].map(part => part + part).join("") : body;
  const channels = [0, 2, 4].map(index => parseInt(expanded.slice(index, index + 2), 16) / 255);
  const alpha = expanded.length === 8 ? parseInt(expanded.slice(6), 16) / 255 : 1;
  return { colorSpace: "srgb", components: channels, ...(alpha !== 1 ? { alpha } : {}), hex: `#${expanded}` };
}

const FLUID = /^clamp\(\s*(\d+(?:\.\d+)?|\.\d+)(px|rem)\s*,\s*(\d+(?:\.\d+)?|\.\d+)(px|rem|vw|vh|vmin|vmax)\s*,\s*(\d+(?:\.\d+)?|\.\d+)(px|rem)\s*\)$/;
/** A finite, ordered font-size range; arbitrary CSS expressions are never admitted. */
export function isFluidDimension(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = FLUID.exec(value.trim());
  if (!match) return false;
  const min = Number(match[1]), preferred = Number(match[3]), max = Number(match[5]);
  return [min, preferred, max].every(part => Number.isFinite(part) && part > 0)
    && match[2] === match[6] && min <= max;
}
