import { TOKENS, type TokenDefinition } from "@vespeneventures/tokens";
import { describe, expect, it } from "vitest";
import { extractStyleCandidates } from "./style-scan.js";
import { checkTokenPurity } from "./token-gate.js";

// Hermetic: pure in-memory fixtures throughout — no filesystem, no network.
// `extractStyleCandidates` builds realistic `StyleCandidate[]` from real
// source text (with real `hasIgnoreMarker` derived from the actual line),
// the same way `copy-gate.test.ts` uses `extractCopyCandidates`, so these
// tests exercise the real seam between `style-scan.ts` and
// `token-gate.ts`, not a mocked one.

function candidatesFor(src: string, file = "x.ts") {
  const { candidates, unchecked } = extractStyleCandidates(src, file);
  return { candidates, unchecked };
}

const NO_TOKENS: Readonly<Record<string, TokenDefinition>> = {};

describe("checkTokenPurity — hardcodes-token-value (matches a real @vespeneventures/tokens entry)", () => {
  it("a hex color equal to --color-chart-categorical-1's real value is a hardcodes-token-value finding", () => {
    // Real value from packages/tokens/src/tokens.ts — calibrated against
    // the actual registry, not a hand-picked fake, the same way
    // copy-gate.test.ts calibrates against Pagination.tsx/Select.tsx/
    // Table.tsx's real lines.
    const { candidates, unchecked } = candidatesFor('const c = "#2a78d6";\n', "chart-vars.ts");
    const result = checkTokenPurity(candidates, TOKENS, 1, unchecked);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({ rule: "hardcodes-token-value", matchedToken: "--color-chart-categorical-1" });
  });

  it("a raw length equal to --spacing-lg's real value (16px) is a hardcodes-token-value finding — the real Icon.tsx shape", () => {
    const { candidates, unchecked } = candidatesFor('const sm = "var(--ui-icon-sm, var(--spacing-lg, 16px))";\n', "Icon.tsx");
    const result = checkTokenPurity(candidates, TOKENS, 1, unchecked);
    const lengthFindings = result.findings.filter((f) => f.matchedToken === "--spacing-lg");
    expect(lengthFindings).toHaveLength(1);
    expect(lengthFindings[0]).toMatchObject({ rule: "hardcodes-token-value" });
  });

  it("is case-insensitive when matching a hex value against the registry", () => {
    const { candidates, unchecked } = candidatesFor('const c = "#2A78D6";\n', "x.ts");
    const result = checkTokenPurity(candidates, TOKENS, 1, unchecked);
    expect(result.findings[0]).toMatchObject({ rule: "hardcodes-token-value", matchedToken: "--color-chart-categorical-1" });
  });
});

describe("checkTokenPurity — raw-value-no-token-backing", () => {
  it("a hex color with no matching token entry is raw-value-no-token-backing", () => {
    const { candidates, unchecked } = candidatesFor('const c = "#123abc";\n', "x.ts");
    const result = checkTokenPurity(candidates, TOKENS, 1, unchecked);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({ rule: "raw-value-no-token-backing" });
    expect(result.findings[0]?.matchedToken).toBeUndefined();
  });

  it("every candidate is raw-value-no-token-backing against an empty token registry", () => {
    const { candidates, unchecked } = candidatesFor('const c = "#2a78d6";\n', "x.ts");
    const result = checkTokenPurity(candidates, NO_TOKENS, 1, unchecked);
    expect(result.findings[0]).toMatchObject({ rule: "raw-value-no-token-backing" });
  });

  it('min-w-[12rem] (the real Toolbar.tsx shape) is a finding — a raw length with no token backing', () => {
    const { candidates, unchecked } = candidatesFor('<div className="min-w-[12rem]" />;\n', "Toolbar.tsx");
    const result = checkTokenPurity(candidates, TOKENS, 1, unchecked);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.message).toContain("12rem");
  });
});

