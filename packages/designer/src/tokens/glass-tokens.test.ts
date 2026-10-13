import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { checkTokenContrast } from "./contrast-gate.js";
import { CONTRAST_PAIRS } from "./contrast-pairs.js";
import { findAllCustomPropertyNames, parseDeclarationsForSelector } from "./internal/parse-css.js";
import { TOKENS, type TokenDefinition } from "./tokens.js";

/**
 * The glass tokens an overlay `SiteHeader` paints after scrolling: one
 * translucent plate per ink polarity and the backdrop blur behind them.
 * Each plate is gated against its ink over a white and a black backdrop, in
 * both themes, with a mutation proof: a seeded low alpha must fail the gate.
 */

const GLASS_COLORS = ["--color-surface-glass", "--color-surface-glass-inverse"] as const;

const GLASS_PAIR_IDS = [
  "ink-primary/surface-glass@backdrop-white",
  "ink-primary/surface-glass@backdrop-black",
  "ink-on-inverse/surface-glass-inverse@backdrop-white",
  "ink-on-inverse/surface-glass-inverse@backdrop-black",
] as const;

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const tokensCss = readFileSync(join(packageRoot, "styles", "tokens.css"), "utf8");
const brandTemplateCss = readFileSync(join(packageRoot, "styles", "brand-template.css"), "utf8");

const glassPairs = CONTRAST_PAIRS.filter((pair) => (GLASS_PAIR_IDS as readonly string[]).includes(pair.id));

/** The shipped registry with every theme-dependent token set to its dark value from tokens.css. */
function darkTokens(): Readonly<Record<string, TokenDefinition>> {
  const dark = parseDeclarationsForSelector(tokensCss, ':root[data-theme="dark"]');
  const tokens: Record<string, TokenDefinition> = { ...TOKENS };
  for (const [property, value] of dark) {
    const current = tokens[property];
    if (current !== undefined) tokens[property] = { ...current, value };
  }
  return tokens;
}

function withValue(
  base: Readonly<Record<string, TokenDefinition>>,
  property: string,
  value: string,
): Readonly<Record<string, TokenDefinition>> {
  const current = base[property];
  if (current === undefined) throw new Error(`no token ${property}`);
  return { ...base, [property]: { ...current, value } };
}

const THEMES = [
  ["light", TOKENS],
  ["dark", darkTokens()],
] as const;

describe("glass tokens", () => {
  it("declares the two glass plates as brandable, theme-dependent surface tokens", () => {
    for (const property of GLASS_COLORS) {
      expect(TOKENS[property], property).toMatchObject({ family: "surface", brandable: true, themeDependent: true });
    }
    expect(TOKENS["--color-surface-glass"]?.value).toBe("oklch(1 0 0 / 0.88)");
    expect(TOKENS["--color-surface-glass-inverse"]?.value).toBe("oklch(0.2178 0 0 / 0.88)");
  });

  it("declares the blur as a brandable, theme-invariant token in the Tailwind blur namespace", () => {
    expect(TOKENS["--blur-glass"]).toMatchObject({ family: "blur", value: "16px", brandable: true, themeDependent: false });
  });

  it("gives each glass plate a translucent dark value", () => {
    const dark = parseDeclarationsForSelector(tokensCss, ':root[data-theme="dark"]');
    expect(dark.get("--color-surface-glass")).toBe("oklch(0.26 0 0 / 0.88)");
    expect(dark.get("--color-surface-glass-inverse")).toBe("oklch(0.96 0 0 / 0.88)");
    expect(dark.has("--blur-glass")).toBe(false);
  });

  it("lists all three in brand-template.css", () => {
    const names = findAllCustomPropertyNames(brandTemplateCss);
    expect([...GLASS_COLORS, "--blur-glass"].filter((property) => !names.has(property))).toEqual([]);
  });

  it.each(THEMES)("checks every glass pair, and every one passes on the shipped %s tokens", (_theme, tokens) => {
    expect(glassPairs.map((pair) => pair.id).sort()).toEqual([...GLASS_PAIR_IDS].sort());
    const result = checkTokenContrast(glassPairs, { tokens });
    expect(result.unchecked).toEqual([]);
    expect(result.findings).toEqual([]);
    expect(result.ok).toBe(true);
  });

  describe("mutation proof: a seeded failing alpha fails the gate", () => {
    it.each(THEMES)("a base glass at 20%% alpha fails over the backdrop of the opposite polarity (%s)", (theme, tokens) => {
      const lightness = theme === "light" ? "1" : "0.26";
      const result = checkTokenContrast(glassPairs, { tokens: withValue(tokens, "--color-surface-glass", `oklch(${lightness} 0 0 / 0.2)`) });
      expect(result.ok).toBe(false);
      expect(result.findings.map((f) => f.pairId)).toEqual([
        theme === "light" ? "ink-primary/surface-glass@backdrop-black" : "ink-primary/surface-glass@backdrop-white",
      ]);
    });

    it.each(THEMES)("an inverse glass at 20%% alpha fails over the backdrop of the opposite polarity (%s)", (theme, tokens) => {
      const lightness = theme === "light" ? "0.2178" : "0.96";
      const result = checkTokenContrast(glassPairs, {
        tokens: withValue(tokens, "--color-surface-glass-inverse", `oklch(${lightness} 0 0 / 0.2)`),
      });
      expect(result.ok).toBe(false);
      expect(result.findings.map((f) => f.pairId)).toEqual([
        theme === "light" ? "ink-on-inverse/surface-glass-inverse@backdrop-white" : "ink-on-inverse/surface-glass-inverse@backdrop-black",
      ]);
    });

    it("a modest cut from 88% to 80% alpha already fails", () => {
      const result = checkTokenContrast(glassPairs, { tokens: withValue(TOKENS, "--color-surface-glass-inverse", "oklch(0.2178 0 0 / 0.8)") });
      expect(result.findings.map((f) => f.pairId)).toEqual(["ink-on-inverse/surface-glass-inverse@backdrop-white"]);
    });
  });
});
