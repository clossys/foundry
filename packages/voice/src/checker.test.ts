import { describe, expect, it } from "vitest";
import { auditClaimsRegister, checkCopy } from "./checker.js";
import type { VoiceRecord } from "./types.js";

// A minimal, obviously-fictional VoiceRecord. "Acme" mirrors the placeholder
// already used in this repository's own packages/ui README examples.
function makeRecord(overrides: Partial<VoiceRecord> = {}): VoiceRecord {
  return {
    id: "acme-app",
    rules: {
      person: { description: "second-person, you-voice", forbiddenPronouns: ["we", "our", "us"] },
      tense: { description: "present tense, no future promises", forbiddenMarkers: ["will", "shall"] },
      formality: "neutral",
      tone: ["direct"],
    },
    glossary: [
      { term: "revolutionary", status: "forbidden", reason: "overused buzzword", alternative: "new", caseSensitive: false },
      { term: "utilize", status: "forbidden", reason: "just say use", caseSensitive: false },
    ],
    claims: [
      { id: "fast-sync", text: "fastest sync in its class", matchPhrases: [], factRef: undefined, requiresSupport: true },
    ],
    ...overrides,
  };
}

describe("checkCopy — fails closed on empty input", () => {
  it("skips every dimension for empty copy, rather than reporting a clean pass", () => {
    const report = checkCopy(makeRecord(), "");
    expect(report.findings).toEqual([]);
    expect(report.ran).toEqual([]);
    expect(report.skipped).toHaveLength(4);
    expect(report.skipped.every((s) => s.reason === "empty-copy")).toBe(true);
    expect(report.complete).toBe(false);
  });

  it("treats whitespace-only copy the same as empty", () => {
    const report = checkCopy(makeRecord(), "   \n\t  ");
    expect(report.complete).toBe(false);
    expect(report.skipped).toHaveLength(4);
  });

  it("a clean-looking report with zero findings but complete:true is NOT the same as an empty-copy report", () => {
    // Same record, real (clean) copy: findings is [] for a genuinely different
    // reason than the empty-copy case above — complete is true and every
    // configured dimension ran.
    const report = checkCopy(makeRecord(), "This tool helps you plan your week.");
    expect(report.findings).toEqual([]);
    expect(report.complete).toBe(true);
    expect(report.ran).toEqual(["glossary", "person", "tense", "claims"]);
  });
});

describe("checkCopy — glossary dimension", () => {
  it("goes red when copy contains a forbidden term", () => {
    const report = checkCopy(makeRecord(), "Our revolutionary new dashboard changes everything.");
    const finding = report.findings.find((f) => f.rule === "glossary:forbidden-term" && f.path === "revolutionary");
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("error");
    expect(finding?.message).toMatch(/Use "new" instead/);
  });

  it("does not flag a forbidden term that only appears as a substring of another word", () => {
    // "utilize" is forbidden; "utilized" and "utilizes" contain the word
    // boundary differently — this specific real word is NOT a substring of a
    // different unrelated word, but we assert the general whole-word rule
    // using a clearer case: "art" (not forbidden) inside "article" is never
    // matched by countMatches's \b...\b boundaries.
    const record = makeRecord({
      glossary: [{ term: "art", status: "forbidden", reason: "test only", caseSensitive: false }],
    });
    const report = checkCopy(record, "Read this article about your plan.");
    expect(report.findings.find((f) => f.rule === "glossary:forbidden-term")).toBeUndefined();
  });

  it("is skipped, not silently clean, when the glossary has no forbidden entries", () => {
    const record = makeRecord({ glossary: [{ term: "great", status: "preferred", reason: "tone fit" }] });
    const report = checkCopy(record, "This is a great plan for your week.");
    expect(report.skipped.some((s) => s.dimension === "glossary" && s.reason === "no-forbidden-terms-configured")).toBe(
      true,
    );
    expect(report.ran).not.toContain("glossary");
  });

  it("never actively checks for presence of a preferred term (documented non-goal)", () => {
    const record = makeRecord({ glossary: [{ term: "great", status: "preferred", reason: "tone fit" }] });
    // Copy deliberately never uses "great" — a checker that claimed to
    // enforce "preferred" terms would flag this; this one does not.
    const report = checkCopy(record, "This plan works well for your week.");
    expect(report.findings).toEqual([]);
  });

  it("respects per-term caseSensitive: true", () => {
    const record = makeRecord({
      glossary: [{ term: "NASA", status: "forbidden", reason: "test only", caseSensitive: true }],
    });
    const cleanReport = checkCopy(record, "We help you plan a trip to nasa-adjacent museums.");
    expect(cleanReport.findings.find((f) => f.path === "NASA")).toBeUndefined();
    const dirtyReport = checkCopy(record, "We partner with NASA on this.");
    expect(dirtyReport.findings.find((f) => f.path === "NASA")).toBeDefined();
  });
});

