import { describe, expect, it } from "vitest";
import { canonicalizeValue, citeFact } from "./fact.js";

describe("canonicalizeValue", () => {
  it("canonicalizes primitives", () => {
    expect(canonicalizeValue("hello")).toBe('"hello"');
    expect(canonicalizeValue(42)).toBe("42");
    expect(canonicalizeValue(true)).toBe("true");
    expect(canonicalizeValue(null)).toBe("null");
  });

  it("produces the same string for objects with keys in a different order", () => {
    const a = canonicalizeValue({ amount: 4_200_000, currency: "USD" });
    const b = canonicalizeValue({ currency: "USD", amount: 4_200_000 });
    expect(a).toBe(b);
  });

  it("distinguishes objects with different values under the same keys", () => {
    const a = canonicalizeValue({ amount: 4_200_000, currency: "USD" });
    const b = canonicalizeValue({ amount: 4_300_000, currency: "USD" });
    expect(a).not.toBe(b);
  });

  it("canonicalizes arrays and nested structures, order-sensitive for array elements", () => {
    expect(canonicalizeValue([1, 2, 3])).toBe("[1,2,3]");
    expect(canonicalizeValue([1, 2, 3])).not.toBe(canonicalizeValue([3, 2, 1]));
    expect(canonicalizeValue({ list: [{ b: 2, a: 1 }] })).toBe(canonicalizeValue({ list: [{ a: 1, b: 2 }] }));
  });

  it("throws on a non-finite number", () => {
    expect(() => canonicalizeValue(Number.NaN)).toThrow(/non-finite/);
    expect(() => canonicalizeValue(Number.POSITIVE_INFINITY)).toThrow(/non-finite/);
  });

  it("throws on a function or symbol", () => {
    expect(() => canonicalizeValue(() => {})).toThrow(/cannot canonicalize/);
    expect(() => canonicalizeValue(Symbol("x"))).toThrow(/cannot canonicalize/);
  });
});

describe("citeFact", () => {
  it("builds a FactCitation whose valueBinding.policyId equals factRef", () => {
    const citation = citeFact("active-customers", 4200);
    expect(citation.factRef).toBe("active-customers");
    expect(citation.valueBinding.policyId).toBe("active-customers");
    expect(citation.valueBinding.digestAlgorithm).toBe("sha256");
    expect(citation.valueBinding.digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it("produces the same digest for the same value regardless of object key order", () => {
    const a = citeFact("arr", { amount: 4_200_000, currency: "USD" });
    const b = citeFact("arr", { currency: "USD", amount: 4_200_000 });
    expect(a.valueBinding.digest).toBe(b.valueBinding.digest);
  });

  it("produces a different digest for a different value", () => {
    const a = citeFact("arr", { amount: 4_200_000, currency: "USD" });
    const b = citeFact("arr", { amount: 4_300_000, currency: "USD" });
    expect(a.valueBinding.digest).not.toBe(b.valueBinding.digest);
  });

  it("throws on an empty factRef", () => {
    expect(() => citeFact("", 1)).toThrow(/non-empty string/);
  });
});
