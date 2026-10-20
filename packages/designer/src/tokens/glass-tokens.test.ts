import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { contrastRatio, contrastRatioEncodedBlend, parseOklch } from "./color.js";
import { checkTokenContrast } from "./contrast-gate.js";
import { AA, CONTRAST_PAIRS, contrastPairsForTheme } from "./contrast-pairs.js";
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

/** The overlay header's focus indicator on each glass: the tone's ink at the 3:1 non-text floor. */
const FOCUS_PAIR_IDS = [
  "focus-ring/surface-glass@backdrop-white",
  "focus-ring/surface-glass@backdrop-black",
  "focus-ring/surface-glass-inverse@backdrop-white",
  "focus-ring/surface-glass-inverse@backdrop-black",
] as const;

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const tokensCss = readFileSync(join(packageRoot, "styles", "tokens.css"), "utf8");
const brandTemplateCss = readFileSync(join(packageRoot, "styles", "brand-template.css"), "utf8");

const glassPairs = CONTRAST_PAIRS.filter((pair) => (GLASS_PAIR_IDS as readonly string[]).includes(pair.id));
const focusPairs = CONTRAST_PAIRS.filter((pair) => (FOCUS_PAIR_IDS as readonly string[]).includes(pair.id));

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
    expect(TOKENS["--color-surface-glass"]?.value).toBe("oklch(1 0 0 / 0.6)");
    expect(TOKENS["--color-surface-glass-inverse"]?.value).toBe("oklch(0.2178 0 0 / 0.85)");
  });

  it("declares the blur as a brandable, theme-invariant token in the Tailwind blur namespace", () => {
    expect(TOKENS["--blur-glass"]).toMatchObject({ family: "blur", value: "20px", brandable: true, themeDependent: false });
    expect(parseDeclarationsForSelector(tokensCss, ":root").get("--blur-glass")).toBe("20px");
  });

  it("gives each glass plate a translucent dark value", () => {
    const dark = parseDeclarationsForSelector(tokensCss, ':root[data-theme="dark"]');
    expect(dark.get("--color-surface-glass")).toBe("oklch(0.26 0 0 / 0.86)");
    expect(dark.get("--color-surface-glass-inverse")).toBe("oklch(0.96 0 0 / 0.6)");
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

  it.each(THEMES)("uses the lowest hundredth alpha with a 0.1 AA margin, never below 0.60 (%s)", (theme, tokens) => {
    for (const plate of GLASS_COLORS) {
      const ink = tokens[plate === "--color-surface-glass" ? "--color-ink-primary" : "--color-ink-on-inverse"]!.value;
      const value = tokens[plate]!.value;
      const alpha = parseOklch(value).A;
      const minimum = (color: string) => Math.min(...["oklch(1 0 0)", "oklch(0 0 0)"].flatMap(backdrop => [contrastRatio(ink, color, backdrop), contrastRatioEncodedBlend(ink, color, backdrop)]));
      expect(alpha, plate).toBeGreaterThanOrEqual(0.6);
      expect(minimum(value), plate).toBeGreaterThanOrEqual(AA + 0.1);
      if (alpha > 0.6) {
        const previous = value.replace(/\/\s*[\d.]+\)/, `/ ${(alpha - 0.01).toFixed(2)})`);
        expect(minimum(previous), plate).toBeLessThan(AA + 0.1);
      }
      console.info("glass-aa-measurement", JSON.stringify({ theme, plate, alpha, minimumRatio: minimum(value), requiredRatio: AA, margin: minimum(value) - AA }));
    }
  });

  it.each(THEMES)("rejects 40% alpha for either plate using the unchanged contrast gate (%s)", (_theme, tokens) => {
    for (const plate of GLASS_COLORS) {
      const value = tokens[plate]!.value.replace(/\/\s*[\d.]+\)/, "/ 0.4)");
      const result = checkTokenContrast(glassPairs, { tokens: withValue(tokens, plate, value) });
      expect(result.unchecked).toEqual([]);
      expect(result.ok).toBe(false);
      expect(result.findings.length).toBeGreaterThan(0);
    }
  });

  it.each(THEMES)("checks the focus indicator on each glass in the tone's ink at 3:1, and it passes on the shipped %s tokens", (_theme, tokens) => {
    expect(focusPairs.map((pair) => pair.id).sort()).toEqual([...FOCUS_PAIR_IDS].sort());
    for (const pair of focusPairs) {
      expect(pair.minimumRatio, pair.id).toBe(3);
      expect(pair.foreground, pair.id).toBe(pair.background === "--color-surface-glass" ? "--color-ink-primary" : "--color-ink-on-inverse");
    }
    const result = checkTokenContrast(focusPairs, { tokens });
    expect(result.unchecked).toEqual([]);
    expect(result.findings).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it.each([
    ["light", TOKENS, ["focus-ring/surface-glass-inverse@backdrop-white", "focus-ring/surface-glass-inverse@backdrop-black", "focus-ring/surface-glass@backdrop-black"]],
    ["dark", darkTokens(), ["focus-ring/surface-glass@backdrop-white", "focus-ring/surface-glass-inverse@backdrop-black"]],
  ] as const)("mutation proof: an accent focus ring fails on the glass in the %s theme", (_theme, tokens, failing) => {
    const accentPairs = focusPairs.map((pair) => ({ ...pair, foreground: "--color-accent" }));
    const result = checkTokenContrast(accentPairs, { tokens });
    expect(result.ok).toBe(false);
    expect(result.findings.map((f) => f.pairId).sort()).toEqual([...failing].sort());
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

    it("a light base glass at 40% alpha fails over black in the light theme, as a browser paints it", () => {
      // A linear-light blend alone would pass this; the gate also scores the
      // gamma-encoded sRGB blend browsers use and keeps the lower ratio.
      const result = checkTokenContrast(glassPairs, { tokens: withValue(TOKENS, "--color-surface-glass", "oklch(1 0 0 / 0.4)") });
      expect(result.findings.map((f) => f.pairId)).toEqual(["ink-primary/surface-glass@backdrop-black"]);
    });

    it("a light inverse glass at 40% alpha fails over black in the dark theme, as a browser paints it", () => {
      const result = checkTokenContrast(glassPairs, {
        tokens: withValue(darkTokens(), "--color-surface-glass-inverse", "oklch(0.96 0 0 / 0.4)"),
      });
      expect(result.findings.map((f) => f.pairId)).toEqual(["ink-on-inverse/surface-glass-inverse@backdrop-black"]);
    });

    it("an ink inside the plate's backdrop range fails at 1:1, though both extremes clear their floors", () => {
      // A near-clear plate of the ink's own color, on an otherwise white
      // palette: over white the plate is lighter than the ink, over black it
      // is darker, so some page content in between makes it exactly as light
      // as the ink. Scored on the two extremes alone, every pair passes.
      const ink = "oklch(0.565 0 0)";
      const glass = "oklch(0.565 0 0 / 0.001)";
      let tokens = withValue(withValue(TOKENS, "--color-ink-primary", ink), "--color-surface-glass", glass);
      for (const property of ["--color-surface-base", "--color-surface-sunken", "--color-control-tonal", "--color-control-tonal-hover"]) {
        tokens = withValue(tokens, property, "oklch(1 0 0)");
      }
      for (const backdrop of ["oklch(1 0 0)", "oklch(0 0 0)"]) {
        expect(Math.min(contrastRatio(ink, glass, backdrop), contrastRatioEncodedBlend(ink, glass, backdrop)), backdrop).toBeGreaterThan(AA);
      }
      const result = checkTokenContrast(contrastPairsForTheme("light"), { tokens });
      expect(result.ok).toBe(false);
      expect(result.reason).toBe("contrast-gap");
      expect(result.unchecked).toEqual([]);
      expect(result.findings.map((f) => f.pairId).sort()).toEqual(
        [
          // This seeded palette paints both page grounds white, invalidating
          // categorical slot 2's relief measured on the shipped grounds.
          "chart-categorical-2/surface-base",
          "chart-categorical-2/surface-sunken",
          "ink-primary/surface-glass@backdrop-white",
          "ink-primary/surface-glass@backdrop-black",
          "focus-ring/surface-glass@backdrop-white",
          "focus-ring/surface-glass@backdrop-black",
        ].sort(),
      );
      for (const finding of result.findings) {
        if (finding.pairId.startsWith("chart-categorical-2/")) {
          expect(finding.rule, finding.pairId).toBe("stale-exception");
          expect(finding.ratio, finding.pairId).toBeGreaterThanOrEqual(3);
          continue;
        }
        expect(finding.rule, finding.pairId).toBe("below-threshold");
        expect(finding.ratio, finding.pairId).toBe(1);
        expect(finding.message, finding.pairId).toContain("intermediate backdrop");
      }
    });

    it("cutting the light-theme inverse plate to 80% alpha fails", () => {
      const result = checkTokenContrast(glassPairs, { tokens: withValue(TOKENS, "--color-surface-glass-inverse", "oklch(0.2178 0 0 / 0.8)") });
      expect(result.findings.map((f) => f.pairId)).toEqual(["ink-on-inverse/surface-glass-inverse@backdrop-white"]);
    });
  });
});
