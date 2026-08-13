import { describe, expect, it } from "vitest";
import { auditClaimsRegister, checkCopy, isCiBlockingSeverity } from "./checker.js";
import type { PatternRule, VoiceRecord } from "./types.js";

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

  it("matches the pronoun 'I' case-sensitively, so a bare lowercase 'i' is NOT a false positive", () => {
    const record = makeRecord({
      rules: { ...makeRecord().rules, person: { description: "no first-person singular", forbiddenPronouns: ["I"] } },
    });
    // "i" here is not the pronoun at all -- a plausible false positive a
    // naive case-insensitive match would produce. It must not fire.
    const clean = checkCopy(record, "Track hours in 15-minute increments, from i to iv.");
    expect(clean.findings.some((f) => f.rule === "person:forbidden-pronoun")).toBe(false);

    // The real pronoun, capitalized, still fires.
    const dirty = checkCopy(record, "I built this for you.");
    expect(dirty.findings.some((f) => f.rule === "person:forbidden-pronoun" && f.path === "I")).toBe(true);
  });

  it("still matches a multi-letter pronoun regardless of sentence-initial capitalization", () => {
    const record = makeRecord({
      rules: { ...makeRecord().rules, person: { description: "no first-person plural", forbiddenPronouns: ["we"] } },
    });
    const report = checkCopy(record, "We built this for you.");
    expect(report.findings.some((f) => f.rule === "person:forbidden-pronoun" && f.path === "we")).toBe(true);
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
    // this is exactly the gap the runtime check exists to close, so this
    // case needs no type-level suppression of any kind.
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
  // Both cases below call `checkCopy` with a value its own type signature
  // already rules out, on purpose, to prove the RUNTIME guard also rejects
  // what a JS caller (or a `.ts` caller that casts past the types) could
  // still pass in. That's a genuine assertion, but not a type-level one --
  // there's no compile-time contract being tested here, only a runtime
  // guard -- so the wrong-typed value is force-cast, not suppressed with a
  // `@ts-expect-error`. A directive would (a) assert nothing real (this
  // file is a `*.test.ts`, never compiled by `tsc` -- see issue #24) and
  // (b) misleadingly imply a type contract is under test here, when the
  // `.toThrow` below is the entire point.
  it("throws for non-string copy", () => {
    expect(() => checkCopy(makeRecord(), 12345 as unknown as string)).toThrow(TypeError);
  });

  it("throws for a null or non-object record", () => {
    expect(() => checkCopy(null as unknown as VoiceRecord, "some copy")).toThrow(TypeError);
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

describe("checkCopy — BACKWARD COMPATIBILITY pin: an existing VoiceRecord that never declares patterns", () => {
  // The literal scope-discipline requirement: everything in this PR is
  // additive, so a VoiceRecord that "uses none of this" must validate and
  // behave EXACTLY as it did before pattern rules, channel scoping, and the
  // third severity tier existed. `makeRecord()` above never sets `patterns`
  // — this pins the exact report shape that produces, unchanged.
  it("never adds a 'pattern' entry to ran/skipped, and complete/skipped.length match pre-pattern-rule behavior", () => {
    const emptyReport = checkCopy(makeRecord(), "");
    expect(emptyReport.skipped).toHaveLength(4);
    expect(emptyReport.skipped.every((s) => s.dimension !== "pattern")).toBe(true);
    expect(emptyReport.complete).toBe(false);

    const cleanReport = checkCopy(makeRecord(), "This tool helps you plan your week.");
    expect(cleanReport.findings).toEqual([]);
    expect(cleanReport.complete).toBe(true);
    expect(cleanReport.ran).toEqual(["glossary", "person", "tense", "claims"]);
    expect(cleanReport.skipped).toEqual([]);
  });

  it("record.patterns stays undefined (never silently defaulted) for a record that never declared it", () => {
    const record = makeRecord();
    expect(record.patterns).toBeUndefined();
    expect("patterns" in record).toBe(false);
  });
});

function patternRule(overrides: Partial<PatternRule> = {}): PatternRule {
  return {
    id: "no-em-dash",
    description: "hard ban on the em dash",
    pattern: { source: "\\u2014" },
    severity: "error",
    reason: "house style bans the em dash",
    ...overrides,
  };
}

describe("checkCopy — pattern dimension", () => {
  it("is skipped, with reason, when patterns is declared but empty — and DOES appear in ran/skipped once declared", () => {
    const report = checkCopy(makeRecord({ patterns: [] }), "Some plain copy.");
    expect(report.skipped.some((s) => s.dimension === "pattern" && s.reason === "no-patterns-configured")).toBe(true);
  });

  it("goes red when copy matches a pattern rule, at the rule's own declared severity", () => {
    const record = makeRecord({ patterns: [patternRule({ severity: "advisory" })] });
    const report = checkCopy(record, "A bold claim — with an em dash.");
    const finding = report.findings.find((f) => f.rule === "pattern:matched" && f.path === "no-em-dash");
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("advisory");
    expect(finding?.message).toMatch(/matched 1 time/);
  });

  it("does not flag copy that does not match the pattern", () => {
    const record = makeRecord({ patterns: [patternRule()] });
    const report = checkCopy(record, "No banned punctuation here.");
    expect(report.findings.some((f) => f.rule === "pattern:matched")).toBe(false);
    expect(report.ran).toContain("pattern");
  });

  it("expresses alternation a GlossaryEntry cannot", () => {
    const record = makeRecord({
      patterns: [patternRule({ id: "deep-dive", pattern: { source: "\\b(deep dive|dive deep)\\b" }, description: "d" })],
    });
    expect(checkCopy(record, "Let's deep dive into this.").findings.some((f) => f.path === "deep-dive")).toBe(true);
    expect(checkCopy(record, "Let's dive deep into this.").findings.some((f) => f.path === "deep-dive")).toBe(true);
    expect(checkCopy(record, "Let's look into this.").findings.some((f) => f.path === "deep-dive")).toBe(false);
  });

  it("expresses an optional apostrophe a GlossaryEntry cannot", () => {
    const record = makeRecord({
      patterns: [
        patternRule({
          id: "worth-considering",
          pattern: { source: "\\bit'?s worth considering\\b", flags: "i" },
          description: "d",
        }),
      ],
    });
    expect(checkCopy(record, "It's worth considering.").findings.some((f) => f.path === "worth-considering")).toBe(true);
    expect(checkCopy(record, "Its worth considering.").findings.some((f) => f.path === "worth-considering")).toBe(true);
  });

  it("respects the alternative suggestion in the finding message", () => {
    const record = makeRecord({ patterns: [patternRule({ alternative: "a comma or period" })] });
    const report = checkCopy(record, "A claim — with a dash.");
    expect(report.findings.find((f) => f.path === "no-em-dash")?.message).toMatch(/Use "a comma or period" instead/);
  });

  it("an INVALID pattern rule is a real, unmissable, non-waivable error finding — never a silent skip", () => {
    const record = makeRecord({ patterns: [patternRule({ id: "evil", pattern: { source: "(a+)+" }, severity: "advisory" })] });
    const report = checkCopy(record, "Some copy that never mentions the pattern at all.");
    const finding = report.findings.find((f) => f.rule === "pattern:invalid-rule" && f.path === "evil");
    expect(finding).toBeDefined();
    // ALWAYS "error", regardless of the rule's own declared severity —
    // an unenforceable rule is a structural problem, not a content judgment.
    expect(finding?.severity).toBe("error");

    // Cannot be waived, mirroring voice:unbound-placeholder.
    const waivedReport = checkCopy(record, "Some copy.", {
      waivers: [{ rule: "pattern:invalid-rule", match: "evil", reason: "trying to suppress it" }],
    });
    expect(waivedReport.findings.some((f) => f.rule === "pattern:invalid-rule")).toBe(true);
    expect(waivedReport.waived.some((f) => f.rule === "pattern:invalid-rule")).toBe(false);
  });

  it("an invalid pattern is reported even when copy is empty — it is a property of the record, not the copy", () => {
    const record = makeRecord({ patterns: [patternRule({ id: "evil", pattern: { source: "(a+)+" } })] });
    const report = checkCopy(record, "");
    expect(report.findings.some((f) => f.rule === "pattern:invalid-rule" && f.path === "evil")).toBe(true);
  });

  it("one invalid rule does not block a sibling valid rule from running", () => {
    const record = makeRecord({
      patterns: [patternRule({ id: "evil", pattern: { source: "(a+)+" } }), patternRule({ id: "good" })],
    });
    const report = checkCopy(record, "A claim — with a dash.");
    expect(report.findings.some((f) => f.rule === "pattern:invalid-rule" && f.path === "evil")).toBe(true);
    expect(report.findings.some((f) => f.rule === "pattern:matched" && f.path === "good")).toBe(true);
  });
});

describe("checkCopy — channel scoping", () => {
  it("a channel-scoped glossary entry does not fire when no channel is given", () => {
    const record = makeRecord({
      glossary: [{ term: "synergy", status: "forbidden", reason: "x", caseSensitive: false, channel: "linkedin" }],
    });
    const report = checkCopy(record, "Let's talk about synergy today.");
    expect(report.findings.some((f) => f.path === "synergy")).toBe(false);
  });

  it("a channel-scoped glossary entry fires when the matching channel is given", () => {
    const record = makeRecord({
      glossary: [{ term: "synergy", status: "forbidden", reason: "x", caseSensitive: false, channel: "linkedin" }],
    });
    const report = checkCopy(record, "Let's talk about synergy today.", { channel: "linkedin" });
    expect(report.findings.some((f) => f.path === "synergy")).toBe(true);
  });

  it("a channel-scoped glossary entry does not fire for a DIFFERENT channel", () => {
    const record = makeRecord({
      glossary: [{ term: "synergy", status: "forbidden", reason: "x", caseSensitive: false, channel: "linkedin" }],
    });
    const report = checkCopy(record, "Let's talk about synergy today.", { channel: "x" });
    expect(report.findings.some((f) => f.path === "synergy")).toBe(false);
  });

  it("an UNSCOPED glossary entry fires regardless of the requested channel", () => {
    const record = makeRecord({
      glossary: [{ term: "synergy", status: "forbidden", reason: "x", caseSensitive: false }],
    });
    expect(checkCopy(record, "synergy", { channel: "linkedin" }).findings.some((f) => f.path === "synergy")).toBe(true);
    expect(checkCopy(record, "synergy").findings.some((f) => f.path === "synergy")).toBe(true);
  });

  it("channel scoping applies to pattern rules too", () => {
    const record = makeRecord({ patterns: [patternRule({ channel: "linkedin" })] });
    expect(checkCopy(record, "A claim — with a dash.").findings.some((f) => f.path === "no-em-dash")).toBe(false);
    expect(
      checkCopy(record, "A claim — with a dash.", { channel: "linkedin" }).findings.some((f) => f.path === "no-em-dash"),
    ).toBe(true);
  });
});

describe("isCiBlockingSeverity — the documented severity-to-exit-code mapping", () => {
  it("is true only for 'error'", () => {
    expect(isCiBlockingSeverity("error")).toBe(true);
    expect(isCiBlockingSeverity("warning")).toBe(false);
    expect(isCiBlockingSeverity("advisory")).toBe(false);
  });
});
