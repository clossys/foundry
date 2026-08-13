import { TOKENS, type TokenDefinition } from "./tokens/index.js";
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

describe("checkTokenPurity — hardcodes-token-value (a BARE literal matching a real token entry)", () => {
  it("a hex color equal to --color-chart-categorical-1's real value is a hardcodes-token-value finding, severity error", () => {
    // Real value from src/tokens/tokens.ts — calibrated against
    // the actual registry, not a hand-picked fake, the same way
    // copy-gate.test.ts calibrates against Pagination.tsx/Select.tsx/
    // Table.tsx's real lines.
    const { candidates, unchecked } = candidatesFor('const c = "#2a78d6";\n', "chart-vars.ts");
    const result = checkTokenPurity(candidates, TOKENS, 1, unchecked);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({
      rule: "hardcodes-token-value",
      severity: "error",
      matchedToken: "--color-chart-categorical-1",
    });
  });

  it("is case-insensitive when matching a hex value against the registry", () => {
    const { candidates, unchecked } = candidatesFor('const c = "#2A78D6";\n', "x.ts");
    const result = checkTokenPurity(candidates, TOKENS, 1, unchecked);
    expect(result.findings[0]).toMatchObject({ rule: "hardcodes-token-value", matchedToken: "--color-chart-categorical-1" });
  });
});

