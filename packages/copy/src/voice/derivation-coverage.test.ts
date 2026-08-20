import { describe, expect, it } from "vitest";
import { checkVoiceDerivationCoverage } from "./derivation-coverage.js";
import type { VoiceRecord } from "./types.js";

// Every example below is deliberately fictional — no real company, product,
// person, or domain. "Acme" mirrors the placeholder already used by this
// package's own checker.test.ts/schema.test.ts.

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
    ],
    claims: [
      { id: "fast-sync", text: "fastest sync in its class", matchPhrases: [], factRef: undefined, requiresSupport: true },
    ],
    ...overrides,
  };
}

const EMPTY_RECORD: VoiceRecord = makeRecord({ glossary: [], claims: [] });

describe("checkVoiceDerivationCoverage", () => {
  it("SATISFIED: passes when every obligation names a real rule and every rule is obliged", () => {
    const result = checkVoiceDerivationCoverage(["revolutionary", "fast-sync"], makeRecord());
    expect(result.ok).toBe(true);
    expect(result.obligationsChecked).toBe(2);
    expect(result.rulesChecked).toBe(2);
    expect(result.obligationsMissingFromRecord).toEqual([]);
    expect(result.recordRulesNotObliged).toEqual([]);
    expect(result.reason).toBeUndefined();
  });

  // ------------------------------------------------------------------
  // VIOLATED, direction 1: an obligation names a rule absent from the
  // record.
  // ------------------------------------------------------------------
  it("VIOLATED direction 1: an obligation names a rule id the record does not declare", () => {
    const result = checkVoiceDerivationCoverage(["revolutionary", "fast-sync", "plainspoken"], makeRecord());
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("coverage-gap");
    expect(result.obligationsMissingFromRecord).toEqual(["plainspoken"]);
    expect(result.recordRulesNotObliged).toEqual([]);
  });

  // ------------------------------------------------------------------
  // VIOLATED, direction 2: the record declares a rule no obligation
  // reaches. A ONE-DIRECTIONAL checker (only verifying every obligation
  // resolves) PASSES this exact case — this is the test that proves both
  // directions are actually implemented, not just direction 1.
  // ------------------------------------------------------------------
  it("VIOLATED direction 2: the record declares a rule no obligation reaches (proves both directions are checked)", () => {
    const result = checkVoiceDerivationCoverage(["revolutionary"], makeRecord());
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("coverage-gap");
    expect(result.obligationsMissingFromRecord).toEqual([]);
    expect(result.recordRulesNotObliged).toEqual(["fast-sync"]);
  });

  // ------------------------------------------------------------------
  // INDETERMINATE: zero obligations supplied. Must be indeterminate, NOT
  // satisfied — a checker with nothing to check must never report the
  // same shape as a checker that checked everything and found it clean.
  // Asserted explicitly against the real result fields, not merely "does
  // not throw" (Node's own uncaught-exception default also exits 1, the
  // same code a real violation uses — that would prove nothing here).
  // ------------------------------------------------------------------
  it("INDETERMINATE: zero obligations supplied, even with real rules present in the record — never a vacuous pass", () => {
    const result = checkVoiceDerivationCoverage([], makeRecord());
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("no-obligations-provided");
    expect(result.obligationsChecked).toBe(0);
    expect(result.rulesChecked).toBe(2);
    // Never "satisfied": a caller reading only `ok` still fails correctly.
    expect(result.ok).not.toBe(true);
  });

  // ------------------------------------------------------------------
  // INDETERMINATE: empty voice record (zero glossary/claim/pattern ids),
  // even with real obligations supplied.
  // ------------------------------------------------------------------
  it("INDETERMINATE: empty voice record, even with real obligations present — never a vacuous pass", () => {
    const result = checkVoiceDerivationCoverage(["plainspoken"], EMPTY_RECORD);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("no-rules-in-record");
    expect(result.rulesChecked).toBe(0);
    expect(result.obligationsChecked).toBe(1);
    expect(result.ok).not.toBe(true);
  });

  it("INDETERMINATE: both obligations and record rules empty — never satisfied", () => {
    const result = checkVoiceDerivationCoverage([], EMPTY_RECORD);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("no-obligations-provided");
    expect(result.obligationsChecked).toBe(0);
    expect(result.rulesChecked).toBe(0);
  });

  it("counts pattern rule ids as voice rule ids too, when the record declares patterns", () => {
    const record = makeRecord({
      patterns: [
        {
          id: "no-em-dash",
          description: "no em dash",
          pattern: { source: "\\u2014" },
          severity: "error",
          reason: "house style",
        },
      ],
    });
    const result = checkVoiceDerivationCoverage(["revolutionary", "fast-sync", "no-em-dash"], record);
    expect(result.ok).toBe(true);
    expect(result.rulesChecked).toBe(3);
  });

  it("is pure and order-independent: reordering obligations/rules does not change the verdict", () => {
    const record = makeRecord({
      glossary: [
        { term: "revolutionary", status: "forbidden", reason: "buzzword", caseSensitive: false },
        { term: "utilize", status: "forbidden", reason: "just say use", caseSensitive: false },
      ],
    });
    const a = checkVoiceDerivationCoverage(["utilize", "revolutionary", "fast-sync"], record);
    const b = checkVoiceDerivationCoverage(["fast-sync", "revolutionary", "utilize"], record);
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
  });

  it("de-duplicates repeated voice rule ids in the record when counting rulesChecked", () => {
    const record = makeRecord({
      claims: [
        { id: "fast-sync", text: "fastest sync in its class", matchPhrases: [], requiresSupport: true },
        { id: "fast-sync", text: "duplicate id, still one rule to check", matchPhrases: [], requiresSupport: true },
      ],
    });
    const result = checkVoiceDerivationCoverage(["revolutionary", "fast-sync"], record);
    expect(result.rulesChecked).toBe(2);
    expect(result.ok).toBe(true);
  });
});
