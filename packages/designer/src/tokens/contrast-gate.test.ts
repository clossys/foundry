import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { parseRootDeclarations, parseDeclarationsForSelector } from "./internal/parse-css.js";
import { describe, expect, it } from "vitest";
import { TOKENS, type TokenDefinition } from "./tokens.js";
import { checkTokenContrast } from "./contrast-gate.js";
import { contrastRatio, contrastRatioEncodedBlend } from "./color.js";
import { AA, AA_LARGE, CONTRAST_PAIRS, contrastPairsForTheme, type ContrastException, type ContrastPair } from "./contrast-pairs.js";

const sourceDir = dirname(fileURLToPath(import.meta.url));

function def(property: string, value: string): TokenDefinition {
  return { property, family: "surface", value, brandable: false, themeDependent: false };
}

describe("checkTokenContrast", () => {
  describe("Ledger normal-text status labels", () => {
    it.each(["success", "warning", "danger", "info"])("rejects a small %s label between 3 and 4.5 on a ledger ground or plate", (tone) => {
      for (const surface of ["base", "sunken"]) {
        const foreground = `--color-status-${tone}-text`;
        const background = `--color-surface-${surface}`;
        const tokens = { ...TOKENS, [foreground]: def(foreground, "oklch(0.6 0 0)"), [background]: def(background, "oklch(1 0 0)") };
        const id = `ledger/status-${tone}-text/surface-${surface}`;
        const pairs = CONTRAST_PAIRS.filter(pair => pair.id === id);
        expect(pairs).toHaveLength(1);
        expect(checkTokenContrast(pairs, { tokens }).findings).toEqual([expect.objectContaining({ pairId: id, minimumRatio: AA, rule: "below-threshold" })]);
      }
    });
  });
  it("reuses AA inverse-primary pairs for ledger labels on inverse grounds and plates", () => {
    for (const surface of ["inverse", "inverse-raised"]) {
      const id = `link-grid/ink-on-inverse/surface-${surface}`;
      const pairs = CONTRAST_PAIRS.filter(pair => pair.id === id);
      expect(pairs).toHaveLength(1);
      expect(pairs[0]?.minimumRatio).toBe(AA);
      const foreground = "--color-ink-on-inverse";
      const background = `--color-surface-${surface}`;
      const tokens = { ...TOKENS, [foreground]: def(foreground, "oklch(0.6 0 0)"), [background]: def(background, "oklch(1 0 0)") };
      expect(checkTokenContrast(pairs, { tokens }).findings).toEqual([expect.objectContaining({ pairId: id, rule: "below-threshold", minimumRatio: AA })]);
    }
  });
  describe("LinkGrid body text and focus indicators", () => {
    it("rejects inverse raised copy below 4.5 even when the legacy icon check clears 3", () => {
      const tokens = { ...TOKENS, "--color-surface-inverse-raised": def("--color-surface-inverse-raised", "oklch(0.6 0 0)") };
      const legacy = CONTRAST_PAIRS.filter((pair) => pair.id === "ink-on-inverse/surface-inverse-raised");
      expect(checkTokenContrast(legacy, { tokens }).ok).toBe(true);
      const pairs = CONTRAST_PAIRS.filter((pair) => pair.id.startsWith("link-grid/") && pair.background === "--color-surface-inverse-raised" && pair.minimumRatio === AA);
      const result = checkTokenContrast(pairs, { tokens });
      expect(result.findings.map((finding) => finding.pairId).sort()).toEqual([
        "link-grid/ink-on-inverse-muted/surface-inverse-raised",
        "link-grid/ink-on-inverse/surface-inverse-raised",
      ]);
      expect(result.unchecked).toEqual([]);
    });

    it.each(["base", "sunken", "raised"])("rejects small secondary copy on surface-%s between 3 and 4.5", (surface) => {
      const background = `--color-surface-${surface}`;
      const tokens = { ...TOKENS, "--color-ink-secondary": def("--color-ink-secondary", "oklch(0.6 0 0)"), [background]: def(background, "oklch(1 0 0)") };
      const legacy = CONTRAST_PAIRS.filter((pair) => pair.id === `ink-secondary/surface-${surface}`);
      expect(checkTokenContrast(legacy, { tokens }).ok).toBe(true);
      const pairs = CONTRAST_PAIRS.filter((pair) => pair.id === `link-grid/ink-secondary/surface-${surface}`);
      expect(checkTokenContrast(pairs, { tokens }).findings).toEqual([
        expect.objectContaining({ pairId: `link-grid/ink-secondary/surface-${surface}`, minimumRatio: AA, rule: "below-threshold" }),
      ]);
    });

    it.each([
      ["accent", "base"], ["accent", "sunken"], ["accent", "raised"],
      ["accent-on-inverse", "inverse"], ["accent-on-inverse", "inverse-raised"],
    ])("rejects a %s focus indicator that blends into surface-%s", (accent, surface) => {
      const foreground = `--color-${accent}`;
      const background = `--color-surface-${surface}`;
      const tokens = { ...TOKENS, [foreground]: def(foreground, "oklch(0.6 0 0)"), [background]: def(background, "oklch(0.6 0 0)") };
      const id = `link-grid/${accent}/surface-${surface}`;
      const result = checkTokenContrast(CONTRAST_PAIRS.filter((pair) => pair.id === id), { tokens });
      expect(result.unchecked).toEqual([]);
      expect(result.findings).toEqual([expect.objectContaining({ pairId: id, ratio: 1, minimumRatio: AA_LARGE, rule: "below-threshold" })]);
    });
  });

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
    const categoricalOnly = CONTRAST_PAIRS.filter((p) => p.id.startsWith("chart-categorical-") && p.background === "--color-chart-surface");
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

  it("treats a compositeOver that is not a custom property as a literal backdrop color", () => {
    const pair = (over: string): ContrastPair => ({
      id: `glass@${over}`,
      foreground: "--color-ink-primary",
      background: "--color-surface-glass",
      compositeOver: over,
      level: "AA",
      minimumRatio: AA,
      description: "test fixture",
    });
    const passing = checkTokenContrast([pair("oklch(1 0 0)"), pair("oklch(0 0 0)")], { tokens: TOKENS });
    expect(passing.unchecked).toEqual([]);
    expect(passing.ok).toBe(true);
    // The literal really is the backdrop: a mostly clear glass over black fails, over white passes.
    const clear = { ...TOKENS, "--color-surface-glass": { ...TOKENS["--color-surface-glass"]!, value: "oklch(1 0 0 / 0.2)" } };
    const mixed = checkTokenContrast([pair("oklch(1 0 0)"), pair("oklch(0 0 0)")], { tokens: clear });
    expect(mixed.findings.map((f) => f.pairId)).toEqual(["glass@oklch(0 0 0)"]);
    // A malformed literal is reported unchecked, not scored.
    const malformed = checkTokenContrast([pair("not-a-color")], { tokens: TOKENS });
    expect(malformed.ok).toBe(false);
    expect(malformed.unchecked.map((u) => u.reason)).toEqual(["unparseable-color-value"]);
    // A translucent literal is refused rather than having its alpha silently dropped.
    const translucent = checkTokenContrast([pair("oklch(0 0 0 / 0.5)")], { tokens: TOKENS });
    expect(translucent.ok).toBe(false);
    expect(translucent.findings).toEqual([]);
    expect(translucent.unchecked).toHaveLength(1);
    expect(translucent.unchecked[0]?.reason).toBe("unparseable-color-value");
    expect(translucent.unchecked[0]?.detail).toContain("translucent");
  });

  it("scores a pair over a literal backdrop by the lower of a linear and a gamma-encoded (browser) blend", () => {
    const pair: ContrastPair = {
      id: "glass@black",
      foreground: "--color-ink-primary",
      background: "--color-surface-glass",
      compositeOver: "oklch(0 0 0)",
      level: "AA",
      minimumRatio: AA,
      description: "test fixture",
    };
    // Dark ink on a light 30% glass over black: a linear blend reads it as
    // passing, the browser's sRGB blend paints it far below AA.
    const glass = "oklch(1 0 0 / 0.3)";
    const ink = TOKENS["--color-ink-primary"]!.value;
    expect(contrastRatio(ink, glass, "oklch(0 0 0)")).toBeGreaterThan(AA);
    expect(contrastRatioEncodedBlend(ink, glass, "oklch(0 0 0)")).toBeLessThan(3);
    const tokens = { ...TOKENS, "--color-surface-glass": { ...TOKENS["--color-surface-glass"]!, value: glass } };
    const result = checkTokenContrast([pair], { tokens });
    expect(result.findings.map((f) => f.pairId)).toEqual(["glass@black"]);
    expect(result.findings[0]?.ratio).toBeCloseTo(contrastRatioEncodedBlend(ink, glass, "oklch(0 0 0)"), 10);
  });

  it("fails a literal-backdrop pair at 1:1 when an intermediate backdrop matches the ink under the browser's blend only", () => {
    // Gray ink of luminance ~0.30 on a white 50% plate. In linear light the
    // plate spans 0.50 (over black) to 1 (over white), above the ink; in the
    // gamma-encoded blend it spans ~0.21 to 1, which contains the ink. The
    // black extreme alone measures ~1.3:1, so 1:1 can only come from the
    // interval check, and only from its encoded half.
    const ink = "oklch(0.669 0 0)";
    const glass = "oklch(1 0 0 / 0.5)";
    const pair: ContrastPair = {
      id: "glass@black",
      foreground: "--color-ink-primary",
      background: "--color-surface-glass",
      compositeOver: "oklch(0 0 0)",
      level: "AA",
      minimumRatio: AA,
      description: "test fixture",
    };
    const endpoint = Math.min(contrastRatio(ink, glass, "oklch(0 0 0)"), contrastRatioEncodedBlend(ink, glass, "oklch(0 0 0)"));
    expect(endpoint).toBeGreaterThan(1.2);
    const tokens = {
      ...TOKENS,
      "--color-ink-primary": { ...TOKENS["--color-ink-primary"]!, value: ink },
      "--color-surface-glass": { ...TOKENS["--color-surface-glass"]!, value: glass },
    };
    const result = checkTokenContrast([pair], { tokens });
    expect(result.unchecked).toEqual([]);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.ratio).toBe(1);
    expect(result.findings[0]?.message).toContain("intermediate backdrop");
  });

  it("refuses a translucent foreground over a literal backdrop as unchecked rather than scoring the extremes", () => {
    const pair: ContrastPair = {
      id: "glass@white",
      foreground: "--color-ink-primary",
      background: "--color-surface-glass",
      compositeOver: "oklch(1 0 0)",
      level: "AA",
      minimumRatio: AA,
      description: "test fixture",
    };
    const tokens = { ...TOKENS, "--color-ink-primary": { ...TOKENS["--color-ink-primary"]!, value: "oklch(0.2178 0 0 / 0.9)" } };
    const result = checkTokenContrast([pair], { tokens });
    expect(result.ok).toBe(false);
    expect(result.findings).toEqual([]);
    expect(result.unchecked).toHaveLength(1);
    expect(result.unchecked[0]?.reason).toBe("unparseable-color-value");
    expect(result.unchecked[0]?.detail).toContain("must be opaque");
  });

  it("keeps the linear blend alone for a token backdrop, so token-composited pairs do not move", () => {
    const statusPair = CONTRAST_PAIRS.find((p) => p.id === "status-success-text/status-success-tint") as ContrastPair;
    const result = checkTokenContrast([{ ...statusPair, minimumRatio: 100 }], { tokens: TOKENS });
    const linear = contrastRatio(
      TOKENS["--color-status-success-text"]!.value,
      TOKENS["--color-status-success-tint"]!.value,
      TOKENS["--color-surface-base"]!.value,
    );
    expect(result.findings[0]?.ratio).toBe(linear);
  });

  it("defaults to this package's real TOKENS when no tokens option is supplied", () => {
    const onePair = [CONTRAST_PAIRS[0] as ContrastPair];
    const result = checkTokenContrast(onePair);
    expect(result.unchecked).toEqual([]);
    expect(result.pairsChecked).toBe(1);
  });
});