describe("checkTokenPurity — raw-value-no-token-backing (a BARE literal with no matching entry)", () => {
  it("a hex color with no matching token entry is raw-value-no-token-backing, severity error", () => {
    const { candidates, unchecked } = candidatesFor('const c = "#123abc";\n', "x.ts");
    const result = checkTokenPurity(candidates, TOKENS, 1, unchecked);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({ rule: "raw-value-no-token-backing", severity: "error" });
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

// A finding's message names the registry it actually checked. Before this,
// every message hardcoded "@vespeneventures/ui/tokens" regardless of what
// was passed as `tokens` — actively wrong for exactly the caller-supplied-
// registry use case checkTokenPurity's own `tokens` parameter exists for.
describe("checkTokenPurity — registryLabel (which registry a finding's message names)", () => {
  it("defaults to '@vespeneventures/ui/tokens' when omitted — every existing caller's message is unchanged", () => {
    const { candidates, unchecked } = candidatesFor('const c = "#123abc";\n', "x.ts");
    const result = checkTokenPurity(candidates, NO_TOKENS, 1, unchecked);
    expect(result.findings[0]?.message).toContain("@vespeneventures/ui/tokens");
  });

  it("names a caller-supplied label instead, for a BARE literal with no token backing", () => {
    const { candidates, unchecked } = candidatesFor('const c = "#123abc";\n', "x.ts");
    const result = checkTokenPurity(candidates, NO_TOKENS, 1, unchecked, "consumer-tokens.json");
    expect(result.findings[0]?.message).toContain("consumer-tokens.json");
    expect(result.findings[0]?.message).not.toContain("@vespeneventures/ui/tokens");
  });

  it("names a caller-supplied label instead, for a var() FALLBACK literal whose property isn't in the registry", () => {
    const { candidates, unchecked } = candidatesFor('const c = "var(--nonexistent-token, 4px)";\n', "x.ts");
    const result = checkTokenPurity(candidates, NO_TOKENS, 1, unchecked, "consumer-tokens.json");
    expect(result.findings[0]?.message).toContain("consumer-tokens.json");
    expect(result.findings[0]?.message).not.toContain("@vespeneventures/ui/tokens");
  });
});

describe("checkTokenPurity — token-value-duplicated-in-fallback (a var() FALLBACK literal, not a bare one)", () => {
  it("the real Icon.tsx shape: var(--ui-icon-sm, var(--spacing-lg, 16px)) attributes 16px to --spacing-lg (the INNERMOST var), not --ui-icon-sm, and never as hardcodes-token-value", () => {
    const { candidates, unchecked } = candidatesFor('const sm = "var(--ui-icon-sm, var(--spacing-lg, 16px))";\n', "Icon.tsx");
    const result = checkTokenPurity(candidates, TOKENS, 1, unchecked);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({
      rule: "token-value-duplicated-in-fallback",
      severity: "warning",
      matchedToken: "--spacing-lg",
    });
    expect(result.findings[0]?.message).toContain("--spacing-lg");
    expect(result.findings[0]?.message).not.toContain("--ui-icon-sm");
    // The circular remedy this rule replaces ("read it via var(--spacing-lg)
    // ... instead of the literal") must never appear for a fallback finding
    // — the code already reads it via var(--spacing-lg).
    expect(result.findings[0]?.message).not.toContain("read it via");
  });

  it("a synthetic doubly-nested chain var(--a, var(--b, 16px)) resolves to --b, never --a — the general shape the Icon.tsx case is one instance of", () => {
    const { candidates, unchecked } = candidatesFor(
      'const x = "var(--example-outer-N, var(--example-inner-N, 16px))";\n',
      "x.ts",
    );
    const result = checkTokenPurity(candidates, TOKENS, 1, unchecked);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.matchedToken).toBeUndefined(); // neither placeholder name is a real token
    expect(result.findings[0]?.message).toContain("--example-inner-N");
    expect(result.findings[0]?.message).not.toContain("--example-outer-N");
  });

  it("var(--x, <fallback>) is STILL a finding, but as token-value-duplicated-in-fallback/warning, not hardcodes-token-value/error — the real Shell.tsx shape", () => {
    const { candidates, unchecked } = candidatesFor(
      '<div className="w-[var(--ui-layout-sidebar-rail-w,64px)]" />;\n',
      "Shell.tsx",
    );
    const result = checkTokenPurity(candidates, TOKENS, 1, unchecked);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({
      rule: "token-value-duplicated-in-fallback",
      severity: "warning",
      matchedToken: "--ui-layout-sidebar-rail-w",
    });
    expect(result.findings[0]?.message).toContain("64px");
  });

  it("a literal wrapped by a NON-var function (clamp) inside a var() fallback still resolves to the enclosing var — the real shell-vars.ts UI_WIDTH_PAGE_PADDING_X shape", () => {
    const { candidates, unchecked } = candidatesFor(
      'export const X = "var(--ui-width-page-padding-x, clamp(16px, 4vw, 48px))";\n',
      "shell-vars.ts",
    );
    const result = checkTokenPurity(candidates, TOKENS, 1, unchecked);
    expect(result.findings).toHaveLength(3); // 16px, 4vw, 48px
    for (const f of result.findings) {
      expect(f).toMatchObject({ rule: "token-value-duplicated-in-fallback", matchedToken: "--ui-width-page-padding-x" });
    }
  });

  it("reports 'currently matches' when the fallback agrees with the token's real declared value", () => {
    const { candidates, unchecked } = candidatesFor('const x = "var(--spacing-lg, 16px)";\n', "x.ts");
    const result = checkTokenPurity(candidates, TOKENS, 1, unchecked);
    expect(result.findings[0]?.message).toContain("currently matches");
  });

  it("reports 'already drifted' when the fallback does NOT match the token's real declared value", () => {
    const FAKE_TOKENS: Readonly<Record<string, TokenDefinition>> = {
      "--example-drifted-N": {
        property: "--example-drifted-N",
        family: "spacing",
        value: "24px", // the fallback below says 16px — deliberately different
        brandable: false,
        themeDependent: false,
      },
    };
    const { candidates, unchecked } = candidatesFor('const x = "var(--example-drifted-N, 16px)";\n', "x.ts");
    const result = checkTokenPurity(candidates, FAKE_TOKENS, 1, unchecked);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({ rule: "token-value-duplicated-in-fallback", severity: "warning" });
    expect(result.findings[0]?.message).toContain("already drifted");
    expect(result.findings[0]?.message).toContain("24px"); // names the real current value
  });

  it("reports 'no token named ... exists' when the fallback's property is not in the registry at all (e.g. a typo), and leaves matchedToken undefined", () => {
    const { candidates, unchecked } = candidatesFor('const x = "var(--this-property-does-not-exist-N, 16px)";\n', "x.ts");
    const result = checkTokenPurity(candidates, TOKENS, 1, unchecked);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({ rule: "token-value-duplicated-in-fallback", severity: "warning" });
    expect(result.findings[0]?.message).toContain("no token named");
    expect(result.findings[0]?.matchedToken).toBeUndefined();
  });

  it("bg-[#3b82f6] (no var() wrapper at all) stays a BARE finding — error, not warning", () => {
    const { candidates, unchecked } = candidatesFor('<div className="bg-[#3b82f6]" />;\n', "x.tsx");
    const result = checkTokenPurity(candidates, TOKENS, 1, unchecked);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.severity).toBe("error");
    expect(result.findings[0]?.rule).not.toBe("token-value-duplicated-in-fallback");
    expect(result.findings[0]?.message).toContain("#3b82f6");
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
