/** I/O wrapper for repository-package-adoption-check; all judgement stays in adoption.ts. */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { gateResultToExitCode } from "../gates/result.js";
import { evaluateRepositoryPackageAdoption, type RepositoryPackageAdoptionEvaluationInput } from "./adoption.js";

const USAGE = `Usage: repository-package-adoption-check <adoption.json> <evaluation.json>\n\nExit codes: 0 = satisfied, 1 = violated, 2 = indeterminate.\n`;
function json(path: string): unknown { return JSON.parse(readFileSync(resolve(path), "utf8")); }
export function main(argv: readonly string[] = process.argv.slice(2), write: (line: string) => void = console.log): 0 | 1 | 2 {
  try {
    if (argv.length === 1 && argv[0] === "--help") { write(USAGE.trim()); return 0; }
    if (argv.length !== 2) { write(USAGE.trim()); return 2; }
    const adoption = json(argv[0]!);
    const evaluation = json(argv[1]!);
    if (typeof evaluation !== "object" || evaluation === null || Array.isArray(evaluation)) { write("evaluation JSON must be an object"); return 2; }
    const report = evaluateRepositoryPackageAdoption({ ...(evaluation as Omit<RepositoryPackageAdoptionEvaluationInput, "adoption">), adoption });
    write(`${report.result.verdict} (${report.phase})`);
    for (const entry of report.findings) write(`${entry.rule} ${entry.path}: ${entry.message}`);
    return gateResultToExitCode(report.result);
  } catch (error) { write(error instanceof Error ? error.message : String(error)); return 2; }
}
export function run(): void { process.exitCode = main(); }
