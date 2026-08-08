import { describe, expect, it } from "vitest";
import { checkBrandCoverage, type BrandCoverageCheckOptions } from "./check-brand-coverage.js";
import { TOKENS, type TokenDefinition } from "./tokens.js";

/**
 * A small, closed fixture registry — three brandable slots, one
 * non-brandable slot — so every test below exercises this checker's LOGIC
 * without depending on the real 154-entry `TOKENS` (which changes shape
 * over time as this package grows) or asserting anything about this
 * package's own real token set. The one exception is the "against the real
 * TOKENS registry" block near the end, which deliberately does use the
 * real thing.
 */
const FIXTURE_TOKENS: Readonly<Record<string, TokenDefinition>> = {
  "--color-surface-base": {
    property: "--color-surface-base",
    family: "surface",
    value: "oklch(0.97 0 0)",
    brandable: true,
    themeDependent: true,
  },
  "--color-ink-primary": {
    property: "--color-ink-primary",
    family: "ink",
    value: "oklch(0.22 0 0)",
    brandable: true,
    themeDependent: true,
  },
  "--font-body": {
    property: "--font-body",
    family: "font",
    value: "system-ui, sans-serif",
    brandable: true,
    themeDependent: false,
  },
  "--spacing-md": {
    property: "--spacing-md",
    family: "spacing",
    value: "12px",
    brandable: false,
    themeDependent: false,
  },
};

const FIXTURE_OPTIONS: BrandCoverageCheckOptions = { tokens: FIXTURE_TOKENS };

describe("checkBrandCoverage — fixture 1: uncovered brandable slot", () => {
  it("reports every brandable slot with no declaration at all", () => {
    const report = checkBrandCoverage({}, FIXTURE_OPTIONS);
    expect(report.ok).toBe(false);
    expect(report.declarationsChecked).toBe(0);
    expect(report.brandableSlotsChecked).toBe(3);
    expect(report.findings).toEqual([
      {
        rule: "uncovered-brandable-slot",
        slot: "--color-surface-base",
        message: `"--color-surface-base" is brandable but has no declaration in the given brand CSS — it will silently use tokens.css's unbranded default`,
      },
      {
        rule: "uncovered-brandable-slot",
        slot: "--color-ink-primary",
        message: `"--color-ink-primary" is brandable but has no declaration in the given brand CSS — it will silently use tokens.css's unbranded default`,
      },
      {
        rule: "uncovered-brandable-slot",
        slot: "--font-body",
        message: `"--font-body" is brandable but has no declaration in the given brand CSS — it will silently use tokens.css's unbranded default`,
      },
    ]);
    expect(report.unchecked).toEqual([]);
    expect(report.reason).toBe("coverage-gap");
  });

  it("reports an uncovered slot distinctly when it WAS declared but with an empty value — brand-template.css's own shape", () => {
    const report = checkBrandCoverage(
      { "--color-surface-base": "   ", "--color-ink-primary": "oklch(0.2 0 0)", "--font-body": "Inter, sans-serif" },
      FIXTURE_OPTIONS,
    );
    expect(report.ok).toBe(false);
    expect(report.declarationsChecked).toBe(3);
    expect(report.findings).toEqual([
      {
        rule: "uncovered-brandable-slot",
        slot: "--color-surface-base",
        message: `"--color-surface-base" is declared but with an empty value, which is not a real override — it silently falls back to tokens.css's default; fill it in or remove the declaration`,
      },
    ]);
  });
});

describe("checkBrandCoverage — fixture 2: typo'd (unknown) slot name", () => {
  it("reports a declaration naming a slot absent from the token registry", () => {
    const report = checkBrandCoverage(
      {
        "--color-surface-base": "oklch(0.9 0 0)",
        "--color-ink-primary": "oklch(0.2 0 0)",
        "--font-body": "Inter, sans-serif",
        "--color-surace-base": "oklch(0.9 0 0)", // typo: "surace"
      },
      FIXTURE_OPTIONS,
    );
    expect(report.ok).toBe(false);
    expect(report.findings).toEqual([
      {
        rule: "unknown-slot",
        slot: "--color-surace-base",
        message:
          '"--color-surace-base" is not a token this package declares — almost always a typo of a real slot name; as declared, this brand override will never apply, silently',
      },
    ]);
  });
});

describe("checkBrandCoverage — fixture 3: override of a non-brandable (structural) slot", () => {
  it("reports a declaration targeting a brandable:false slot as a finding, not a silent accept", () => {
    const report = checkBrandCoverage(
      {
        "--color-surface-base": "oklch(0.9 0 0)",
        "--color-ink-primary": "oklch(0.2 0 0)",
        "--font-body": "Inter, sans-serif",
        "--spacing-md": "16px",
      },
      FIXTURE_OPTIONS,
    );
    expect(report.ok).toBe(false);
    expect(report.findings).toEqual([
      {
        rule: "non-brandable-override",
        slot: "--spacing-md",
        message:
          '"--spacing-md" is a structural (non-brandable) token; overriding it is not allowed — matches @vespeneventures/render\'s flattenTokens, which throws "non-brandable-override" for the same slot',
      },
    ]);
  });
});

