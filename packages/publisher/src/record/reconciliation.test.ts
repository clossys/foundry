import { appendEntry } from "./append.js";
import { checkLedgerDrift } from "./drift.js";
import {
  asLedgerDriftSubject,
  checkRegistryPublicationReconciliation,
  proposeRegistryPublicationEntry,
  registryPublicationEntryId,
} from "./reconciliation.js";
import type { Ledger } from "./types.js";

const witness = {
  packageName: "@clossys/example",
  version: "1.2.3",
  tarballSha256: "4e07408562bedb8b60ce05c1decfe3ad16b72230967de01f640b7e4729b49fce",
  publishedAt: "2026-08-22T12:00:00.000Z",
};

describe("registryPublicationEntryId", () => {
  it("joins scoped name and version", () => {
    expect(registryPublicationEntryId("@clossys/example", "1.2.3")).toBe("@clossys/example@1.2.3");
  });
});

describe("proposeRegistryPublicationEntry", () => {
  it("builds a deterministic entry a publish path can append", () => {
    const first = proposeRegistryPublicationEntry({ witness, strategyRevision: "qual-abc" });
    const second = proposeRegistryPublicationEntry({ witness, strategyRevision: "qual-abc" });
    expect(first).toEqual(second);
    expect(first.id).toBe("@clossys/example@1.2.3");
    expect(first.channel).toBe("npm-registry");
    expect(first.contentBinding).toBeDefined();
  });
});

describe("checkRegistryPublicationReconciliation", () => {
  it("passes when the ledger carries the producer entry for the witness", () => {
    const entry = proposeRegistryPublicationEntry({ witness, strategyRevision: "qual-abc" });
    const ledger: Ledger = appendEntry([], entry);
    const report = checkRegistryPublicationReconciliation(ledger, witness);
    expect(report.ok).toBe(true);
    expect(report.entriesChecked).toBe(1);
  });

  it("fails when the registry tarball digest disagrees", () => {
    const entry = proposeRegistryPublicationEntry({ witness, strategyRevision: "qual-abc" });
    const ledger: Ledger = appendEntry([], entry);
    const report = checkRegistryPublicationReconciliation(ledger, {
      ...witness,
      tarballSha256: "0000000000000000000000000000000000000000000000000000000000000000",
    });
    expect(report.ok).toBe(false);
    expect(report.findings.some((f) => f.rule === "registry-tarball-mismatch")).toBe(true);
  });
});

describe("asLedgerDriftSubject", () => {
  it("pairs a valid ledger with a current-values map for checkLedgerDrift", () => {
    const entry = proposeRegistryPublicationEntry({ witness, strategyRevision: "qual-abc" });
    const ledger: Ledger = appendEntry([], entry);
    const parsed = asLedgerDriftSubject(ledger, { "published-items": 3 });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const drift = checkLedgerDrift(parsed.subject.ledger, parsed.subject.currentValues);
    expect(drift.entriesChecked).toBe(1);
  });
});
