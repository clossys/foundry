#!/usr/bin/env node
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assessAdvisorEngagement } from "./assessment.js";
import { ContractDocumentError, readContractDocument } from "./contract-schema.js";

const USAGE = `Usage: advisor-check <assessment.json>\n\nAssess provider-neutral sponsor engagement evidence.\nExit codes: 0 = satisfied, 1 = violated, 2 = indeterminate or unreadable.`;
export class AdvisorCliInputError extends Error {}
/**
 * Reads caller-owned assessment evidence as strict JSON, without treating it
 * as validated: invalid UTF-8, a leading byte order mark, a key repeated in
 * any object, and a syntax error are refused by position only, never quoting
 * the file. The path in a message is the caller's own argument.
 */
export function readAdvisorAssessmentJson(path: string): unknown {
  const resolved = resolve(path);
  if (!existsSync(resolved)) throw new AdvisorCliInputError(`assessment file "${path}" does not exist`);
  let bytes: Uint8Array;
  try {
    if (!statSync(resolved).isFile()) throw new AdvisorCliInputError(`assessment file "${path}" is not a file`);
    bytes = readFileSync(resolved);
  } catch (cause) {
    if (cause instanceof AdvisorCliInputError) throw cause;
    throw new AdvisorCliInputError(`assessment file "${path}" could not be read`);
  }
  try {
    return readContractDocument(bytes);
  } catch (cause) {
    // readContractDocument() refuses by position only; a JSON.parse error would quote the file.
    const why = cause instanceof ContractDocumentError ? `: it ${cause.message}` : "";
    throw new AdvisorCliInputError(`assessment file "${path}" is unreadable as strict JSON${why}`);
  }
}
/** Testable CLI dispatcher. Invalid arguments throw; the executable maps them to exit 2. */
export function main(argv: readonly string[]): number { if (argv.length === 1 && (argv[0] === "--help" || argv[0] === "-h")) { console.log(USAGE); return 0; } if (argv.length !== 1) throw new AdvisorCliInputError("exactly one assessment.json file is required"); const report = assessAdvisorEngagement(readAdvisorAssessmentJson(argv[0] as string)); console.log(JSON.stringify(report, null, 2)); return report.state === "satisfied" ? 0 : report.state === "violated" ? 1 : 2; }
function run(): void { try { process.exitCode = main(process.argv.slice(2)); } catch (cause) { console.error(`advisor-check: ${cause instanceof Error ? cause.message : String(cause)}`); process.exitCode = 2; } }
/** Resolves an npm/POSIX bin symlink before deciding whether this module is the entrypoint. */
export function isDirectInvocation(moduleUrl: string, argvPath: string | undefined): boolean { if (argvPath === undefined) return false; try { return realpathSync(fileURLToPath(moduleUrl)) === realpathSync(resolve(argvPath)); } catch { return false; } }
if (isDirectInvocation(import.meta.url, process.argv[1])) run();
