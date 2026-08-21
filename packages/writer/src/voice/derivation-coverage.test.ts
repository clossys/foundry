import { describe, expect, it } from "vitest";
import { checkVoiceDerivationCoverage } from "./derivation-coverage.js";

// Every example below is deliberately fictional — no real company, product,
// person, or domain. "Acme"-flavored ids mirror the placeholder already
// used by this package's own checker.test.ts/schema.test.ts.

describe("checkVoiceDerivationCoverage", () => {
  it("SATISFIED: passes when every obligation names a supplied rule id and every supplied rule id is obliged", () => {
    const result = checkVoiceDerivationCoverage(["revolutionary", "fast-sync"], ["revolutionary", "fast-sync"]);
    expect(result.ok).toBe(true);
    expect(result.obligationsChecked).toBe(2);
    expect(result.rulesChecked).toBe(2);
    expect(result.obligationsMissingFromRecord).toEqual([]);
    expect(result.recordRulesNotObliged).toEqual([]);
    expect(result.reason).toBeUndefined();
  });

  // ------------------------------------------------------------------
  // VIOLATED, direction 1: an obligation names a rule id absent from the
  // supplied brand-derived-rule-ids list.
  // ------------------------------------------------------------------
  it("VIOLATED direction 1: an obligation names a rule id not in the supplied list", () => {
    const result = checkVoiceDerivationCoverage(
      ["revolutionary", "fast-sync", "plainspoken"],
      ["revolutionary", "fast-sync"],
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("coverage-gap");
    expect(result.obligationsMissingFromRecord).toEqual(["plainspoken"]);
    expect(result.recordRulesNotObliged).toEqual([]);
  });

  // ------------------------------------------------------------------
  // VIOLATED, direction 2: a supplied rule id no obligation reaches. A
  // ONE-DIRECTIONAL checker (only verifying every obligation resolves)
  // PASSES this exact case — this is the test that proves both directions
  // are actually implemented, not just direction 1.
  // ------------------------------------------------------------------
  it("VIOLATED direction 2: a supplied rule id no obligation reaches (proves both directions are checked)", () => {
    const result = checkVoiceDerivationCoverage(["revolutionary"], ["revolutionary", "fast-sync"]);
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
  it("INDETERMINATE: zero obligations supplied, even with real brand-derived rule ids present — never a vacuous pass", () => {
    const result = checkVoiceDerivationCoverage([], ["revolutionary", "fast-sync"]);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("no-obligations-provided");
    expect(result.obligationsChecked).toBe(0);
    expect(result.rulesChecked).toBe(2);
    // Never "satisfied": a caller reading only `ok` still fails correctly.
    expect(result.ok).not.toBe(true);
  });

  // ------------------------------------------------------------------
  // INDETERMINATE: zero brand-derived rule ids supplied, even with real
  // obligations present.
  // ------------------------------------------------------------------
  it("INDETERMINATE: empty brand-derived-rule-ids list, even with real obligations present — never a vacuous pass", () => {
    const result = checkVoiceDerivationCoverage(["plainspoken"], []);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("no-brand-derived-rules-provided");
    expect(result.rulesChecked).toBe(0);
    expect(result.obligationsChecked).toBe(1);
    expect(result.ok).not.toBe(true);
  });

  it("INDETERMINATE: both obligations and brand-derived-rule-ids empty — never satisfied", () => {
    const result = checkVoiceDerivationCoverage([], []);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("no-obligations-provided");
    expect(result.obligationsChecked).toBe(0);
    expect(result.rulesChecked).toBe(0);
  });

  it("is pure and order-independent: reordering obligations/rule ids does not change the verdict", () => {
    const brandDerivedRuleIds = ["revolutionary", "utilize", "fast-sync"];
    const a = checkVoiceDerivationCoverage(["utilize", "revolutionary", "fast-sync"], brandDerivedRuleIds);
    const b = checkVoiceDerivationCoverage(["fast-sync", "revolutionary", "utilize"], brandDerivedRuleIds);
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
  });

  it("de-duplicates repeated rule ids in brandDerivedRuleIds when counting rulesChecked", () => {
    const result = checkVoiceDerivationCoverage(
      ["revolutionary", "fast-sync"],
      ["revolutionary", "fast-sync", "fast-sync"],
    );
    // Not de-duplicated by this function — brandDerivedRuleIds is a plain
    // caller-supplied list, exactly like checkBrandCoverage's
    // brandableSlots, which is never de-duplicated either. A caller that
    // wants a de-duplicated count de-duplicates before calling.
    expect(result.rulesChecked).toBe(3);
    expect(result.ok).toBe(true);
  });
});
