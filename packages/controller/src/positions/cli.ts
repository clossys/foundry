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
    console.log(`INSTALLED POSITION LEDGER OK — ${report.openRoles} open role(s), ${report.positions} complete position(s). No adoption, grounding, or closure is inferred.`);
    return 0;
  } catch (error) { console.error(`foundry-position-check: could not read input: ${error instanceof Error ? error.message : String(error)}`); return 2; }
}
