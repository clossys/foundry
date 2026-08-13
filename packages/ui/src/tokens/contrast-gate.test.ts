import { describe, expect, it } from "vitest";
import { TOKENS, type TokenDefinition } from "./tokens.js";
import { checkTokenContrast } from "./contrast-gate.js";
import { AA, AA_LARGE, CONTRAST_PAIRS, type ContrastPair } from "./contrast-pairs.js";

function def(property: string, value: string): TokenDefinition {
  return { property, family: "surface", value, brandable: false, themeDependent: false };
}

describe("checkTokenContrast", () => {
  it("never passes on zero pairs — reason: nothing-to-check, never ok: true", () => {
    const result = checkTokenContrast([], { tokens: TOKENS });
    expect(result.ok).toBe(false);
    expect(result.pairsChecked).toBe(0);
    expect(result.reason).toBe("nothing-to-check");
    expect(result.findings).toEqual([]);
    expect(result.unchecked).toEqual([]);
  });

  it("never passes against an empty token registry, even with real pairs supplied", () => {
    const result = checkTokenContrast(CONTRAST_PAIRS, { tokens: {} });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("nothing-to-check");
    // Fails closed WITHOUT reporting one "unresolvable-token" unchecked
    // entry per pair — see contrast-gate.ts's own header, "FAILS CLOSED
    // ON AN EMPTY RUN".
    expect(result.unchecked).toEqual([]);
  });

  it("is genuinely reachable as a clean pass: every non-categorical pair, against this package's real light-mode TOKENS, is ok", () => {
    // Excludes the categorical-mark pairs deliberately — see the next
    // test, "a currently-shipping pair that really fails", for why those
    // three specific slots do NOT belong in a "this is clean" fixture.
    const nonCategorical = CONTRAST_PAIRS.filter((p) => !p.id.startsWith("chart-categorical-"));
    const result = checkTokenContrast(nonCategorical, { tokens: TOKENS });
    expect(result.pairsChecked).toBe(nonCategorical.length);
    expect(result.unchecked).toEqual([]);
    expect(result.findings).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it("PROVES IT FAILS: a real, currently-shipping pair (light-mode categorical marks 3/4/5 on chart-surface) is reported below its 3:1 AA-large floor", () => {
    // This is not a synthetic fixture — these are this package's own real
    // --color-chart-categorical-3/4/5 values against the real
    // --color-chart-surface alias, exactly as shipped in
    // styles/tokens.css's light :root block. contrast.test.ts documents
    // the same three slots as an accepted "WARN" band (relief = mandatory
    // labels/legend/table, never color alone) — this gate does not know
    // about that relief rule, and correctly reports the plain WCAG
    // 1.4.11 threshold miss as a real finding rather than silently
    // agreeing with the test's exception list.
    const categoricalOnly = CONTRAST_PAIRS.filter((p) => p.id.startsWith("chart-categorical-"));
    const result = checkTokenContrast(categoricalOnly, { tokens: TOKENS });

    expect(result.unchecked).toEqual([]);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("contrast-gap");

    const failedIds = result.findings.map((f) => f.pairId).sort();
    expect(failedIds).toEqual([
      "chart-categorical-3/chart-surface",
      "chart-categorical-4/chart-surface",
      "chart-categorical-5/chart-surface",
    ]);
    for (const finding of result.findings) {
      expect(finding.rule).toBe("below-threshold");
      expect(finding.ratio).toBeLessThan(AA_LARGE);
      expect(finding.minimumRatio).toBe(AA_LARGE);
    }
  });

  it("reports a missing foreground/background token as unresolvable-token, not a thrown error or a silent skip", () => {
    const pairs: ContrastPair[] = [
      {
        id: "missing-fg/surface-base",
        foreground: "--does-not-exist",
        background: "--color-surface-base",
        level: "AA",
        minimumRatio: AA,
        description: "test fixture",
      },
    ];
    const result = checkTokenContrast(pairs, { tokens: TOKENS });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("contrast-gap");
    expect(result.findings).toEqual([]);
    expect(result.unchecked).toHaveLength(1);
    expect(result.unchecked[0]).toMatchObject({ pairId: "missing-fg/surface-base", reason: "unresolvable-token" });
  });

  it("reports a cyclic alias as cyclic-alias, terminating rather than looping", () => {
    const tokens: Readonly<Record<string, TokenDefinition>> = {
      "--a": def("--a", "var(--b, 0)"),
      "--b": def("--b", "var(--a, 0)"),
      "--color-surface-base": def("--color-surface-base", "oklch(0.97 0 0)"),
    };
    const pairs: ContrastPair[] = [
      { id: "a/surface-base", foreground: "--a", background: "--color-surface-base", level: "AA", minimumRatio: AA, description: "test fixture" },
    ];
    const result = checkTokenContrast(pairs, { tokens });
    expect(result.ok).toBe(false);
    expect(result.findings).toEqual([]);
    expect(result.unchecked).toHaveLength(1);
    expect(result.unchecked[0]).toMatchObject({ pairId: "a/surface-base", reason: "cyclic-alias" });
  });

  it("reports an unparseable color value as unparseable-color-value rather than throwing", () => {
    const tokens: Readonly<Record<string, TokenDefinition>> = {
      "--not-a-color": def("--not-a-color", "not-a-real-color-value"),
      "--color-surface-base": def("--color-surface-base", "oklch(0.97 0 0)"),
    };
    const pairs: ContrastPair[] = [
      {
        id: "bad/surface-base",
        foreground: "--not-a-color",
        background: "--color-surface-base",
        level: "AA",
        minimumRatio: AA,
        description: "test fixture",
      },
    ];
    expect(() => checkTokenContrast(pairs, { tokens })).not.toThrow();
    const result = checkTokenContrast(pairs, { tokens });
    expect(result.ok).toBe(false);
    expect(result.findings).toEqual([]);
    expect(result.unchecked).toHaveLength(1);
    expect(result.unchecked[0]).toMatchObject({ pairId: "bad/surface-base", reason: "unparseable-color-value" });
  });

  it("resolves a var() alias for foreground/background before scoring (--color-ink-on-accent, --color-chart-surface)", () => {
    const pairs: ContrastPair[] = [
      {
        id: "ink-on-accent/accent",
        foreground: "--color-ink-on-accent",
        background: "--color-accent",
        level: "AA",
        minimumRatio: AA,
        description: "test fixture",
      },
    ];
    const result = checkTokenContrast(pairs, { tokens: TOKENS });
    expect(result.unchecked).toEqual([]);
    expect(result.findings).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("composites over compositeOver before scoring (status text/tint pairs, real translucent tokens)", () => {
    const statusPairs = CONTRAST_PAIRS.filter((p) => p.id.startsWith("status-"));
    expect(statusPairs.length).toBeGreaterThan(0);
    const result = checkTokenContrast(statusPairs, { tokens: TOKENS });
    expect(result.unchecked).toEqual([]);
    expect(result.findings).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("defaults to this package's real TOKENS when no tokens option is supplied", () => {
    const onePair = [CONTRAST_PAIRS[0] as ContrastPair];
    const result = checkTokenContrast(onePair);
    expect(result.unchecked).toEqual([]);
    expect(result.pairsChecked).toBe(1);
  });
});
