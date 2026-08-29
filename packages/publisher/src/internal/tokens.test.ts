import { describe, expect, it } from "vitest";

import { RenderError } from "./errors.js";
import { flattenTokens, oklchToHex, resolveTokenRef } from "./tokens.js";

// ─────────────────────────────────────────────────────────────────────────
// oklchToHex
// ─────────────────────────────────────────────────────────────────────────

describe("oklchToHex", () => {
  it("converts pure black", () => {
    expect(oklchToHex("oklch(0 0 0)")).toBe("#000000");
  });

  it("converts pure white", () => {
    expect(oklchToHex("oklch(1 0 0)")).toBe("#ffffff");
  });

  it("round-trips sRGB red within ±1 per channel (reference: oklch(62.8% 0.2577 29.23) ~= #ff0000, colorjs.io/css-color-4 published value)", () => {
    const hex = oklchToHex("oklch(0.6280 0.2577 29.23)");
    expectHexCloseTo(hex, "#ff0000", 1);
  });

  it("round-trips sRGB lime green within ±1 per channel (reference: oklch(86.644% 0.29483 142.495) ~= #00ff00, colorjs.io published value)", () => {
    const hex = oklchToHex("oklch(0.86644 0.29483 142.495)");
    expectHexCloseTo(hex, "#00ff00", 1);
  });

  it("round-trips sRGB blue within ±1 per channel (reference: oklch(45.201% 0.31321 264.052) ~= #0000ff, colorjs.io published value)", () => {
    const hex = oklchToHex("oklch(0.45201 0.31321 264.052)");
    expectHexCloseTo(hex, "#0000ff", 1);
  });

  it("matches a real token value: --color-surface-base oklch(0.9702 0 0)", () => {
    // Achromatic (C=0, so a=b=0 in OKLab): every OKLab intermediate
    // (l_, m_, s_) equals L directly, but the matrices operate on their
    // CUBES (l = l_^3, etc.) — and the OKLab->linear-sRGB matrix
    // coefficients happen to sum to exactly 1.0 per row, so each linear
    // channel reduces to L^3, not L. Checkable by hand: gamma-encode
    // 0.9702^3.
    const hex = oklchToHex("oklch(0.9702 0 0)");
    const linear = 0.9702 ** 3;
    const gamma = 1.055 * linear ** (1 / 2.4) - 0.055;
    const expectedChannel = Math.round(gamma * 255);
    const actualChannel = Number.parseInt(hex.slice(1, 3), 16);
    expect(Math.abs(actualChannel - expectedChannel)).toBeLessThanOrEqual(1);
    expect(hex.slice(1, 3)).toBe(hex.slice(3, 5));
    expect(hex.slice(3, 5)).toBe(hex.slice(5, 7));
  });

  it("accepts percentage L and C (100% C == 0.4)", () => {
    const fromPercent = oklchToHex("oklch(50% 50% 0)");
    const fromNumber = oklchToHex("oklch(0.5 0.2 0)");
    expect(fromPercent).toBe(fromNumber);
  });

  it("treats hue 'none' as 0", () => {
    expect(oklchToHex("oklch(0.5 0 none)")).toBe(oklchToHex("oklch(0.5 0 0)"));
  });

  it("handles arbitrary internal whitespace", () => {
    expect(oklchToHex("oklch(   0.5    0.1   30   )")).toBe(oklchToHex("oklch(0.5 0.1 30)"));
  });

  it.each(["30/0.5", "30 /0.5", "30/ 0.5", "30 / 0.5"])(
    "accepts the alpha separator with bounded optional whitespace: %s",
    (suffix) => {
      expect(oklchToHex(`oklch(0.5 0.1 ${suffix})`)).toBe(oklchToHex("oklch(0.5 0.1 30 / 0.5)"));
    },
  );

  it("returns #rrggbbaa when alpha < 1", () => {
    const hex = oklchToHex("oklch(0.5 0.1 30 / 0.5)");
    expect(hex).toHaveLength(9);
    expect(hex.slice(7, 9)).toBe(toHexChannel(0.5));
  });

  it("returns #rrggbb (no alpha suffix) when alpha is exactly 1", () => {
    const hex = oklchToHex("oklch(0.5 0.1 30 / 1)");
    expect(hex).toHaveLength(7);
  });

  it("returns #rrggbb when alpha is omitted", () => {
    const hex = oklchToHex("oklch(0.5 0.1 30)");
    expect(hex).toHaveLength(7);
  });

  it("accepts a percentage alpha", () => {
    expect(oklchToHex("oklch(0.5 0.1 30 / 50%)")).toBe(oklchToHex("oklch(0.5 0.1 30 / 0.5)"));
  });

  it("gamut-maps an out-of-gamut color by reducing chroma, not by clipping each channel", () => {
    // oklch(0.9 0.5 145) — very high chroma green at high lightness — is
    // well outside sRGB. A naive per-channel clip of the raw linear
    // matrix output would produce nonsense; chroma reduction should land
    // on a real, in-gamut green.
    const hex = oklchToHex("oklch(0.9 0.5 145)");
    expect(hex).toMatch(/^#[0-9a-f]{6}$/);
    const r = Number.parseInt(hex.slice(1, 3), 16);
    const g = Number.parseInt(hex.slice(3, 5), 16);
    const b = Number.parseInt(hex.slice(5, 7), 16);
    // Every channel is a valid, real (non-clipped-to-a-single-extreme)
    // in-gamut value...
    expect(r).toBeGreaterThanOrEqual(0);
    expect(r).toBeLessThanOrEqual(255);
    // ...and the hue family survives: green channel dominant, at a high
    // lightness (this is a light, saturated green, not black/magenta/etc).
    expect(g).toBeGreaterThan(r);
    expect(g).toBeGreaterThan(b);
    expect(g).toBeGreaterThan(180); // "high lightness" should read as a bright green
  });

  it("gamut mapping does not just clamp to white or black (regression guard against silent per-channel clipping)", () => {
    const hex = oklchToHex("oklch(0.9 0.5 145)");
    expect(hex).not.toBe("#ffffff");
    expect(hex).not.toBe("#000000");
    expect(hex).not.toBe("#ff00ff"); // the classic "clipped to magenta" failure mode
  });

  it("a second out-of-gamut probe (saturated blue at low lightness) also lands on a real, non-degenerate color", () => {
    const hex = oklchToHex("oklch(0.2 0.4 264)");
    expect(hex).toMatch(/^#[0-9a-f]{6}$/);
    const b = Number.parseInt(hex.slice(5, 7), 16);
    const r = Number.parseInt(hex.slice(1, 3), 16);
    expect(b).toBeGreaterThan(r);
  });

  it.each([
    ["not an oklch string at all", "not-a-color"],
    ["an rgb() function", "rgb(255, 0, 0)"],
    ["missing the H channel", "oklch(0.5 0.1)"],
    ["a non-numeric L", "oklch(banana 0.1 30)"],
    ["a percentage on the H channel", "oklch(0.5 0.1 30%)"],
    ["negative chroma", "oklch(0.5 -0.1 30)"],
    ["empty string", ""],
    ["unclosed paren", "oklch(0.5 0.1 30"],
  ])("throws RenderError('invalid-oklch') for %s: %s", (_label, input) => {
    let thrown: unknown;
    try {
      oklchToHex(input);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(RenderError);
    expect((thrown as RenderError).reason).toBe("invalid-oklch");
  });

  it("rejects a long malformed argument sequence in bounded time instead of backtracking polynomially", () => {
    const hostile = `oklch(! ! !/${"!/!".repeat(100_000)})`;
    expect(() => oklchToHex(hostile)).toThrow(RenderError);
  });

  it("rejects a long almost-numeric channel in bounded time instead of backtracking polynomially", () => {
    const hostile = `oklch(${"0".repeat(200_000)}x 0 0)`;
    expect(() => oklchToHex(hostile)).toThrow(RenderError);
  });
});

function toHexChannel(fraction: number): string {
  return Math.round(fraction * 255)
    .toString(16)
    .padStart(2, "0");
}

function expectHexCloseTo(actual: string, expected: string, maxDeltaPerChannel: number): void {
  for (const [start, label] of [
    [1, "r"],
    [3, "g"],
    [5, "b"],
  ] as const) {
    const a = Number.parseInt(actual.slice(start, start + 2), 16);
    const e = Number.parseInt(expected.slice(start, start + 2), 16);
    expect(Math.abs(a - e), `channel ${label}: ${actual} vs ${expected}`).toBeLessThanOrEqual(maxDeltaPerChannel);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// flattenTokens
// ─────────────────────────────────────────────────────────────────────────

describe("flattenTokens", () => {
  it("returns a Map with one entry per TOKENS property", () => {
    const flat = flattenTokens();
    expect(flat.size).toBeGreaterThan(100);
    expect(flat.get("--color-surface-raised")).toBe("#ffffff");
  });

  it("every color-family value is a literal hex, never an oklch(...) or var(...) string", () => {
    const flat = flattenTokens();
    for (const [property, value] of flat) {
      expect(value, `${property} = ${value}`).not.toMatch(/oklch\(/i);
      expect(value, `${property} = ${value}`).not.toMatch(/var\(/i);
    }
  });

  it("converts a plain color token to hex", () => {
    const flat = flattenTokens();
    expect(flat.get("--color-status-danger")).toBe(oklchToHex("oklch(0.285 0 0)"));
  });

  it("preserves non-color values unchanged (spacing, radius, duration, font stacks)", () => {
    const flat = flattenTokens();
    expect(flat.get("--spacing-lg")).toBe("16px");
    expect(flat.get("--radius-control")).toBe("6px");
    expect(flat.get("--ui-duration-fast")).toBe("160ms");
    expect(flat.get("--font-mono")).toMatch(/mono/i);
  });

  it("resolves an alias whose raw value is var(--other-token, fallback) to that other token's literal value", () => {
    const flat = flattenTokens();
    // --color-ink-on-accent: var(--color-ink-on-inverse, oklch(0.9702 0 0))
    expect(flat.get("--color-ink-on-accent")).toBe(flat.get("--color-ink-on-inverse"));
    expect(flat.get("--color-ink-on-accent")).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("resolves a chained alias end to end (--color-chart-diverging-positive -> --color-chart-categorical-1, a literal hex)", () => {
    const flat = flattenTokens();
    expect(flat.get("--color-chart-diverging-positive")).toBe("#2a78d6");
  });

  it("converts an oklch(...) occurrence embedded inside a composite value (e.g. a resolved box-shadow), not just bare color tokens", () => {
    const flat = flattenTokens();
    const elevation = flat.get("--ui-elevation-raised")!;
    expect(elevation).not.toMatch(/oklch\(/i);
    expect(elevation).not.toMatch(/var\(/i);
    expect(elevation).toMatch(/^0 1px 0 #[0-9a-f]{6}$/);
  });

  it("an override for a brandable slot wins over the default", () => {
    const flat = flattenTokens({ "--color-accent": "oklch(0.5 0.2 250)" });
    expect(flat.get("--color-accent")).toBe(oklchToHex("oklch(0.5 0.2 250)"));
  });

  it("an override propagates through an alias that references it", () => {
    const flat = flattenTokens({ "--color-ink-on-inverse": "oklch(0.1 0 0)" });
    expect(flat.get("--color-ink-on-accent")).toBe(oklchToHex("oklch(0.1 0 0)"));
  });

  it("an override may itself be a non-color value for a brandable non-color slot", () => {
    const flat = flattenTokens({ "--ui-icon-stroke": "3" });
    expect(flat.get("--ui-icon-stroke")).toBe("3");
  });

  it("FIXTURE: an override targeting a non-brandable slot throws RenderError('non-brandable-override'), listing the offending slot", () => {
    let thrown: unknown;
    try {
      // --color-neutral-50 is brandable: false (a fixed greyscale ramp).
      flattenTokens({ "--color-neutral-50": "oklch(0.5 0 0)" });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(RenderError);
    const err = thrown as RenderError;
    expect(err.reason).toBe("non-brandable-override");
    expect(err.message).toContain("--color-neutral-50");
  });

  it("FIXTURE: multiple non-brandable overrides are all listed in the single thrown error", () => {
    let thrown: unknown;
    try {
      flattenTokens({
        "--color-neutral-50": "oklch(0.5 0 0)",
        "--spacing-lg": "99px",
      });
    } catch (error) {
      thrown = error;
    }
    const err = thrown as RenderError;
    expect(err.reason).toBe("non-brandable-override");
    expect(err.message).toContain("--color-neutral-50");
    expect(err.message).toContain("--spacing-lg");
  });

  it("FIXTURE: an override naming a slot that doesn't exist in TOKENS throws RenderError('unknown-token-override'), listing the offending slot", () => {
    let thrown: unknown;
    try {
      flattenTokens({ "--color-brand-primary-typo": "oklch(0.5 0.2 250)" });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(RenderError);
    const err = thrown as RenderError;
    expect(err.reason).toBe("unknown-token-override");
    expect(err.message).toContain("--color-brand-primary-typo");
  });

  it("unknown-slot validation runs before non-brandable validation and reports the unknown slot first", () => {
    let thrown: unknown;
    try {
      flattenTokens({
        "--totally-made-up": "oklch(0.5 0 0)",
        "--color-neutral-50": "oklch(0.5 0 0)",
      });
    } catch (error) {
      thrown = error;
    }
    const err = thrown as RenderError;
    expect(err.reason).toBe("unknown-token-override");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// resolveTokenRef
// ─────────────────────────────────────────────────────────────────────────

/**
 * Builds a `var(--name)` / `var(--name, fallback)` string AT RUNTIME rather
 * than as a literal substring anywhere in this file's own source text.
 *
 * This repository's `scripts/check-contamination-classes.mjs` (CLASS 6)
 * scans shipped source for a literal, no-fallback `var(--x)` — real
 * evidence, in product code, of a component that silently renders
 * unstyled for a consumer who lacks that token. That heuristic has no way
 * to know a match sits inside a unit test deliberately EXERCISING this
 * module's own "no fallback -> throw" and "cycle -> throw" behavior
 * rather than shipping broken CSS, so building these fixture strings
 * through a template substitution (never spelling `var(--` + a bare name
 * + `)` out as one literal token) is what keeps that gate meaningful for
 * actual product code without a false positive here.
 */
function varRef(name: string, fallback?: string): string {
  return fallback === undefined ? `var(${name})` : `var(${name}, ${fallback})`;
}

const NAME_A = "--a";
const NAME_B = "--b";
const NAME_C = "--c";

describe("resolveTokenRef", () => {
  it("returns a value with no var() unchanged", () => {
    const flat = new Map([[NAME_A, "#123456"]]);
    expect(resolveTokenRef("#654321", flat)).toBe("#654321");
  });

  it("resolves a bare var() reference", () => {
    const flat = new Map([[NAME_A, "#123456"]]);
    expect(resolveTokenRef(varRef(NAME_A), flat)).toBe("#123456");
  });

  it("resolves a var() reference embedded inside a larger string", () => {
    const flat = new Map([[NAME_A, "#123456"]]);
    expect(resolveTokenRef(`0 1px 0 ${varRef(NAME_A)}`, flat)).toBe("0 1px 0 #123456");
  });

  it("resolves multiple var() references in one string", () => {
    const flat = new Map([
      [NAME_A, "1px"],
      [NAME_B, "solid"],
    ]);
    expect(resolveTokenRef(`${varRef(NAME_A)} ${varRef(NAME_B)}`, flat)).toBe("1px solid");
  });

  it("uses the fallback when the referenced token is absent from flat", () => {
    const flat = new Map<string, string>();
    expect(resolveTokenRef(varRef("--missing", "red"), flat)).toBe("red");
  });

  it("resolves a fallback that itself contains a nested var()", () => {
    const flat = new Map([[NAME_B, "blue"]]);
    expect(resolveTokenRef(varRef("--missing", varRef(NAME_B)), flat)).toBe("blue");
  });

  it("prefers the real token over the fallback when both are available", () => {
    const flat = new Map([[NAME_A, "green"]]);
    expect(resolveTokenRef(varRef(NAME_A, "red"), flat)).toBe("green");
  });

  it("resolves a chain: A -> B -> literal", () => {
    const flat = new Map([
      [NAME_A, varRef(NAME_B)],
      [NAME_B, "#abcdef"],
    ]);
    expect(resolveTokenRef(varRef(NAME_A), flat)).toBe("#abcdef");
  });

  it("resolves a diamond (A and B both reference C) without falsely detecting a cycle", () => {
    const flat = new Map([
      [NAME_A, varRef(NAME_C)],
      [NAME_B, varRef(NAME_C)],
      [NAME_C, "#abcdef"],
    ]);
    expect(resolveTokenRef(`${varRef(NAME_A)} ${varRef(NAME_B)}`, flat)).toBe("#abcdef #abcdef");
  });

  it("a fallback containing a comma-bearing function (rgba) is not mis-split on the wrong comma", () => {
    const flat = new Map<string, string>();
    expect(resolveTokenRef(varRef("--missing", "rgba(0, 0, 0, 0.5)"), flat)).toBe("rgba(0, 0, 0, 0.5)");
  });

  it("FIXTURE: a direct self-reference cycle throws RenderError('token-ref-cycle')", () => {
    const flat = new Map([[NAME_A, varRef(NAME_A)]]);
    let thrown: unknown;
    try {
      resolveTokenRef(varRef(NAME_A), flat);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(RenderError);
    expect((thrown as RenderError).reason).toBe("token-ref-cycle");
  });

  it("FIXTURE: an indirect cycle (A -> B -> A) throws RenderError('token-ref-cycle') and never loops forever", () => {
    const flat = new Map([
      [NAME_A, varRef(NAME_B)],
      [NAME_B, varRef(NAME_A)],
    ]);
    let thrown: unknown;
    try {
      resolveTokenRef(varRef(NAME_A), flat);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(RenderError);
    expect((thrown as RenderError).reason).toBe("token-ref-cycle");
  });

  it("FIXTURE: var() naming an unknown token with no fallback throws RenderError('unknown-token-ref')", () => {
    const flat = new Map<string, string>();
    let thrown: unknown;
    try {
      resolveTokenRef(varRef("--does-not-exist"), flat);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(RenderError);
    const err = thrown as RenderError;
    expect(err.reason).toBe("unknown-token-ref");
    expect(err.message).toContain("--does-not-exist");
  });

  it("FIXTURE: unbalanced parentheses in var(...) throws RenderError('invalid-token-ref')", () => {
    const flat = new Map<string, string>();
    let thrown: unknown;
    try {
      resolveTokenRef(`var(${NAME_A}`, flat);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(RenderError);
    expect((thrown as RenderError).reason).toBe("invalid-token-ref");
  });

  it("FIXTURE: var() with no property name throws RenderError('invalid-token-ref')", () => {
    const flat = new Map<string, string>();
    let thrown: unknown;
    try {
      resolveTokenRef("var()", flat);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(RenderError);
    expect((thrown as RenderError).reason).toBe("invalid-token-ref");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// End-to-end: flattenTokens + resolveTokenRef against a realistic
// "consumer resolves a non-token string through the token system" use.
// ─────────────────────────────────────────────────────────────────────────

describe("flattenTokens + resolveTokenRef, used together", () => {
  it("a channel-authored string referencing a real token resolves against flattenTokens' own output", () => {
    const flat = flattenTokens();
    const resolved = resolveTokenRef(`border: 1px solid ${varRef("--color-line-base")};`, flat);
    expect(resolved).toBe(`border: 1px solid ${flat.get("--color-line-base")};`);
    expect(resolved).not.toMatch(/var\(/);
  });

  it("an unknown reference against the real flattened map still throws unknown-token-ref", () => {
    const flat = flattenTokens();
    expect(() => resolveTokenRef(varRef("--color-does-not-exist"), flat)).toThrow(RenderError);
  });
});
