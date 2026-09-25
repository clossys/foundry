#!/usr/bin/env node
import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { isDirectInvocation } from "./cli.js";
import { ContractDocumentError, readContractDocument } from "./contract-schema.js";
import { packageRequest } from "./package-resolution.js";

const USAGE = `Usage: advisor-package-request <plan.json>\n\nNames the packages a staffed plan needs, for a registry snapshot: the package of\nevery staffed role and the starter package, sorted. Reads one file; makes no\nnetwork call. Prints a JSON report to stdout.\nExit codes: 0 = named, 1 = violated, 2 = unreadable input or usage error.`;

export class AdvisorPackageCliInputError extends Error {}

/**
 * Reads one input file as strict JSON (invalid UTF-8, a syntax error, or a
 * repeated key refused), without treating it as validated. A refusal names
 * which input and, for a syntax error, the character position, never the
 * file's path or any of its text.
 */
export function readStrictJsonInput(label: string, path: string): unknown {
  const resolved = resolve(path);
  if (!existsSync(resolved)) throw new AdvisorPackageCliInputError(`the ${label} file does not exist`);
  if (!statSync(resolved).isFile()) throw new AdvisorPackageCliInputError(`the ${label} file is not a file`);
  let bytes: Uint8Array;
  try {
    bytes = readFileSync(resolved);
  } catch {
    throw new AdvisorPackageCliInputError(`the ${label} file could not be read`);
  }
  try {
    return readContractDocument(bytes);
  } catch (cause) {
    if (cause instanceof ContractDocumentError) {
      const where = cause.position === undefined ? "" : ` at position ${cause.position}`;
      const why = cause.reason === "encoding" ? "is not valid UTF-8" : cause.reason === "repeated-key" ? "repeats a key in one object" : "is not valid JSON";
      throw new AdvisorPackageCliInputError(`the ${label} file ${why}${where}`);
    }
    throw new AdvisorPackageCliInputError(`the ${label} file is unreadable as strict JSON`);
  }
}

/** Testable CLI dispatcher. Invalid arguments or unreadable input throw; the executable maps them to exit 2. */
export function main(argv: readonly string[]): number {
  if (argv.length === 1 && (argv[0] === "--help" || argv[0] === "-h")) {
    console.log(USAGE);
    return 0;
  }
  if (argv.length !== 1) throw new AdvisorPackageCliInputError("exactly one plan.json file is required");
  const result = packageRequest(readStrictJsonInput("plan", argv[0] as string));
  console.log(JSON.stringify(result, null, 2));
  return result.state === "satisfied" ? 0 : 1;
}

function run(): void {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (cause) {
    console.error(`advisor-package-request: ${cause instanceof AdvisorPackageCliInputError ? cause.message : `failed unexpectedly (${cause instanceof Error ? cause.name : typeof cause})`}`);
    process.exitCode = 2;
  }
}

if (isDirectInvocation(import.meta.url, process.argv[1])) run();
