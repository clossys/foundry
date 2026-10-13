import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { checkTokenContrast } from "./contrast-gate.js";
import { CONTRAST_PAIRS } from "./contrast-pairs.js";
import { findAllCustomPropertyNames } from "./internal/parse-css.js";
import { TOKENS, type TokenDefinition } from "./tokens.js";

/**
 * The CTA ladder's colour tokens: the tonal (T3) fills, their hover and
 * inverse-ground variants, and the quiet (T4) ink. Brand coverage and the
 * contrast pairs are checked here, with a mutation proof: a darkened (or,
 * on the inverse ground, lightened) token must make the gate fail.
 */

const CONTROL_TOKENS = [
  "--color-control-tonal",
  "--color-control-tonal-hover",
  "--color-control-tonal-inverse",
  "--color-control-tonal-inverse-hover",
  "--color-control-quiet",
] as const;

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const brandTemplateCss = readFileSync(join(packageRoot, "styles", "brand-template.css"), "utf8");

const LADDER_PAIR_IDS = [
  "ink-primary/control-tonal@surface-base",
  "ink-primary/control-tonal@surface-sunken",
  "ink-primary/control-tonal-hover@surface-sunken",
  "ink-on-inverse/control-tonal-inverse@surface-inverse",
  "ink-on-inverse/control-tonal-inverse-hover@surface-inverse",
  "control-quiet/surface-base",
  "control-quiet/surface-sunken",
  "ink-on-inverse/surface-inverse-raised",
] as const;

const ladderPairs = CONTRAST_PAIRS.filter((pair) => (LADDER_PAIR_IDS as readonly string[]).includes(pair.id));

function withValue(property: string, value: string): Readonly<Record<string, TokenDefinition>> {
  const current = TOKENS[property];
  if (current === undefined) throw new Error(`no token ${property}`);
  return { ...TOKENS, [property]: { ...current, value } };
}

describe("CTA ladder tokens", () => {
  it("declares all five in the control family, brandable, the four tonal fills theme-dependent", () => {
    for (const property of CONTROL_TOKENS) {
      const def = TOKENS[property];
      expect(def, property).toBeDefined();
      expect(def?.family).toBe("control");
      expect(def?.brandable).toBe(true);
    }
    expect(TOKENS["--color-control-quiet"]?.value).toBe("var(--color-ink-primary, oklch(0.2178 0 0))");
    expect(TOKENS["--color-control-quiet"]?.themeDependent).toBe(false);
    for (const property of CONTROL_TOKENS.slice(0, 4)) {
      expect(TOKENS[property]?.themeDependent, property).toBe(true);
    }
  });

  it("lists the four tonal tokens and the quiet token in brand-template.css", () => {
    const names = findAllCustomPropertyNames(brandTemplateCss);
    const missing = CONTROL_TOKENS.filter((property) => !names.has(property));
    expect(missing).toEqual([]);
  });

  it("checks every ladder pair, and every one passes on the shipped light tokens", () => {
    expect(ladderPairs.map((pair) => pair.id).sort()).toEqual([...LADDER_PAIR_IDS].sort());
    const result = checkTokenContrast(ladderPairs, { tokens: TOKENS });
    expect(result.unchecked).toEqual([]);
    expect(result.findings).toEqual([]);
    expect(result.ok).toBe(true);
  });

  describe("mutation proof: a token pushed toward its text fails the gate", () => {
    it("a darkened tonal fill fails ink-primary on tonal, over base and sunken", () => {
      const tokens = withValue("--color-control-tonal", "oklch(0.2178 0 0 / 0.9)");
      const result = checkTokenContrast(ladderPairs, { tokens });
      expect(result.ok).toBe(false);
      expect(result.findings.map((f) => f.pairId).sort()).toEqual([
        "ink-primary/control-tonal@surface-base",
        "ink-primary/control-tonal@surface-sunken",
      ]);
    });

    it("a darkened tonal hover fill fails its hover pair", () => {
      const tokens = withValue("--color-control-tonal-hover", "oklch(0.2178 0 0 / 0.9)");
      const result = checkTokenContrast(ladderPairs, { tokens });
      expect(result.findings.map((f) => f.pairId)).toEqual(["ink-primary/control-tonal-hover@surface-sunken"]);
    });

    it("a lightened inverse tonal fill fails on-inverse ink on it", () => {
      const tokens = withValue("--color-control-tonal-inverse", "oklch(0.9702 0 0 / 0.7)");
      const result = checkTokenContrast(ladderPairs, { tokens });
      expect(result.findings.map((f) => f.pairId)).toEqual(["ink-on-inverse/control-tonal-inverse@surface-inverse"]);
    });

    it("a lightened inverse tonal hover fill fails its hover pair", () => {
      const tokens = withValue("--color-control-tonal-inverse-hover", "oklch(0.9702 0 0 / 0.7)");
      const result = checkTokenContrast(ladderPairs, { tokens });
      expect(result.findings.map((f) => f.pairId)).toEqual(["ink-on-inverse/control-tonal-inverse-hover@surface-inverse"]);
    });

    it("a quiet ink lightened toward the ground fails on base and sunken", () => {
      const tokens = withValue("--color-control-quiet", "oklch(0.7 0 0)");
      const result = checkTokenContrast(ladderPairs, { tokens });
      expect(result.findings.map((f) => f.pairId).sort()).toEqual(["control-quiet/surface-base", "control-quiet/surface-sunken"]);
    });

    it("an inverse icon fill lightened toward its glyph fails the 3:1 non-text floor", () => {
      const tokens = withValue("--color-surface-inverse-raised", "oklch(0.8 0 0)");
      const result = checkTokenContrast(ladderPairs, { tokens });
      expect(result.findings.map((f) => f.pairId)).toEqual(["ink-on-inverse/surface-inverse-raised"]);
    });
  });
});