describe("checkCopy — person dimension", () => {
  it("goes red when copy uses a forbidden pronoun", () => {
    const report = checkCopy(makeRecord(), "We built this for you, and our team loves it.");
    const finding = report.findings.find((f) => f.rule === "person:forbidden-pronoun");
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("error");
  });

  it("is skipped when no forbidden pronouns are configured", () => {
    const record = makeRecord({
      rules: { ...makeRecord().rules, person: { description: "no rule enforced", forbiddenPronouns: [] } },
    });
    const report = checkCopy(record, "We built this for you.");
    expect(report.skipped.some((s) => s.dimension === "person")).toBe(true);
  });

  it("documented known limitation: case-insensitive matching cannot tell the pronoun 'I' from a bare lowercase 'i'", () => {
    const record = makeRecord({
      rules: { ...makeRecord().rules, person: { description: "no first-person singular", forbiddenPronouns: ["I"] } },
    });
    // "i" here is not the pronoun at all -- a plausible false positive this
    // package's README explicitly calls out rather than hiding.
    const report = checkCopy(record, "Track hours in 15-minute increments, from i to iv.");
    expect(report.findings.some((f) => f.rule === "person:forbidden-pronoun" && f.path === "I")).toBe(true);
  });
});

describe("checkCopy — tense dimension", () => {
  it("goes red (as a warning) when copy uses a forbidden tense marker", () => {
    const report = checkCopy(makeRecord(), "This will save you an hour every week.");
    const finding = report.findings.find((f) => f.rule === "tense:forbidden-marker" && f.path === "will");
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("warning");
  });

  it("is skipped when no forbidden markers are configured", () => {
    const record = makeRecord({
      rules: { ...makeRecord().rules, tense: { description: "no rule enforced", forbiddenMarkers: [] } },
    });
    const report = checkCopy(record, "This will save you an hour every week.");
    expect(report.skipped.some((s) => s.dimension === "tense")).toBe(true);
  });
});

describe("checkCopy — claims dimension", () => {
  it("goes red when an unsupported claim's phrase appears in copy", () => {
    const report = checkCopy(makeRecord(), "It's the fastest sync in its class, full stop.");
    const finding = report.findings.find((f) => f.rule === "claim:unsupported" && f.path === "fast-sync");
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("error");
  });

  it("does not flag a claim that carries a factRef", () => {
    const record = makeRecord({
      claims: [{ id: "fast-sync", text: "fastest sync in its class", matchPhrases: [], factRef: "facts://sync-benchmark-2026", requiresSupport: true }],
    });
    const report = checkCopy(record, "It's the fastest sync in its class.");
    expect(report.findings.find((f) => f.rule === "claim:unsupported")).toBeUndefined();
  });

  it("does not flag a claim explicitly marked as not requiring support", () => {
    const record = makeRecord({
      claims: [{ id: "opinion", text: "the simplest way to plan your week", matchPhrases: [], requiresSupport: false }],
    });
    const report = checkCopy(record, "This is the simplest way to plan your week.");
    expect(report.findings).toEqual([]);
  });

  it("matches on matchPhrases when given, not just the claim's own text", () => {
    const record = makeRecord({
      claims: [
        {
          id: "fast-sync",
          text: "fastest sync in its class",
          matchPhrases: ["syncs faster than anything else"],
          requiresSupport: true,
        },
      ],
    });
    const report = checkCopy(record, "It syncs faster than anything else on the market.");
    expect(report.findings.find((f) => f.rule === "claim:unsupported" && f.path === "fast-sync")).toBeDefined();
  });

  it("does NOT catch a paraphrase that matches neither text nor matchPhrases (documented limit)", () => {
    const report = checkCopy(makeRecord(), "Nothing syncs quicker than this, we promise.");
    expect(report.findings.find((f) => f.rule === "claim:unsupported")).toBeUndefined();
  });

  it("is skipped when no claims are configured", () => {
    const record = makeRecord({ claims: [] });
    const report = checkCopy(record, "It's the fastest sync in its class.");
    expect(report.skipped.some((s) => s.dimension === "claims" && s.reason === "no-claims-configured")).toBe(true);
  });
});