const VALID_EXCEPTION: ContrastException = {
  wcagClause: "WCAG 2.2 SC 1.4.11 (Non-text Contrast)",
  compensatingMechanism: "test fixture: a compensating mechanism.",
  rationale: "test fixture: a rationale.",
};

describe("checkTokenContrast — exceptions", () => {
  it("relieves the real light-mode categorical-3/4/5 WARN band instead of reporting it as a finding, via contrastPairsForTheme('light')", () => {
    // Same real, currently-shipping pairs the "PROVES IT FAILS" test above
    // checks — this time carrying the documented, theme-scoped relief
    // contrastPairsForTheme attaches. This is what makes designer-contrast-check
    // exit 0 against this package's own styles/tokens.css: the failures
    // are relieved, not hidden — see result.relieved below, which is
    // exactly as populated as the raw findings were in the un-excepted
    // version of this same check.
    const categoricalOnly = contrastPairsForTheme("light").filter((p) => p.id.startsWith("chart-categorical-") && p.background === "--color-chart-surface");
    const result = checkTokenContrast(categoricalOnly, { tokens: TOKENS });

    expect(result.unchecked).toEqual([]);
    expect(result.findings).toEqual([]);
    expect(result.ok).toBe(true);

    const relievedIds = result.relieved.map((r) => r.pairId).sort();
    expect(relievedIds).toEqual([
      "chart-categorical-3/chart-surface",
      "chart-categorical-4/chart-surface",
      "chart-categorical-5/chart-surface",
    ]);
    for (const r of result.relieved) {
      expect(r.ratio).toBeLessThan(AA_LARGE);
      expect(r.exception.wcagClause.length).toBeGreaterThan(0);
      expect(r.exception.compensatingMechanism.length).toBeGreaterThan(0);
      expect(r.exception.rationale.length).toBeGreaterThan(0);
    }
  });

  it("carries NO exception on any dark-mode categorical pair, since contrast.test.ts's own WARN_SLOTS_BY_THEME.dark is empty", () => {
    const darkCategorical = contrastPairsForTheme("dark").filter((p) => p.id.startsWith("chart-categorical-"));
    for (const pair of darkCategorical) {
      expect(pair.exception, `${pair.id} should carry no exception in dark theme`).toBeUndefined();
    }
  });

  it("PROVES THE STALE-EXCEPTION DIRECTION WORKS: a pair whose ratio actually clears its floor, while still carrying a valid exception, is a finding — not silently accepted", () => {
    // Same shape a real drift would take: the underlying token's value
    // changed enough to clear the floor on its own, but nobody removed
    // the now-unnecessary exception from the checked-in policy.
    const tokens: Readonly<Record<string, TokenDefinition>> = {
      "--fixed-mark": { property: "--fixed-mark", family: "chart", value: "#000000", brandable: false, themeDependent: false },
      "--fixed-surface": { property: "--fixed-surface", family: "surface", value: "#ffffff", brandable: false, themeDependent: false },
    };
    const pairs: ContrastPair[] = [
      {
        id: "fixed-mark/fixed-surface",
        foreground: "--fixed-mark",
        background: "--fixed-surface",
        level: "AA-large",
        minimumRatio: AA_LARGE,
        description: "test fixture",
        exception: VALID_EXCEPTION,
      },
    ];
    const result = checkTokenContrast(pairs, { tokens });

    expect(result.unchecked).toEqual([]);
    expect(result.relieved).toEqual([]); // NOT relieved — it doesn't need relief anymore
    expect(result.ok).toBe(false);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({ rule: "stale-exception", pairId: "fixed-mark/fixed-surface" });
    expect(result.findings[0]!.ratio).toBeGreaterThanOrEqual(AA_LARGE);
  });

  it("reports a pair whose exception is missing a required field as invalid-exception — regardless of the measured ratio", () => {
    const tokens: Readonly<Record<string, TokenDefinition>> = {
      "--dark-mark": { property: "--dark-mark", family: "chart", value: "#000000", brandable: false, themeDependent: false },
      "--light-surface": { property: "--light-surface", family: "surface", value: "#ffffff", brandable: false, themeDependent: false },
    };
    const pairs: ContrastPair[] = [
      {
        id: "dark-mark/light-surface",
        foreground: "--dark-mark",
        background: "--light-surface",
        level: "AA-large",
        minimumRatio: AA_LARGE,
        description: "test fixture",
        exception: { wcagClause: "WCAG 2.2 SC 1.4.11 (Non-text Contrast)", compensatingMechanism: "present", rationale: "   " }, // blank rationale
      },
    ];
    const result = checkTokenContrast(pairs, { tokens });

    expect(result.unchecked).toEqual([]);
    expect(result.relieved).toEqual([]);
    expect(result.ok).toBe(false);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({ rule: "invalid-exception", pairId: "dark-mark/light-surface" });
  });

  it("reports invalid-exception even for a pair that is ALSO genuinely below threshold (the exception is a defect on its own, independent of the ratio)", () => {
    const tokens: Readonly<Record<string, TokenDefinition>> = {
      "--near-white-mark": { property: "--near-white-mark", family: "chart", value: "#f5f5f5", brandable: false, themeDependent: false },
      "--white-surface": { property: "--white-surface", family: "surface", value: "#ffffff", brandable: false, themeDependent: false },
    };
    const pairs: ContrastPair[] = [
      {
        id: "near-white-mark/white-surface",
        foreground: "--near-white-mark",
        background: "--white-surface",
        level: "AA-large",
        minimumRatio: AA_LARGE,
        description: "test fixture",
        exception: { wcagClause: "", compensatingMechanism: "present", rationale: "present" }, // blank wcagClause
      },
    ];
    const result = checkTokenContrast(pairs, { tokens });

    expect(result.relieved).toEqual([]);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({ rule: "invalid-exception" });
  });
});


