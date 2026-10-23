import { appendEntry, citeFact, type Ledger, type PublicationEntry } from "@clossys/publisher/record";

let ledger: Ledger = [];

const entry: PublicationEntry = {
  id: "pricing-page-2026-08-07",
  publishedAt: new Date().toISOString(),
  channel: "web",
  url: "https://example.com/pricing",
  strategyRevision: "strategy@1.4.0",
  factCitations: [citeFact("active-customers", 4200)],
};

ledger = appendEntry(ledger, entry); // returns a NEW, deep-frozen ledger

export { ledger };
