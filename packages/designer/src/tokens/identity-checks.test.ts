import { describe, expect, it } from "vitest";
import {
  checkClearSpace,
  checkIdentityContrast,
  checkMinimumSize,
  checkSingleColourLegibility,
  IDENTITY_MIN_CONTRAST,
  identityKitReport,
  judgeIdentityKit,
} from "./identity-checks.js";
import { generateIdentityDirections, type IdentityTokenInput, type IdentityVariantSet } from "./identity-kit.js";

// checkIdentityContrast's primary/mark pairing only reads `variants` for an
// "adopted" direction (it needs the adopted mark's own rendered colour);
// for every other kind it is unused, so a non-adopted-kind test can pass an
// empty stand-in rather than building a full variant set.
const UNUSED_VARIANTS = {} as IdentityVariantSet;

const PASSING_TOKENS: IdentityTokenInput = {
  ink: "oklch(0.2178 0 0)",
  onInverse: "oklch(0.9702 0 0)",
  surfaceBase: "oklch(0.9702 0 0)",
  surfaceInverse: "oklch(0.2178 0 0)",
  accent: "oklch(0.2178 0 0)",
  onAccent: "oklch(0.9702 0 0)",
  fontFamily: "system-ui, sans-serif",
};

const FAILING_TOKENS: IdentityTokenInput = {
  ...PASSING_TOKENS,
  ink: "oklch(0.9 0 0)",
  surfaceBase: "oklch(0.91 0 0)",
  onInverse: "oklch(0.5 0 0)",
  surfaceInverse: "oklch(0.52 0 0)",
  accent: "oklch(0.5 0 0)",
  onAccent: "oklch(0.51 0 0)",
};

describe("checkIdentityContrast", () => {
  it("is satisfied when every pair clears the floor", () => {
    const result = checkIdentityContrast("wordmark", UNUSED_VARIANTS, PASSING_TOKENS);
    expect(result.ok).toBe(true);
    expect(result.indeterminate).toBe(false);
    expect(result.checked).toHaveLength(4);
    expect(result.findings).toHaveLength(0);
  });

  it("reports a finding for every pair below the floor", () => {
    const result = checkIdentityContrast("wordmark", UNUSED_VARIANTS, FAILING_TOKENS);
    expect(result.ok).toBe(false);
    expect(result.indeterminate).toBe(false);
    expect(result.findings.length).toBeGreaterThan(0);
    for (const finding of result.findings) {
      expect(finding.ratio).toBeLessThan(IDENTITY_MIN_CONTRAST);
    }
  });

  it("is indeterminate, not a pass, when a colour cannot be parsed", () => {
    const result = checkIdentityContrast("wordmark", UNUSED_VARIANTS, { ...PASSING_TOKENS, ink: "not-a-colour" });
    expect(result.indeterminate).toBe(true);
    expect(result.ok).toBe(false);
  });

  describe("for an adopted direction", () => {
    it("uses the adopted mark's own actual rendered colour, not the ink token, and flags a real contrast failure the token pairing would hide", () => {
      // The design tokens' own ink/surfaceBase pairing is fine (dark ink on
      // a light surface, satisfied under the old tokens-only check). The
      // supplied mark itself, however, is painted white -- nearly the same
      // colour as the light surfaceBase it sits on -- which is the real
      // defect: before this fix, checkIdentityContrast(tokens) certified
      // contrast using tokens.ink (never actually written into an adopted
      // primary/mark) instead of the mark's own colour, so this would have
      // been reported "satisfied".
      const adoptedVariants = {
        primary: '<svg viewBox="0 0 24 24"><path fill="#ffffff" d="M0 0h24v24H0z" /></svg>',
        mark: '<svg viewBox="0 0 24 24"><path fill="#ffffff" d="M0 0h24v24H0z" /></svg>',
      } as IdentityVariantSet;
      const result = checkIdentityContrast("adopted", adoptedVariants, PASSING_TOKENS);
      expect(result.indeterminate).toBe(false);
      expect(result.ok).toBe(false);
      const primaryFinding = result.findings.find((f) => f.variant === "primary");
      expect(primaryFinding).toBeDefined();
      expect(primaryFinding!.ratio).toBeLessThan(IDENTITY_MIN_CONTRAST);
    });

    it("is indeterminate, never silently satisfied, when the adopted mark has no explicit fill/stroke colour to check", () => {
      const adoptedVariants = {
        primary: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M0 0h24v24H0z" /></svg>',
        mark: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M0 0h24v24H0z" /></svg>',
      } as IdentityVariantSet;
      const result = checkIdentityContrast("adopted", adoptedVariants, PASSING_TOKENS);
      expect(result.indeterminate).toBe(true);
      expect(result.ok).toBe(false);
      expect(result.findings.some((f) => f.variant === "primary" && Number.isNaN(f.ratio))).toBe(true);
    });
  });
});