describe("Anatomy numeral contrast", () => {
  const pairs = CONTRAST_PAIRS.filter(pair => pair.id.startsWith("anatomy/"));
  const css = readFileSync(resolve(sourceDir, "../../styles/tokens.css"), "utf8");
  it.each(["light", "dark"] as const)("checks all four disc pairings against the real %s theme", theme => {
    const declarations = parseRootDeclarations(css);
    if (theme === "dark") for (const [key, value] of parseDeclarationsForSelector(css, ':root[data-theme="dark"]')) declarations.set(key, value);
    const tokens = Object.fromEntries(Object.entries(TOKENS).map(([key, token]) => [key, { ...token, value: declarations.get(key) ?? token.value }]));
    expect(pairs).toHaveLength(4);
    const result = checkTokenContrast(pairs, { tokens });
    expect(result.pairsChecked).toBe(4);
    expect(result.unchecked).toEqual([]);
    expect(result.findings).toEqual([]);
    expect(result.ok).toBe(true);
  });
  it("rejects numerals below the normal-text threshold", () => {
    for (const pair of pairs) {
      const tokens = { ...TOKENS, [pair.foreground]: def(pair.foreground, "oklch(0.6 0 0)"), [pair.background]: def(pair.background, "oklch(1 0 0)") };
      expect(checkTokenContrast([pair], { tokens }).findings).toEqual([expect.objectContaining({ pairId: pair.id, minimumRatio: AA, rule: "below-threshold" })]);
    }
  });
});

