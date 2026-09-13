/** I/O wrapper for repository-package-adoption-check; all judgement stays in adoption.ts. */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { gateResultToExitCode } from "../gates/result.js";
import { evaluateRepositoryPackageAdoption, type RepositoryPackageAdoptionEvaluationInput, type RepositoryPackageAdoptionResult } from "./adoption.js";

const USAGE = `Usage: repository-package-adoption-check <adoption.json> <evaluation.json>
       repository-package-adoption-check <evaluation-input.json>

Two-argument form (unchanged): human-readable, phase-local text on stdout.
  Exit codes: 0 = the reported phase is satisfied, 1 = violated, 2 = indeterminate.
  Foundation, canary, and cutover readiness are phase-local evidence, never an
  activation or closure claim.

One-argument form: one JSON document on stdout, no prose. <evaluation-input.json>
  is a single file carrying every field the two-argument form's <evaluation.json>
  carries, plus "adoption" (the two-argument form's <adoption.json> content)
  inlined as one more top-level field -- the same shape evaluateRepositoryPackageAdoption
  already accepts as one object.
  Output: {"state":"satisfied"|"violated"|"indeterminate","findings":[...]}
    "state" is the canonical, non-phase-local verdict; it is never a *-ready,
    *-incomplete, or *-violated phase status. Exit codes agree with "state":
    0 = satisfied, 1 = violated, 2 = indeterminate. "findings" is a "violated"
    result's findings (each {rule, path, message}), otherwise empty; an
    "indeterminate" result also carries "reason" and, when present, "detail".
`;
function json(path: string): unknown { return JSON.parse(readFileSync(resolve(path), "utf8")); }
function canonicalReport(result: RepositoryPackageAdoptionResult): Record<string, unknown> {
  if (result.verdict === "violated") {
    return { state: "violated", findings: result.findings.map((entry) => ({ rule: entry.rule, path: entry.path, message: entry.message })) };
  }
  if (result.verdict === "indeterminate") {
    return { state: "indeterminate", findings: [], reason: result.reason, ...(result.detail !== undefined ? { detail: result.detail } : {}) };
  }
  return { state: "satisfied", findings: [] };
}
/**
 * The single-input canonical-JSON form. Kept fully separate from the
 * two-argument form's try/catch below so a read or parse failure here can
 * never fall through to that form's plain-text error path -- this form must
 * always emit parseable JSON carrying "state", whatever goes wrong.
 */
function runSingleInput(path: string, write: (line: string) => void): 0 | 1 | 2 {
  try {
    const input = json(path);
    const report = evaluateRepositoryPackageAdoption(input as RepositoryPackageAdoptionEvaluationInput);
    write(JSON.stringify(canonicalReport(report.result)));
    return gateResultToExitCode(report.result);
  } catch (error) {
    write(JSON.stringify({ state: "indeterminate", findings: [], reason: "unreadable-input", detail: error instanceof Error ? error.message : String(error) }));
    return 2;
  }
}
export function main(argv: readonly string[] = process.argv.slice(2), write: (line: string) => void = console.log): 0 | 1 | 2 {
  if (argv.length === 1 && argv[0] === "--help") { write(USAGE.trim()); return 0; }
  if (argv.length === 1) return runSingleInput(argv[0]!, write);
  if (argv.length !== 2) { write(USAGE.trim()); return 2; }
  try {
    const adoption = json(argv[0]!);
    const evaluation = json(argv[1]!);
    if (typeof evaluation !== "object" || evaluation === null || Array.isArray(evaluation)) { write("evaluation JSON must be an object"); return 2; }
    const report = evaluateRepositoryPackageAdoption({ ...(evaluation as Omit<RepositoryPackageAdoptionEvaluationInput, "adoption">), adoption });
    const scope = report.phase === "foundation" || report.phase === "post-main-canary" || report.phase === "atomic-ruleset-cutover"
      ? `${report.phase}; phase-local`
      : report.phase;
    write(`${report.status} (${scope})`);
    for (const entry of report.findings) write(`${entry.rule} ${entry.path}: ${entry.message}`);
    return gateResultToExitCode(report.result);
  } catch (error) { write(error instanceof Error ? error.message : String(error)); return 2; }
}
export function run(): void { process.exitCode = main(); }