describe("checkMinimumSize", () => {
  it("is satisfied when the finest stroke clears the ratio floor", () => {
    const svg = '<svg viewBox="0 0 48 48"><circle stroke-width="2" /></svg>';
    const result = checkMinimumSize(svg);
    expect(result.ok).toBe(true);
    expect(result.indeterminate).toBe(false);
  });

  it("is violated when the finest stroke is too thin a sliver of the viewBox", () => {
    const svg = '<svg viewBox="0 0 480 480"><circle stroke-width="2" /></svg>';
    const result = checkMinimumSize(svg);
    expect(result.ok).toBe(false);
    expect(result.indeterminate).toBe(false);
    expect(result.reason).toMatch(/legibility floor/);
  });

  it("is indeterminate when there is no viewBox", () => {
    const result = checkMinimumSize('<svg><circle stroke-width="2" /></svg>');
    expect(result.indeterminate).toBe(true);
    expect(result.ok).toBe(false);
  });

  it("is indeterminate when there is no stroke-width to measure", () => {
    const result = checkMinimumSize('<svg viewBox="0 0 48 48"><path fill="currentColor" /></svg>');
    expect(result.indeterminate).toBe(true);
    expect(result.ok).toBe(false);
  });

  it("is indeterminate for a nested <svg>'s viewBox — the root element itself declares none (issue #1320 item 1)", () => {
    // Before the fix, `svg.match(/viewBox="..."/)` was a whole-document
    // search: a nested <svg viewBox="0 0 480 480"> would satisfy it even
    // though the ROOT element carries no viewBox at all.
    const svg = '<svg><g><svg viewBox="0 0 480 480"></svg></g><circle stroke-width="2" /></svg>';
    const result = checkMinimumSize(svg);
    expect(result.indeterminate).toBe(true);
    expect(result.ok).toBe(false);
  });
});

describe("checkClearSpace", () => {
  it("is satisfied when the declared ratio clears the minimum", () => {
    const result = checkClearSpace('<svg data-clear-space="0.2"></svg>');
    expect(result).toEqual({ ok: true, indeterminate: false, declared: 0.2 });
  });

  it("is violated when the declared ratio is below the minimum", () => {
    const result = checkClearSpace('<svg data-clear-space="0.05"></svg>');
    expect(result.ok).toBe(false);
    expect(result.indeterminate).toBe(false);
  });

  it("is indeterminate when nothing is declared", () => {
    const result = checkClearSpace("<svg></svg>");
    expect(result.indeterminate).toBe(true);
    expect(result.ok).toBe(false);
  });

  it("is indeterminate for a nested <svg>'s or a descendant's data-clear-space — the root element itself declares none (issue #1320 item 1)", () => {
    // Before the fix, `svg.match(/data-clear-space="..."/)` was a
    // whole-document search: a nested <svg data-clear-space="0.2"> (or any
    // descendant carrying the attribute) would satisfy it even though the
    // ROOT element declares nothing.
    const svg = '<svg><g><svg data-clear-space="0.2"></svg></g><rect data-clear-space="0.2" /></svg>';
    const result = checkClearSpace(svg);
    expect(result.indeterminate).toBe(true);
    expect(result.ok).toBe(false);
  });
});

