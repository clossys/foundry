import { describe, expect, it } from "vitest";
import { checkAppendOnly } from "./append-only-gate.js";
import { citeFact } from "./fact.js";
import type { PublicationEntry } from "./types.js";

function entry(id: string, overrides: Partial<PublicationEntry> = {}): PublicationEntry {
  return {
    id,
    publishedAt: "2026-08-07T14:03:00.000Z",
    channel: "web",
    strategyRevision: "strategy@1.4.0",
    factCitations: [citeFact("active-customers", 4200)],
    ...overrides,
  };
}

describe("checkAppendOnly", () => {
  it("reports no findings when next only adds entries after previous, unchanged", () => {
    const previous = [entry("a"), entry("b")];
    const next = [entry("a"), entry("b"), entry("c")];
    expect(checkAppendOnly(previous, next)).toEqual([]);
  });

  it("reports no findings when previous and next are identical", () => {
    const ledger = [entry("a"), entry("b")];
    expect(checkAppendOnly(ledger, ledger)).toEqual([]);
  });

  it("flags a removed entry", () => {
    const previous = [entry("a"), entry("b")];
    const next = [entry("a")];
    const findings = checkAppendOnly(previous, next);
    expect(findings.some((f) => f.rule === "entries-removed")).toBe(true);
  });

  it("flags a removed entry even when total count stays the same (swapped for a different one)", () => {
    const previous = [entry("a"), entry("b")];
    const next = [entry("a"), entry("c")];
    const findings = checkAppendOnly(previous, next);
    expect(findings.some((f) => f.rule === "entry-removed" && f.path === "b")).toBe(true);
  });

  it("flags a mutated entry (same id, different content)", () => {
    const previous = [entry("a", { channel: "web" })];
    const next = [entry("a", { channel: "email" })];
    const findings = checkAppendOnly(previous, next);
    expect(findings.some((f) => f.rule === "entry-mutated" && f.path === "a")).toBe(true);
  });

  it("flags a reordered entry", () => {
    const previous = [entry("a"), entry("b")];
    const next = [entry("b"), entry("a")];
    const findings = checkAppendOnly(previous, next);
    expect(findings.some((f) => f.rule === "entry-reordered")).toBe(true);
  });

  it("does not flag a mutation from key-order-only JSON round-tripping", () => {
    const previous = [entry("a")];
    // Simulate a JSON round-trip that reorders object keys but changes
    // nothing structurally — canonicalizeValue must treat these as equal.
    const roundTripped = JSON.parse(
      JSON.stringify(previous[0], (key, value) =>
        value && typeof value === "object" && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).reverse()) : value,
      ),
    );
    const next = [roundTripped];
    expect(checkAppendOnly(previous, next)).toEqual([]);
  });

  it("fails closed when previous itself does not validate", () => {
    const findings = checkAppendOnly("not a ledger", [entry("a")]);
    expect(findings).toEqual([expect.objectContaining({ rule: "previous-ledger-invalid", severity: "error" })]);
  });

  it("fails closed when next does not validate", () => {
    const findings = checkAppendOnly([entry("a")], "not a ledger");
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.every((f) => f.rule.startsWith("next-"))).toBe(true);
  });
});
