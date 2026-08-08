import { describe, expect, it } from "vitest";
import { checkBrandCoverage, validateBrandDerivation, validateBrandDerivations, type BrandDerivation } from "./brand-derivation.js";

// Every example below is deliberately fictional — no real company, product,
// person, or domain. "Widgetronic" and its slot/rule names are invented for
// this test file only, following schema.test.ts's own convention.

const RATIONALE = "Precision means the accent color must read as decisive, not soft, and copy states facts without hedging.";

function derivation(attribute: string, tokenSlots: string[], voiceRules: string[] = []): BrandDerivation {
  return { attribute, tokenSlots, voiceRules, rationale: RATIONALE };
}

describe("validateBrandDerivation", () => {
  it("accepts a well-formed derivation naming a tokenSlot", () => {
    const result = validateBrandDerivation({
      attribute: "Precise",
      tokenSlots: ["--color-accent-primary"],
      voiceRules: [],
      rationale: RATIONALE,
    });
    expect(result.ok).toBe(true);
  });

  it("accepts a well-formed derivation naming only a voiceRule", () => {
    const result = validateBrandDerivation({
      attribute: "Direct",
      tokenSlots: [],
      voiceRules: ["no-hedging"],
      rationale: RATIONALE,
    });
    expect(result.ok).toBe(true);
  });

  it("rejects a derivation naming neither a tokenSlot nor a voiceRule", () => {
    const result = validateBrandDerivation({
      attribute: "Precise",
      tokenSlots: [],
      voiceRules: [],
      rationale: RATIONALE,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((i) => i.message.includes("at least one tokenSlot or voiceRule"))).toBe(true);
    }
  });

  it("rejects a rationale too short to be more than a restatement", () => {
    const result = validateBrandDerivation({
      attribute: "Precise",
      tokenSlots: ["--color-accent-primary"],
      voiceRules: [],
      rationale: "because",
    });
    expect(result.ok).toBe(false);
  });

  it("rejects a missing attribute name", () => {
    const result = validateBrandDerivation({
      tokenSlots: ["--color-accent-primary"],
      voiceRules: [],
      rationale: RATIONALE,
    });
    expect(result.ok).toBe(false);
  });

  it("rejects a non-object input", () => {
    expect(validateBrandDerivation("Precise").ok).toBe(false);
  });
});

describe("validateBrandDerivations", () => {
  it("accepts an array of well-formed derivations", () => {
    const result = validateBrandDerivations([
      { attribute: "Precise", tokenSlots: ["--color-accent-primary"], voiceRules: [], rationale: RATIONALE },
      { attribute: "Direct", tokenSlots: [], voiceRules: ["no-hedging"], rationale: RATIONALE },
    ]);
    expect(result.ok).toBe(true);
  });

  it("accepts an empty array", () => {
    expect(validateBrandDerivations([]).ok).toBe(true);
  });

  it("rejects a non-array", () => {
    expect(validateBrandDerivations({}).ok).toBe(false);
  });
});

describe("checkBrandCoverage", () => {
  it("passes when every brandable slot has a derivation and every derivation names a real slot", () => {
    const result = checkBrandCoverage(
      ["--color-accent-primary", "--color-accent-secondary"],
      [derivation("Precise", ["--color-accent-primary"]), derivation("Bold", ["--color-accent-secondary"])],
    );
    expect(result.ok).toBe(true);
    expect(result.slotsChecked).toBe(2);
    expect(result.derivationsChecked).toBe(2);
    expect(result.slotsMissingDerivation).toEqual([]);
    expect(result.unknownSlotsInDerivations).toEqual([]);
    expect(result.reason).toBeUndefined();
  });

  it("passes when a derivation only implies a voiceRule and names no tokenSlot at all", () => {
    const result = checkBrandCoverage(
      ["--color-accent-primary"],
      [derivation("Precise", ["--color-accent-primary"]), derivation("Direct", [], ["no-hedging"])],
    );
    expect(result.ok).toBe(true);
  });

  // ------------------------------------------------------------------
  // THE FAILING FIXTURE — this is the check the task's bar requires: a
  // fixture that SHOULD fail, run, and confirmed to fail. Both of this
  // gate's two directions are exercised as their own, separately-quoted
  // failure, plus the two "nothing to check" fail-closed cases.
  // ------------------------------------------------------------------

  it("FAILS direction 1: a brandable slot with no derivation behind it at all", () => {
    const result = checkBrandCoverage(
      ["--color-accent-primary", "--color-accent-secondary"],
      [derivation("Precise", ["--color-accent-primary"])],
    );
    expect(result.ok).toBe(false);
    expect(result.slotsMissingDerivation).toEqual(["--color-accent-secondary"]);
    expect(result.unknownSlotsInDerivations).toEqual([]);
    expect(result.reason).toBe("coverage-gap");
  });

  it("FAILS direction 2: a derivation naming a slot that isn't in the brandable list", () => {
    const result = checkBrandCoverage(
      ["--color-accent-primary"],
      [derivation("Precise", ["--color-accent-primary", "--color-neutral-500"])],
    );
    expect(result.ok).toBe(false);
    expect(result.slotsMissingDerivation).toEqual([]);
    expect(result.unknownSlotsInDerivations).toEqual(["--color-neutral-500"]);
    expect(result.reason).toBe("coverage-gap");
  });

  it("FAILS CLOSED on zero brandable slots, even with real derivations present — never a vacuous pass", () => {
    const result = checkBrandCoverage([], [derivation("Precise", ["--color-accent-primary"])]);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("no-slots-provided");
    expect(result.slotsChecked).toBe(0);
    expect(result.derivationsChecked).toBe(1);
  });

  it("FAILS CLOSED on zero derivations, even with real brandable slots present — never a vacuous pass", () => {
    const result = checkBrandCoverage(["--color-accent-primary", "--color-accent-secondary"], []);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("no-derivations-provided");
    expect(result.derivationsChecked).toBe(0);
    expect(result.slotsChecked).toBe(2);
    expect(result.slotsMissingDerivation).toEqual(["--color-accent-primary", "--color-accent-secondary"]);
  });

  it("never reports ok:true when nothing was checked on either side — the exact bug this checker exists to rule out", () => {
    const result = checkBrandCoverage([], []);
    expect(result.ok).toBe(false);
    expect(result.slotsChecked).toBe(0);
    expect(result.derivationsChecked).toBe(0);
    // A caller inspecting only `ok` still fails correctly; `reason`
    // additionally tells "nothing to check" apart from a real gap.
    expect(result.reason).toBe("no-slots-provided");
  });

  it("is pure and order-independent: reordering brandableSlots/derivations does not change the verdict", () => {
    const a = checkBrandCoverage(
      ["--color-accent-primary", "--color-accent-secondary"],
      [derivation("Precise", ["--color-accent-secondary"]), derivation("Bold", ["--color-accent-primary"])],
    );
    const b = checkBrandCoverage(
      ["--color-accent-secondary", "--color-accent-primary"],
      [derivation("Bold", ["--color-accent-primary"]), derivation("Precise", ["--color-accent-secondary"])],
    );
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
  });
});
