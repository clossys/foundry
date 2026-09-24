/** CLI for an explicit consumer position ledger and its supplied role contract. */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { validateInstalledPositionLedger } from "./index.js";

function read(path: string): unknown { return JSON.parse(readFileSync(resolve(path), "utf8")); }
export function main(argv = process.argv.slice(2)): number {
  if ((argv.length !== 1 && argv.length !== 2) || argv.some((value) => value.startsWith("-"))) { console.error("Usage: foundry-position-check <position-ledger.json> [role-contract.json]"); return 2; }
  try {
    const report = validateInstalledPositionLedger(read(argv[0] as string), argv[1] === undefined ? undefined : read(argv[1]));
    for (const item of report.findings) console.log(`FAIL ${item.rule} ${item.path} — ${item.message}`);
    if (!report.ok) return 1;
    // Advisories never affect the verdict above: they flag a migration worth
    // making, not a defect in this ledger. Printed to stderr, not stdout, so
    // a 0.9.10 consumer script reading stdout still sees exactly the one OK
    // line it always did -- stdout for a passing ledger is unchanged.
    for (const item of report.advisories ?? []) console.error(`ADVISORY ${item.rule} ${item.path} — ${item.message}`);
    console.log(`INSTALLED POSITION LEDGER OK — ${report.openRoles} open role(s), ${report.positions} complete position(s). No adoption, grounding, or closure is inferred.`);
    return 0;
  } catch (error) { console.error(`foundry-position-check: could not read input: ${error instanceof Error ? error.message : String(error)}`); return 2; }
}