describe("checkTokenPurity — the tw-arbitrary var() exception", () => {
  it("a bare var() reference with no fallback is clean, not a finding", () => {
    // "-N" suffix: this repository's own placeholder-name convention (see
    // scripts/check-contamination-classes.mjs's CLASS 6), used here so a
    // fallback-less var() in TEST DATA is never mistaken for the real
    // production defect that gate exists to catch.
    const { candidates, unchecked } = candidatesFor('<div className="w-[var(--ui-example-token-N)]" />;\n', "x.tsx");
    const result = checkTokenPurity(candidates, TOKENS, 1, unchecked);
    expect(result.findings).toEqual([]);
    expect(result.clean).toBe(1);
  });

  it("var(--x, <fallback>) is STILL a finding — the fallback is a real hardcode (the real Shell.tsx shape)", () => {
    const { candidates, unchecked } = candidatesFor(
      '<div className="w-[var(--ui-layout-sidebar-rail-w,64px)]" />;\n',
      "Shell.tsx",
    );
    const result = checkTokenPurity(candidates, TOKENS, 1, unchecked);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.message).toContain("64px");
  });

  it("bg-[#3b82f6] is a finding referencing the embedded hex color", () => {
    const { candidates, unchecked } = candidatesFor('<div className="bg-[#3b82f6]" />;\n', "x.tsx");
    const result = checkTokenPurity(candidates, TOKENS, 1, unchecked);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.message).toContain("#3b82f6");
  });
});

describe("checkTokenPurity — the gate-level unchecked extension", () => {
  it("a tw-arbitrary bracket that is neither var() nor a recognizable literal is unchecked, not a finding and not clean — the real content-['/'] shape", () => {
    const { candidates, unchecked: scanUnchecked } = candidatesFor(
      "<span className=\"not-last:after:content-['/']\" />;\n",
      "Breadcrumb.tsx",
    );
    const result = checkTokenPurity(candidates, TOKENS, 1, scanUnchecked);
    expect(result.findings).toEqual([]);
    expect(result.clean).toBe(0);
    expect(result.unchecked).toHaveLength(1);
    expect(result.unchecked[0]).toMatchObject({ kind: "unclassified-arbitrary-value" });
  });

  it("grid-cols-[auto_minmax(0,1fr)_auto] (the real Shell.tsx shape) is unchecked, not silently clean", () => {
    const { candidates, unchecked: scanUnchecked } = candidatesFor(
      '<div className="grid-cols-[auto_minmax(0,1fr)_auto]" />;\n',
      "Shell.tsx",
    );
    const result = checkTokenPurity(candidates, TOKENS, 1, scanUnchecked);
    expect(result.findings).toEqual([]);
    expect(result.unchecked).toHaveLength(1);
  });

  it("passes through style-scan.ts's own unchecked list unmodified", () => {
    const scanUnchecked = [{ file: "x.ts", line: 3, kind: "unterminated-color-function", detail: "test" }];
    const result = checkTokenPurity([], TOKENS, 1, scanUnchecked);
    expect(result.unchecked).toEqual(scanUnchecked);
  });
});

describe("checkTokenPurity — the waiver mechanism", () => {
  it("a token-gate:ignore marker suppresses the finding and is recorded in ignored", () => {
    const { candidates, unchecked } = candidatesFor('const c = "#123abc"; // token-gate:ignore deliberate\n', "x.ts");
    const result = checkTokenPurity(candidates, TOKENS, 1, unchecked);
    expect(result.findings).toEqual([]);
    expect(result.ignored).toHaveLength(1);
    expect(result.ignored[0]).toMatchObject({ file: "x.ts", line: 1 });
  });
});

describe("checkTokenPurity — accounting", () => {
  it("candidatesScanned and filesScanned are echoed through unchanged", () => {
    const { candidates, unchecked } = candidatesFor('const a = "#123abc";\nconst b = "13px";\n', "x.ts");
    const result = checkTokenPurity(candidates, TOKENS, 7, unchecked);
    expect(result.candidatesScanned).toBe(2);
    expect(result.filesScanned).toBe(7);
  });

  it("never throws on an empty candidate list", () => {
    expect(() => checkTokenPurity([], TOKENS, 0, [])).not.toThrow();
  });
});
