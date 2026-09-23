import { describe, expect, it } from "vitest";
import {
  checkClearSpace,
  checkIdentityContrast,
  checkMinimumSize,
  checkSingleColourLegibility,
  IDENTITY_MIN_CONTRAST,
  judgeIdentityKit,
} from "./identity-checks.js";
import { generateIdentityDirections, type IdentityTokenInput } from "./identity-kit.js";

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
    const result = checkIdentityContrast(PASSING_TOKENS);
    expect(result.ok).toBe(true);
    expect(result.indeterminate).toBe(false);
    expect(result.checked).toHaveLength(4);
    expect(result.findings).toHaveLength(0);
  });

  it("reports a finding for every pair below the floor", () => {
    const result = checkIdentityContrast(FAILING_TOKENS);
    expect(result.ok).toBe(false);
    expect(result.indeterminate).toBe(false);
    expect(result.findings.length).toBeGreaterThan(0);
    for (const finding of result.findings) {
      expect(finding.ratio).toBeLessThan(IDENTITY_MIN_CONTRAST);
    }
  });

  it("is indeterminate, not a pass, when a colour cannot be parsed", () => {
    const result = checkIdentityContrast({ ...PASSING_TOKENS, ink: "not-a-colour" });
    expect(result.indeterminate).toBe(true);
    expect(result.ok).toBe(false);
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
});

describe("judgeIdentityKit", () => {
  it("is fully satisfied for a generated direction and passing tokens", () => {
    const [direction] = generateIdentityDirections({ name: "Acme Rockets" }, PASSING_TOKENS);
    const judgement = judgeIdentityKit(direction!, PASSING_TOKENS);
    expect(judgement.ok).toBe(true);
    for (const check of Object.values(judgement.checks)) {
      expect(check.verdict).toBe("satisfied");
    }
  });

  it("reports contrast as violated (not indeterminate) when the pairing genuinely fails", () => {
    const [direction] = generateIdentityDirections({ name: "Acme Rockets" }, FAILING_TOKENS);
    const judgement = judgeIdentityKit(direction!, FAILING_TOKENS);
    expect(judgement.ok).toBe(false);
    expect(judgement.checks.contrast.verdict).toBe("violated");
  });
});
