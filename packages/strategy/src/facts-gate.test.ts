import { describe, expect, it } from "vitest";
import { checkFactsTraceability } from "./facts-gate.js";
import type { Fact } from "./schema.js";

// Every example below is deliberately fictional prose about a made-up
// product ("Widgetronic") — no real company, product, person, or domain.

const customerCountFact: Fact = {
  key: "active-customers",
  label: "Active customers",
  value: 4200,
  unit: "customers",
  source: "billing-export-2026-06",
  lastUpdatedAt: "2026-06-30",
  aliases: ["4,200"],
};

const onlyPlatformClaimFact: Fact = {
  key: "only-platform-claim",
  label: "Legal-reviewed basis for the 'only platform' claim",
  value: "reviewed against 40 competitor product pages, 2026-06-01",
  source: "legal-review-2026-06-01",
  lastUpdatedAt: "2026-06-01",
};

describe("checkFactsTraceability — traced claims produce no findings", () => {
  it("PASSES when a numeric claim matches a fact's declared alias", () => {
    const files = [{ path: "fixture:about", content: "Widgetronic now serves 4,200 customers." }];
    const result = checkFactsTraceability(files, [customerCountFact]);
    expect(result.findings).toEqual([]);
    expect(result.claimsScanned).toBe(1);
  });

  it("PASSES when a superlative claim carries a valid fact citation", () => {
    const files = [
      {
        path: "fixture:about",
        content: "Widgetronic is the only platform built for this. <!-- fact:only-platform-claim -->",
      },
    ];
    const result = checkFactsTraceability(files, [onlyPlatformClaimFact]);
    expect(result.findings).toEqual([]);
  });
});

describe("checkFactsTraceability — proves the gate actually fails", () => {
  // The fixture below deliberately violates the rule: "9,999" appears
  // nowhere in facts.json (the only registered count is "4,200"), so this
  // MUST go red. A gate whose tests only ever exercise the green path
  // proves nothing about whether it can fail at all.
  it("FAILS on an untraced numeric claim", () => {
    const files = [{ path: "fixture:about", content: "Widgetronic now serves 9,999 customers." }];
    const result = checkFactsTraceability(files, [customerCountFact]);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({
      rule: "untraced-numeric-claim",
      severity: "error",
      file: "fixture:about",
      line: 1,
    });
  });

  it("FAILS on an untraced superlative claim", () => {
    const files = [{ path: "fixture:about", content: "Widgetronic is the only platform built for this." }];
    const result = checkFactsTraceability(files, []);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.rule).toBe("untraced-superlative-claim");
  });

  it("FAILS on a citation to a fact key that does not exist", () => {
    const files = [{ path: "fixture:about", content: "See our growth. <!-- fact:does-not-exist -->" }];
    const result = checkFactsTraceability(files, [customerCountFact]);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.rule).toBe("unknown-fact-citation");
  });

  it("still flags an untraced claim even though OTHER, unrelated facts exist in the registry", () => {
    // Merely having facts.json entries — for a different number entirely —
    // must never suppress a genuinely untraced claim. No citation appears
    // in this fixture at all, isolating the assertion to that point.
    const files = [{ path: "fixture:about", content: "Widgetronic now serves 12,000 customers." }];
    const result = checkFactsTraceability(files, [customerCountFact, onlyPlatformClaimFact]);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.rule).toBe("untraced-numeric-claim");
  });
});

describe("checkFactsTraceability — escape hatch", () => {
  it("suppresses a finding via facts-gate:ignore and records it as ignored, not silently", () => {
    const files = [
      { path: "fixture:about", content: "Widgetronic now serves 9,999 customers. <!-- facts-gate:ignore -->" },
    ];
    const result = checkFactsTraceability(files, [customerCountFact]);
    expect(result.findings).toEqual([]);
    expect(result.ignored).toEqual([
      { file: "fixture:about", line: 1, snippet: expect.stringContaining("9,999") },
    ]);
  });
});

describe("checkFactsTraceability — false-positive avoidance", () => {
  it("does not scan a fenced code block", () => {
    const content = ["Example config:", "", "```", "price: $500,000", "```", "", "No claim here."].join("\n");
    const result = checkFactsTraceability([{ path: "fixture:example", content }], []);
    expect(result.claimsScanned).toBe(0);
    expect(result.findings).toEqual([]);
  });

  it("does not scan an inline code span", () => {
    const files = [{ path: "fixture:example", content: "The config value is `$500,000` in the sample file." }];
    const result = checkFactsTraceability(files, []);
    expect(result.claimsScanned).toBe(0);
  });

  it("does not scan digits inside a URL", () => {
    const files = [{ path: "fixture:example", content: "See https://example.com/50%off for the changelog." }];
    const result = checkFactsTraceability(files, []);
    expect(result.claimsScanned).toBe(0);
  });

  it("does not flag a bare small number with no currency/percent/multiplier/grouping/unit word", () => {
    const files = [
      { path: "fixture:example", content: "Step 3 covers onboarding. This behavior shipped in version 18." },
    ];
    const result = checkFactsTraceability(files, []);
    expect(result.claimsScanned).toBe(0);
    expect(result.findings).toEqual([]);
  });
});

describe("checkFactsTraceability — Money facts", () => {
  const revenueFact: Fact = {
    key: "annual-revenue",
    label: "Annual revenue",
    value: { amount: 4200000, currency: "USD" },
    source: "audited-statement-2026",
    lastUpdatedAt: "2026-06-30",
    aliases: ["$4.2M"],
  };

  it("traces a currency claim matching a Money fact's declared alias", () => {
    const files = [{ path: "fixture:about", content: "Widgetronic crossed $4.2M in annual revenue this year." }];
    const result = checkFactsTraceability(files, [revenueFact]);
    expect(result.findings).toEqual([]);
  });

  it("still fails a DIFFERENT currency claim even with a Money fact registered", () => {
    const files = [{ path: "fixture:about", content: "Widgetronic crossed $9.9M in annual revenue this year." }];
    const result = checkFactsTraceability(files, [revenueFact]);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.rule).toBe("untraced-numeric-claim");
  });
});

describe("checkFactsTraceability — totality", () => {
  it("never throws on empty inputs", () => {
    expect(() => checkFactsTraceability([], [])).not.toThrow();
    expect(checkFactsTraceability([], []).findings).toEqual([]);
  });

  it("reports filesScanned matching the input length", () => {
    const files = [
      { path: "a.md", content: "Nothing to see here." },
      { path: "b.md", content: "Nor here." },
    ];
    expect(checkFactsTraceability(files, []).filesScanned).toBe(2);
  });
});
