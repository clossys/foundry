const previousLedgerJson: unknown = [];
const nextLedgerJson: unknown = [];

import { checkAppendOnly } from "@clossys/publisher/record";

const findings = checkAppendOnly(previousLedgerJson, nextLedgerJson); // e.g. base ref vs. head ref in a CI job
if (findings.length > 0) {
  for (const f of findings) console.error(`[${f.severity}] ${f.rule}: ${f.message}`);
  process.exitCode = 1;
}
