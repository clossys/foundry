import { describe, expect, it } from "vitest";
import { checkLedgerDrift } from "./drift.js";
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

describe("checkLedgerDrift", () => {
  it("reports ok:true with an accurate checked count when the current value matches", () => {
    const ledger = [entry("a")];
    const result = checkLedgerDrift(ledger, { "active-customers": 4200 });
    expect(result.ok).toBe(true);
    expect(result.entriesChecked).toBe(1);
    expect(result.citationsChecked).toBe(1);
    expect(result.citationsDrifted).toBe(0);
    expect(result.citationsUnchecked).toBe(0);
    expect(result.findings).toEqual([]);
  });

  it("reports ok:false with a fact-drift finding when the current value has changed — and the report is visibly different from the clean one", () => {
    const ledger = [entry("a")];
    const clean = checkLedgerDrift(ledger, { "active-customers": 4200 });
    const drifted = checkLedgerDrift(ledger, { "active-customers": 5000 });

    expect(clean.ok).toBe(true);
    expect(drifted.ok).toBe(false);
    expect(drifted.citationsDrifted).toBe(1);
    expect(drifted.findings.some((f) => f.rule === "fact-drift")).toBe(true);

    // Not just a different boolean — a different shape entirely: findings
    // length, citationsDrifted count, and the rendered finding text all
    // differ between the two reports.
    expect(clean.findings.length).toBe(0);
    expect(drifted.findings.length).toBeGreaterThan(0);
    expect(JSON.stringify(clean)).not.toBe(JSON.stringify(drifted));
  });

  it("fails closed on an empty ledger — never reports 'no drift detected'", () => {
    const result = checkLedgerDrift([], {});
    expect(result.ok).toBe(false);
    expect(result.entriesChecked).toBe(0);
    expect(result.citationsChecked).toBe(0);
    expect(result.findings).toEqual([expect.objectContaining({ rule: "empty-ledger", severity: "error" })]);
  });

  it("fails closed on a malformed ledger", () => {
    const result = checkLedgerDrift("not a ledger", {});
    expect(result.ok).toBe(false);
    expect(result.findings.some((f) => f.rule === "ledger-invalid")).toBe(true);
  });

  it("fails closed when the ledger has entries but currentValues supplies nothing checkable", () => {
    const ledger = [entry("a")];
    const result = checkLedgerDrift(ledger, {});
    expect(result.ok).toBe(false);
    expect(result.entriesChecked).toBe(1);
    expect(result.citationsChecked).toBe(0);
    expect(result.citationsUnchecked).toBe(1);
    expect(result.findings.some((f) => f.rule === "no-citations-checked")).toBe(true);
    expect(result.findings.some((f) => f.rule === "fact-unchecked")).toBe(true);
  });

  it("fails closed when every entry cites zero facts", () => {
    const ledger = [entry("a", { factCitations: [] })];
    const result = checkLedgerDrift(ledger, {});
    expect(result.ok).toBe(false);
    expect(result.entriesChecked).toBe(1);
    expect(result.citationsChecked).toBe(0);
    expect(result.findings.some((f) => f.rule === "no-citations-checked")).toBe(true);
  });

  it("does not fail solely because some citations are unchecked, as long as at least one was checked and none drifted", () => {
    const ledger = [entry("a", { factCitations: [citeFact("active-customers", 4200), citeFact("nps", 62)] })];
    const result = checkLedgerDrift(ledger, { "active-customers": 4200 }); // "nps" not supplied
    expect(result.ok).toBe(true);
    expect(result.citationsChecked).toBe(1);
    expect(result.citationsUnchecked).toBe(1);
    expect(result.findings.some((f) => f.rule === "fact-unchecked")).toBe(true);
  });

  it("checks every entry across a multi-entry ledger, aggregating counts", () => {
    const ledger = [
      entry("a", { factCitations: [citeFact("active-customers", 4200)] }),
      entry("b", { factCitations: [citeFact("active-customers", 4200), citeFact("nps", 62)] }),
    ];
    const result = checkLedgerDrift(ledger, { "active-customers": 5000, nps: 62 }); // active-customers drifted
    expect(result.entriesChecked).toBe(2);
    expect(result.citationsChecked).toBe(3);
    expect(result.citationsDrifted).toBe(2); // both entries cited the drifted fact
    expect(result.ok).toBe(false);
  });

  it("is order-insensitive to object key ordering when comparing a Money-shaped current value", () => {
    const ledger = [entry("a", { factCitations: [citeFact("arr", { amount: 4_200_000, currency: "USD" })] })];
    const result = checkLedgerDrift(ledger, { arr: { currency: "USD", amount: 4_200_000 } });
    expect(result.ok).toBe(true);
    expect(result.citationsDrifted).toBe(0);
  });
});
