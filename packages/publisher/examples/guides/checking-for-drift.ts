import { citeFact } from "@clossys/publisher/record";
const ledger: import("@clossys/publisher/record").Ledger = [{ id: "example-publication", publishedAt: "2026-10-01T00:00:00Z", channel: "web", strategyRevision: "example-v1", factCitations: [citeFact("active-customers", 5000)] }];

import { checkLedgerDrift } from "@clossys/publisher/record";
// readStrategy comes from @clossys/strategist — the caller's job, not this package's

const currentValues = { "active-customers": 5000 }; // read from the caller's own facts.json, not from this package

const report = checkLedgerDrift(ledger, currentValues);
if (!report.ok) {
  console.error(`Checked ${report.entriesChecked} entries, ${report.citationsChecked} citations: ${report.citationsDrifted} drifted.`);
  for (const f of report.findings) console.error(`[${f.severity}] ${f.rule}: ${f.message}`);
  process.exitCode = report.citationsDrifted > 0 ? 1 : 2;
}
