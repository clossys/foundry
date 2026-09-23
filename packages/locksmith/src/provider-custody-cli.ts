#!/usr/bin/env node
/**
 * `clossys-locksmith-provider-custody` — the CLI for `evaluateProviderCustody`
 * (`./provider-custody.ts`).
 *
 * Reads one caller-assembled JSON custody declaration and judges it. It
 * never mints, fetches, rotates, or reads a token value, and it never talks
 * to Cloudflare, Vercel, or GitHub — a caller (or a governance file) is
 * responsible for writing the declaration first, exactly as
 * `evaluateProviderCustody`'s own contract requires. Mirrors
 * `controlled-key-rate-cli.ts`'s direct-invocation shape rather than
 * `cli.ts`'s port-injected one — no filesystem behavior here needs to be
 * swapped out under test beyond `readFileSync`/`JSON.parse`, the same
 * reasoning `controlled-key-rate-cli.ts` already documents for its own
 * shape.
 *
 * Exit codes — `evaluateProviderCustody`'s own ternary, unchanged:
 *
 *   0 — satisfied.
 *   1 — violated: the declaration itself proves a real problem (an
 *       unsupported provider or rung, a store literal that names this
 *       repository, a missing least-privilege note, ...).
 *   2 — indeterminate: the declaration could not be read at all, or was not
 *       even a plain object with the closed field set. Never a pass.
 */
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateProviderCustody } from "./provider-custody.js";
import type { ProviderCustodyEvaluation } from "./provider-custody.js";

export const USAGE = `Usage: clossys-locksmith-provider-custody <declaration.json>

Judges one value-free provider-token custody declaration (Cloudflare, Vercel,
or GitHub) against the closed custody ladder in @clossys/locksmith. Reads,
stores, and transmits no token value.

Exit codes: 0 = satisfied, 1 = violated, 2 = indeterminate or unreadable.
`;

export class LocksmithCliInputError extends Error {}

/** Reads caller-owned declaration evidence without treating it as validated. */
export function readProviderCustodyJson(path: string): unknown {
  const resolved = resolve(path);
  if (!existsSync(resolved)) throw new LocksmithCliInputError(`declaration file "${path}" does not exist`);
  try {
    if (!statSync(resolved).isFile()) throw new LocksmithCliInputError(`declaration file "${path}" is not a file`);
    return JSON.parse(readFileSync(resolved, "utf8"));
  } catch (cause) {
    if (cause instanceof LocksmithCliInputError) throw cause;
    throw new LocksmithCliInputError(`declaration file "${path}" is unreadable JSON: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
}

function renderReport(evaluation: ProviderCustodyEvaluation): string {
  const lines = [
    `key: ${evaluation.key ?? "<unresolved>"}`,
    `provider: ${evaluation.provider ?? "<unresolved>"}`,
    `rung: ${evaluation.rung ?? "<unresolved>"}`,
    `verdict: ${evaluation.verdict.toUpperCase()} (exit ${evaluation.exitCode})`,
  ];
  if (evaluation.reasons.length > 0) lines.push(`reasons: ${evaluation.reasons.join(", ")}`);
  if (evaluation.verdict === "indeterminate") {
    lines.push("", "An indeterminate result is a failure, not a warning. This declaration could not be read as one of the closed custody shapes this command judges.");
  }
  return `${lines.join("\n")}\n`;
}

/** Testable CLI dispatcher. Invalid arguments throw; the executable maps them to exit 2. */
export function main(argv: readonly string[]): number {
  if (argv.length === 1 && (argv[0] === "--help" || argv[0] === "-h")) {
    console.log(USAGE);
    return 0;
  }
  if (argv.length !== 1) throw new LocksmithCliInputError("exactly one declaration.json file is required");
  const evaluation = evaluateProviderCustody(readProviderCustodyJson(argv[0] as string));
  console.log(renderReport(evaluation));
  return evaluation.exitCode;
}

function run(): void {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (cause) {
    console.error(`clossys-locksmith-provider-custody: ${cause instanceof Error ? cause.message : String(cause)}`);
    process.exitCode = 2;
  }
}

/** Resolves an npm/POSIX bin symlink before deciding whether this module is the entrypoint. */
export function isDirectInvocation(moduleUrl: string, argvPath: string | undefined): boolean {
  if (argvPath === undefined) return false;
  try {
    return realpathSync(fileURLToPath(moduleUrl)) === realpathSync(resolve(argvPath));
  } catch {
    return false;
  }
}

if (isDirectInvocation(import.meta.url, process.argv[1])) run();
