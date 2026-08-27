/** CLI for one consumer-owned completion-evidence record and its position ledger. */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { gateResultToExitCode } from "../gates/result.js";
import { validateCompletionEvidence } from "./completion-evidence.js";

function read(path: string): unknown { return JSON.parse(readFileSync(resolve(path), "utf8")); }

export function main(argv = process.argv.slice(2)): number {
  if (argv.length !== 2 || argv.some((value) => value.startsWith("-"))) {
    console.error("Usage: foundry-completion-evidence-check <completion-evidence.json> <position-ledger.json>");
    return 2;
  }
  try {
    const report = validateCompletionEvidence(read(argv[0] as string), read(argv[1] as string));
    if (report.result.verdict === "violated") for (const finding of report.findings) console.log(`FAIL ${finding.rule} ${finding.path} — ${finding.message}`);
    if (report.result.verdict === "indeterminate") {
      console.log(`INDETERMINATE ${report.result.reason}${report.result.detail ? ` — ${report.result.detail}` : ""}`);
      for (const finding of report.findings) console.log(`FAIL ${finding.rule} ${finding.path} — ${finding.message}`);
    }
    if (report.result.verdict === "satisfied") console.log(`COMPLETION EVIDENCE OK — ${report.package} position ${report.positionId} has a structurally consistent linked consumer record; opaque references are not authenticated.`);
    return gateResultToExitCode(report.result);
  } catch (error) {
    console.error(`foundry-completion-evidence-check: could not read input: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }
}