describe("checkCopy — waivers", () => {
  it("moves a matched finding into waived[] and removes it from findings[]", () => {
    const report = checkCopy(makeRecord(), "Our revolutionary new dashboard changes everything.", {
      waivers: [{ rule: "glossary:forbidden-term", match: "revolutionary", reason: "quoting a customer review verbatim" }],
    });
    expect(report.findings.find((f) => f.rule === "glossary:forbidden-term")).toBeUndefined();
    expect(report.waived).toHaveLength(1);
    expect(report.waived[0]?.waiver.reason).toBe("quoting a customer review verbatim");
    expect(report.waived[0]?.path).toBe("revolutionary");
  });

  it("does not waive an unrelated finding sharing only the same rule with a different path", () => {
    const report = checkCopy(makeRecord(), "Our revolutionary and revolutionary dashboard. utilize this.", {
      waivers: [{ rule: "glossary:forbidden-term", match: "revolutionary", reason: "test" }],
    });
    expect(report.findings.find((f) => f.path === "utilize")).toBeDefined();
    expect(report.findings.find((f) => f.path === "revolutionary")).toBeUndefined();
  });

  it("reports waiver:unused when a waiver never matches anything this run", () => {
    const report = checkCopy(makeRecord(), "This tool helps you plan your week.", {
      waivers: [{ rule: "glossary:forbidden-term", match: "revolutionary", reason: "stale waiver" }],
    });
    const finding = report.findings.find((f) => f.rule === "waiver:unused");
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("warning");
    expect(finding?.message).toMatch(/stale waiver/);
  });

  it("rejects a waiver missing a reason, as waiver:invalid, and does not apply it", () => {
    // Empty string is type-valid (still a `string`) but runtime-invalid --
    // this is exactly the gap the runtime check exists to close, so no
    // @ts-expect-error is expected here.
    const report = checkCopy(makeRecord(), "Our revolutionary new dashboard changes everything.", {
      waivers: [{ rule: "glossary:forbidden-term", match: "revolutionary", reason: "" }],
    });
    expect(report.findings.find((f) => f.rule === "waiver:invalid")).toBeDefined();
    // and the original finding was NOT waived
    expect(report.findings.find((f) => f.rule === "glossary:forbidden-term" && f.path === "revolutionary")).toBeDefined();
    expect(report.waived).toEqual([]);
  });
});

describe("checkCopy — caller-input errors (thrown, not reported as findings)", () => {
  it("throws for non-string copy", () => {
    // @ts-expect-error -- intentionally wrong type
    expect(() => checkCopy(makeRecord(), 12345)).toThrow(TypeError);
  });

  it("throws for a null or non-object record", () => {
    // @ts-expect-error -- intentionally wrong type
    expect(() => checkCopy(null, "some copy")).toThrow(TypeError);
  });
});

describe("auditClaimsRegister", () => {
  it("flags a claim that requires support but has no factRef", () => {
    const claims = makeRecord().claims;
    const findings = auditClaimsRegister(claims);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.rule).toBe("claim:missing-fact-ref");
    expect(findings[0]?.severity).toBe("warning");
  });

  it("does not flag a claim with a factRef", () => {
    const findings = auditClaimsRegister([
      { id: "a", text: "x", matchPhrases: [], factRef: "facts://x", requiresSupport: true },
    ]);
    expect(findings).toEqual([]);
  });

  it("does not flag a claim explicitly marked as not requiring support", () => {
    const findings = auditClaimsRegister([{ id: "a", text: "x", matchPhrases: [], requiresSupport: false }]);
    expect(findings).toEqual([]);
  });

  it("returns [] (not a finding) for an empty claims list — an empty register is not itself a defect", () => {
    expect(auditClaimsRegister([])).toEqual([]);
  });
});