describe("checkSingleColourLegibility", () => {
  it("is satisfied when only currentColor/none appear", () => {
    const result = checkSingleColourLegibility('<svg><path fill="currentColor" stroke="none" /></svg>');
    expect(result).toEqual({ ok: true, offendingColors: [] });
  });

  it("reports every distinct explicit colour left over", () => {
    const result = checkSingleColourLegibility('<svg><path fill="#fff" /><path stroke="oklch(0.5 0 0)" /></svg>');
    expect(result.ok).toBe(false);
    expect(result.offendingColors.sort()).toEqual(["#fff", "oklch(0.5 0 0)"]);
  });

  it("catches a single-quoted or spaced fill/stroke attribute, and never mistakes data-fill for one (issue #1320 item 5)", () => {
    const result = checkSingleColourLegibility("<svg><path fill = '#fff' data-fill=\"#000\" /></svg>");
    expect(result.ok).toBe(false);
    expect(result.offendingColors).toEqual(["#fff"]);
  });
});

describe("judgeIdentityKit", () => {
  it("is fully satisfied for a generated direction and passing tokens", () => {
    const [direction] = generateIdentityDirections({ name: "Acme Rockets" }, PASSING_TOKENS);
    const judgement = judgeIdentityKit(direction!, PASSING_TOKENS);
    expect(judgement.ok).toBe(true);
    expect(judgement.verdict).toBe("satisfied");
    expect(judgement.findings).toEqual([]);
    for (const check of Object.values(judgement.checks)) {
      expect(check.verdict).toBe("satisfied");
      expect(check.findings).toEqual([]);
    }
  });

  it("reports contrast as violated (not indeterminate) when the pairing genuinely fails, and rolls it up into the overall verdict/findings", () => {
    const [direction] = generateIdentityDirections({ name: "Acme Rockets" }, FAILING_TOKENS);
    const judgement = judgeIdentityKit(direction!, FAILING_TOKENS);
    expect(judgement.ok).toBe(false);
    expect(judgement.checks.contrast.verdict).toBe("violated");
    expect(judgement.verdict).toBe("violated");
    expect(judgement.findings.length).toBeGreaterThan(0);
    for (const finding of judgement.findings) {
      expect(finding.severity).toBe("error");
      expect(typeof finding.message).toBe("string");
    }
    expect(judgement.checks.contrast.findings.every((f) => f.rule === "contrast")).toBe(true);
  });

  it("overall verdict is indeterminate whenever any check is indeterminate, even alongside a violated one", () => {
    const [direction] = generateIdentityDirections({ name: "Acme Rockets" }, FAILING_TOKENS);
    const judgement = judgeIdentityKit(direction!, { ...FAILING_TOKENS, ink: "not-a-colour" });
    expect(judgement.checks.contrast.verdict).toBe("indeterminate");
    expect(judgement.verdict).toBe("indeterminate");
  });
});

describe("identityKitReport", () => {
  it("builds a satisfied report with no findings for a generated direction and passing tokens", () => {
    const [direction] = generateIdentityDirections({ name: "Acme Rockets" }, PASSING_TOKENS);
    const report = identityKitReport(direction!, PASSING_TOKENS, "0.5.0");
    expect(report).toMatchObject({ package: "@clossys/designer", version: "0.5.0", verdict: "satisfied", findings: [] });
    expect(report.nextAction).toBeUndefined();
    expect(typeof report.summary).toBe("string");
  });

  it("carries a nextAction and non-empty findings for a violated direction", () => {
    const [direction] = generateIdentityDirections({ name: "Acme Rockets" }, FAILING_TOKENS);
    const report = identityKitReport(direction!, FAILING_TOKENS, "0.5.0");
    expect(report.verdict).toBe("violated");
    expect(report.findings.length).toBeGreaterThan(0);
    expect(typeof report.nextAction).toBe("string");
  });
});