describe("Waterfall mark boundaries and divergent aliases", () => {
  const css = readFileSync(resolve(sourceDir, "../../styles/tokens.css"), "utf8");
  const expected = [
    ["waterfall/diverging-positive/surface-base", "--color-chart-diverging-positive", "--color-surface-base"],
    ["waterfall/diverging-positive/surface-sunken", "--color-chart-diverging-positive", "--color-surface-sunken"],
    ["waterfall/diverging-negative/surface-base", "--color-chart-diverging-negative", "--color-surface-base"],
    ["waterfall/diverging-negative/surface-sunken", "--color-chart-diverging-negative", "--color-surface-sunken"],
    ["waterfall/neutral-outline/surface-base", "--color-ink-secondary", "--color-surface-base"],
    ["waterfall/neutral-outline/surface-sunken", "--color-ink-secondary", "--color-surface-sunken"],
    ["waterfall/neutral-outline/diverging-neutral", "--color-ink-secondary", "--color-chart-diverging-neutral"],
  ] as const;

  function actualTokens(theme: "light" | "dark") {
    const declarations = parseRootDeclarations(css);
    if (theme === "dark") {
      for (const [key, value] of parseDeclarationsForSelector(css, ':root[data-theme="dark"]')) {
        declarations.set(key, value);
      }
    }
    return Object.fromEntries(Object.entries(TOKENS).map(([key, token]) => [
      key, { ...token, value: declarations.get(key) ?? token.value },
    ]));
  }

  it.each(["light", "dark"] as const)("checks seven real %s boundaries with no relief", theme => {
    const pairs = contrastPairsForTheme(theme).filter(pair => pair.id.startsWith("waterfall/"));
    expect(pairs.map(pair => pair.id).sort()).toEqual(expected.map(([id]) => id).sort());
    for (const [id, foreground, background] of expected) {
      expect(pairs.find(pair => pair.id === id)).toMatchObject({ id, foreground, background, minimumRatio: AA_LARGE });
    }
    expect(pairs.every(pair => pair.exception === undefined)).toBe(true);
    const result = checkTokenContrast(pairs, { tokens: actualTokens(theme) });
    expect(result.pairsChecked).toBe(7);
    expect(result.unchecked).toEqual([]);
    expect(result.findings).toEqual([]);
    expect(result.relieved).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it.each(["light", "dark"] as const)("rejects actual %s alias or perimeter drift", theme => {
    for (const [id, foreground, background] of expected) {
      const tokens = { ...actualTokens(theme), [foreground]: def(foreground, `var(${background})`) };
      const pairs = contrastPairsForTheme(theme).filter(pair => pair.id === id);
      expect(pairs).toHaveLength(1);
      const result = checkTokenContrast(pairs, { tokens });
      expect(result.unchecked).toEqual([]);
      expect(result.relieved).toEqual([]);
      expect(result.findings).toEqual([
        expect.objectContaining({ pairId: id, rule: "below-threshold", minimumRatio: AA_LARGE }),
      ]);
      expect(result.findings[0]?.ratio).toBeCloseTo(1, 10);
      expect(result.ok).toBe(false);
    }
  });
});

describe("Range status glyph boundaries and reused text/series policy", () => {
  const css = readFileSync(resolve(sourceDir, "../../styles/tokens.css"), "utf8");
  const added = [
    ["range/status-danger/surface-base", "--color-status-danger", "--color-surface-base"],
    ["range/status-danger/surface-sunken", "--color-status-danger", "--color-surface-sunken"],
    ["range/status-warning/surface-sunken", "--color-status-warning", "--color-surface-sunken"],
    ["range/status-info/surface-sunken", "--color-status-info", "--color-surface-sunken"],
    ["range/status-success-outline/surface-base", "--color-ink-secondary", "--color-surface-base"],
    ["range/status-success-outline/surface-sunken", "--color-ink-secondary", "--color-surface-sunken"],
  ] as const;
  const reused = [
    ...(["success", "warning", "danger", "info"] as const).flatMap(tone =>
      (["base", "sunken"] as const).map(ground => ({
        id: `ledger/status-${tone}-text/surface-${ground}`,
        foreground: `--color-status-${tone}-text`, background: `--color-surface-${ground}`,
        minimumRatio: AA,
      }))),
    ...(["base", "sunken"] as const).flatMap(ground => [
      { id: `chart-inline-axis-label/surface-${ground}`, foreground: "--color-ink-secondary",
        background: `--color-surface-${ground}`, minimumRatio: AA },
      { id: `chart-categorical-1/surface-${ground}`, foreground: "--color-chart-categorical-1",
        background: `--color-surface-${ground}`, minimumRatio: AA_LARGE },
      { id: `ink-muted/surface-${ground}`, foreground: "--color-ink-muted",
        background: `--color-surface-${ground}`, minimumRatio: ground === "base" ? AA : AA_LARGE },
    ]),
    ...(["success", "warning", "info"] as const).map(tone => ({
      id: `status-${tone}/surface-base`, foreground: `--color-status-${tone}`,
      background: "--color-surface-base", minimumRatio: AA_LARGE,
    })),
  ];

  function actualTokens(theme: "light" | "dark") {
    const declarations = parseRootDeclarations(css);
    if (theme === "dark") {
      for (const [key, value] of parseDeclarationsForSelector(css, ':root[data-theme="dark"]')) {
        declarations.set(key, value);
      }
    }
    // Every involved property must actually exist in the shipped CSS;
    // TOKENS supplies registry metadata, never a missing-CSS color fallback.
    const properties = new Set([
      ...added.flatMap(([, foreground, background]) => [foreground, background]),
      ...reused.flatMap(pair => [pair.foreground, pair.background]),
    ]);
    for (const property of properties) expect(declarations.has(property), property).toBe(true);
    return Object.fromEntries(Object.entries(TOKENS).map(([key, token]) => [
      key, { ...token, value: declarations.get(key) ?? token.value },
    ]));
  }

  it.each(["light", "dark"] as const)("requires six actual %s glyph pairs with no relief", theme => {
    const pairs = contrastPairsForTheme(theme).filter(pair => pair.id.startsWith("range/"));
    expect(pairs.map(pair => pair.id).sort()).toEqual(added.map(([id]) => id).sort());
    for (const [id, foreground, background] of added) {
      expect(pairs.find(pair => pair.id === id)).toMatchObject({
        id, foreground, background, level: "AA-large", minimumRatio: AA_LARGE,
      });
    }
    expect(pairs.every(pair => pair.exception === undefined)).toBe(true);
    const result = checkTokenContrast(pairs, { tokens: actualTokens(theme) });
    expect(result.pairsChecked).toBe(6);
    expect(result.unchecked).toEqual([]);
    expect(result.findings).toEqual([]);
    expect(result.relieved).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it.each(["light", "dark"] as const)("retains every existing %s status-text, neutral and slot-1 floor", theme => {
    const policy = contrastPairsForTheme(theme);
    const pairs = reused.map(expected => {
      const matches = policy.filter(pair => pair.id === expected.id);
      expect(matches).toHaveLength(1);
      expect(matches[0]).toMatchObject(expected);
      expect(matches[0]?.exception).toBeUndefined();
      return matches[0]!;
    });
    expect(pairs).toHaveLength(17);
    const result = checkTokenContrast(pairs, { tokens: actualTokens(theme) });
    expect(result.pairsChecked).toBe(17);
    expect(result.unchecked).toEqual([]);
    expect(result.findings).toEqual([]);
    expect(result.relieved).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it.each(["light", "dark"] as const)("rejects every %s glyph foreground rebound to its ground", theme => {
    for (const [id, foreground, background] of added) {
      const pairs = contrastPairsForTheme(theme).filter(pair => pair.id === id);
      expect(pairs).toHaveLength(1);
      const tokens = { ...actualTokens(theme), [foreground]: def(foreground, `var(${background})`) };
      const result = checkTokenContrast(pairs, { tokens });
      expect(result.unchecked).toEqual([]);
      expect(result.relieved).toEqual([]);
      expect(result.findings).toEqual([
        expect.objectContaining({ pairId: id, rule: "below-threshold", minimumRatio: AA_LARGE }),
      ]);
      expect(result.findings[0]?.ratio).toBeCloseTo(1, 10);
      expect(result.ok).toBe(false);
    }
  });

  it.each(["light", "dark"] as const)("rejects a near-ground %s success perimeter on sunken", theme => {
    const id = "range/status-success-outline/surface-sunken";
    const pairs = contrastPairsForTheme(theme).filter(pair => pair.id === id);
    expect(pairs).toHaveLength(1);
    const tokens = { ...actualTokens(theme),
      "--color-ink-secondary": def("--color-ink-secondary", theme === "light" ? "oklch(0.93 0 0)" : "oklch(0.16 0 0)"),
    };
    const result = checkTokenContrast(pairs, { tokens });
    expect(result.unchecked).toEqual([]);
    expect(result.relieved).toEqual([]);
    expect(result.findings).toEqual([
      expect.objectContaining({ pairId: id, rule: "below-threshold", minimumRatio: AA_LARGE }),
    ]);
    expect(result.findings[0]?.ratio).toBeLessThan(1.1);
    expect(result.ok).toBe(false);
  });
});
