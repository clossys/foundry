import { AA } from "./contrast-pairs.js";
import { hexToLinearSRGB, oklchToLinearSRGB, parseOklch, relativeLuminance } from "./color.js";
import { resolveTokenValue } from "./internal/resolve-token-value.js";
import { TOKENS, type TokenDefinition } from "./tokens.js";

type Registry = Readonly<Record<string, TokenDefinition>>;
type Theme = "light" | "dark";
export interface FieldTokenFinding {
  rule: "field-alpha-contrast" | "field-scale-range" | "field-lens-range";
  severity: "error" | "warning";
  theme: Theme;
  message: string;
}
export interface FieldTokenUnchecked { rule: FieldTokenFinding["rule"]; theme: Theme; message: string }
export interface FieldTokenOptions { tokens?: Registry; darkTokens?: Registry; themes?: "both" | "light-only" }
export interface FieldTokenReport {
  ok: boolean;
  findings: FieldTokenFinding[];
  unchecked: FieldTokenUnchecked[];
  contrast: Partial<Record<Theme, number>>;
}

function literal(name: string, tokens: Registry): string {
  const result = resolveTokenValue(name, tokens);
  if (result.value === undefined) throw new Error(`${name} could not resolve its token alias chain.`);
  return result.value.trim();
}
function unitless(name: string, tokens: Registry): number {
  const value = literal(name, tokens);
  if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(value)) throw new Error(`${name} must be a finite unitless number.`);
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${name} must be finite.`);
  return number;
}
function opaqueColor(value: string): readonly [number, number, number] {
  if (/^#[\da-f]{6}$/i.test(value)) return hexToLinearSRGB(value);
  if (!/^oklch\([^()]+\)$/.test(value)) throw new Error("Field colours must be a complete hex or oklch literal.");
  const color = parseOklch(value);
  if (![color.L, color.C, color.H, color.A].every(Number.isFinite)) throw new Error("Field colour channels must be finite.");
  if (color.A !== 1) throw new Error("Field colours must be opaque; the field alpha supplies the only opacity.");
  const rgb = oklchToLinearSRGB(color);
  if (!rgb.every(Number.isFinite)) throw new Error("Field colour conversion must produce finite sRGB channels.");
  return rgb;
}
const encode = (c: number) => c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
const decode = (c: number) => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;

/** Measures the painted SVG pixel: source-over in gamma-encoded sRGB, then WCAG luminance. */
function dotContrast(tokens: Registry): number {
  const alpha = unitless("--ui-field-alpha", tokens);
  if (alpha > 1) throw new Error("--ui-field-alpha must be between 0 and 1.");
  const dot = opaqueColor(literal("--color-field-dot", tokens));
  const ground = opaqueColor(literal("--color-surface-inverse", tokens));
  const ink = opaqueColor(literal("--color-ink-on-inverse", tokens));
  const pixel = dot.map((channel, i) => decode(alpha * encode(channel) + (1 - alpha) * encode(ground[i]!))) as [number, number, number];
  const a = relativeLuminance(ink), b = relativeLuminance(pixel);
  const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  if (!Number.isFinite(ratio)) throw new Error("Field contrast must produce a finite ratio.");
  return ratio;
}

/** Checks field opacity, density and lens size. Missing colour/theme evidence never becomes a pass. */
export function checkFieldTokens(options: FieldTokenOptions = {}): FieldTokenReport {
  const tokens = options.tokens ?? TOKENS;
  const findings: FieldTokenFinding[] = [], unchecked: FieldTokenUnchecked[] = [];
  const contrast: FieldTokenReport["contrast"] = {};
  const themes: Theme[] = options.themes === "light-only" ? ["light"] : ["light", "dark"];
  for (const theme of themes) {
    const registry = theme === "light" ? tokens : options.darkTokens;
    const decline = (rule: FieldTokenFinding["rule"], error: unknown) => unchecked.push({ rule, theme, message: error instanceof Error ? error.message : String(error) });
    if (!registry) { decline("field-alpha-contrast", "The dark theme token registry was not supplied."); continue; }
    try {
      if (theme === "dark") {
        const chains = ["--color-field-dot", "--color-surface-inverse", "--color-ink-on-inverse"].flatMap((name) => resolveTokenValue(name, registry).chain);
        const unstated = [...new Set(chains)].filter((name) => (TOKENS[name]?.themeDependent || tokens[name]?.themeDependent || registry[name]?.themeDependent) && (!registry[name] || registry[name]?.value === tokens[name]?.value));
        if (unstated.length) throw new Error(`Dark values were not stated for ${unstated.join(", ")}.`);
      }
      const ratio = dotContrast(registry);
      contrast[theme] = ratio;
      if (ratio < AA) findings.push({ rule: "field-alpha-contrast", severity: "error", theme, message: `On a dot pixel, on-inverse ink has contrast ${ratio.toFixed(2)}:1 in ${theme}; at least ${AA}:1 is required.` });
    } catch (error) { decline("field-alpha-contrast", error); }
    try {
      const scale = unitless("--ui-field-scale", registry);
      if (scale < 0.75 || scale > 1.5) findings.push({ rule: "field-scale-range", severity: "error", theme, message: "--ui-field-scale must be between 0.75 and 1.5." });
    } catch (error) { decline("field-scale-range", error); }
    try {
      const lens = literal("--ui-field-lens", registry);
      if (!/^(?:\d+(?:\.\d*)?|\.\d+)rem$/.test(lens)) throw new Error("--ui-field-lens must be a finite length in rem.");
      const radius = Number(lens.slice(0, -3));
      if (!Number.isFinite(radius)) throw new Error("--ui-field-lens must be finite.");
      if (radius < 10 || radius > 20) findings.push({ rule: "field-lens-range", severity: "warning", theme, message: "--ui-field-lens is outside the recommended 10 to 20 rem range." });
    } catch (error) { decline("field-lens-range", error); }
  }
  return { ok: unchecked.length === 0 && !findings.some((f) => f.severity === "error"), findings, unchecked, contrast };
}