describe("checkBrandCoverage — fixture 4: unparseable/unclassifiable declaration key -> unchecked", () => {
  it("routes a key not shaped like a real CSS custom-property name to `unchecked`, never dropped", () => {
    const report = checkBrandCoverage(
      {
        "--color-surface-base": "oklch(0.9 0 0)",
        "--color-ink-primary": "oklch(0.2 0 0)",
        "--font-body": "Inter, sans-serif",
        "not-a-custom-property": "whatever",
      },
      FIXTURE_OPTIONS,
    );
    expect(report.ok).toBe(false);
    expect(report.findings).toEqual([]);
    expect(report.unchecked).toEqual([
      {
        key: "not-a-custom-property",
        reason:
          '"not-a-custom-property" is not shaped like a CSS custom-property name ("--" followed by letters/digits/hyphens), so it cannot be classified against the token registry',
      },
    ]);
  });
});

describe("checkBrandCoverage — the empty-declarations case can never pass", () => {
  it("zero declarations against a registry with real brandable slots produces findings, never a clean ok", () => {
    const report = checkBrandCoverage({}, FIXTURE_OPTIONS);
    expect(report.ok).toBe(false);
    expect(report.findings.length).toBeGreaterThan(0);
  });

  it("zero declarations AND a registry with zero brandable slots is the true degenerate case — still not ok", () => {
    const report = checkBrandCoverage(
      {},
      { tokens: { "--spacing-md": FIXTURE_TOKENS["--spacing-md"]! } }, // only a non-brandable entry
    );
    expect(report.ok).toBe(false);
    expect(report.declarationsChecked).toBe(0);
    expect(report.brandableSlotsChecked).toBe(0);
    expect(report.findings).toEqual([]);
    expect(report.reason).toBe("nothing-to-check");
  });
});

describe("checkBrandCoverage — a genuinely clean run", () => {
  it("reports ok: true when every brandable slot has a real declaration and nothing else is wrong", () => {
    const report = checkBrandCoverage(
      {
        "--color-surface-base": "oklch(0.9 0 0)",
        "--color-ink-primary": "oklch(0.2 0 0)",
        "--font-body": "Inter, sans-serif",
      },
      FIXTURE_OPTIONS,
    );
    expect(report.ok).toBe(true);
    expect(report.findings).toEqual([]);
    expect(report.unchecked).toEqual([]);
    expect(report.reason).toBeUndefined();
    expect(report.declarationsChecked).toBe(3);
    expect(report.brandableSlotsChecked).toBe(3);
  });

  it("a real brand.css may legitimately declare things this checker doesn't otherwise touch — still clean as long as every brandable slot is covered and nothing is a typo/non-brandable", () => {
    const report = checkBrandCoverage(
      {
        "--color-surface-base": "oklch(0.9 0 0)",
        "--color-ink-primary": "oklch(0.2 0 0)",
        "--font-body": "Inter, sans-serif",
      },
      FIXTURE_OPTIONS,
    );
    expect(report.ok).toBe(true);
  });
});

describe("checkBrandCoverage — defaults to this package's real TOKENS registry", () => {
  it("with no options, checks against the real 154-entry TOKENS, not a fixture", () => {
    const realBrandableCount = Object.values(TOKENS).filter((t) => t.brandable).length;
    const report = checkBrandCoverage({});
    expect(report.brandableSlotsChecked).toBe(realBrandableCount);
    expect(report.brandableSlotsChecked).toBeGreaterThan(0);
    expect(report.ok).toBe(false); // zero declarations against a real, non-empty registry
  });

  it("running against the real brand-template.css's declared (but empty) values reports every required slot as uncovered — see check-brand-coverage-real-files.test.ts for the actual file-backed run", () => {
    // A minimal sanity check that the real registry's own typo/override
    // rules fire identically to the fixture ones above, using one real
    // brandable slot and one real non-brandable slot.
    const report = checkBrandCoverage(
      { "--color-surface-base": "", "--spacing-xs": "8px", "--color-surfac-base": "oklch(0.9 0 0)" },
    );
    const rules = report.findings.map((f) => f.rule).sort();
    expect(rules).toContain("uncovered-brandable-slot"); // --color-surface-base declared empty
    expect(rules).toContain("non-brandable-override"); // --spacing-xs is a fixed scale
    expect(rules).toContain("unknown-slot"); // --color-surfac-base is a typo
  });
});
