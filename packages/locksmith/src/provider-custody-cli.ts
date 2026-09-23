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
 *
 * `--json` prints `providerCustodyReport`'s docs/contracts/check-output-
 * envelope.json-conforming report instead of the human-readable lines below
 * — this package's own "check command['s] JSON report" the contract
 * describes (issue #1174/#1190). The default (no flag) output is unchanged
 * from before that contract existed, for anyone already parsing it.
 */
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateProviderCustody, providerCustodyReport } from "./provider-custody.js";
import type { ProviderCustodyEvaluation } from "./provider-custody.js";

export const USAGE = `Usage: clossys-locksmith-provider-custody [--json] <declaration.json>

Judges one value-free provider-token custody declaration (Cloudflare, Vercel,
or GitHub) against the closed custody ladder in @clossys/locksmith. Reads,
stores, and transmits no token value.

--json prints the docs/contracts/check-output-envelope.json-conforming
report instead of the default human-readable lines.

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
  if (evaluation.findings.length > 0) lines.push(`reasons: ${evaluation.findings.map((finding) => finding.rule).join(", ")}`);
  if (evaluation.verdict === "indeterminate") {
    lines.push("", "An indeterminate result is a failure, not a warning. This declaration could not be read as one of the closed custody shapes this command judges.");
  }
  return `${lines.join("\n")}\n`;
}

/**
 * This package's own `package.json` `version`, read once per `--json`
 * invocation. Falls back to `"0.0.0"` if the file cannot be read (a broken
 * install) rather than throwing — a report with an unreadable version is
 * still more useful than no report, and `verdict`/`findings` are unaffected
 * either way.
 */
function packageVersion(): string {
  try {
    const manifestUrl = new URL("../package.json", import.meta.url);
    const manifest = JSON.parse(readFileSync(fileURLToPath(manifestUrl), "utf8")) as { version?: unknown };
    return typeof manifest.version === "string" ? manifest.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

/** Testable CLI dispatcher. Invalid arguments throw; the executable maps them to exit 2. */
export function main(argv: readonly string[]): number {
  const json = argv.includes("--json");
  const rest = argv.filter((value) => value !== "--json");
  if (rest.length === 1 && (rest[0] === "--help" || rest[0] === "-h")) {
    console.log(USAGE);
    return 0;
  }
  if (rest.length !== 1) throw new LocksmithCliInputError("exactly one declaration.json file is required");
  const declaration = readProviderCustodyJson(rest[0] as string);
  if (json) {
    const report = providerCustodyReport(declaration, packageVersion());
    console.log(JSON.stringify(report, null, 2));
    return { satisfied: 0, violated: 1, indeterminate: 2 }[report.verdict];
  }
  const evaluation = evaluateProviderCustody(declaration);
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
