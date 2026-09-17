/**
 * `clossys-locksmith-credential` — the CLI for `evaluateCredential`
 * (`./credential.ts`).
 *
 * `evaluateCredential` and `defineCredentialEvidence` shipped real ternary
 * machinery mapping satisfied/violated/indeterminate credential lifecycle
 * evidence to exit codes 0/1/2, and no way for any caller to reach it except
 * by importing the library directly. Until this file existed, the package's
 * only bin (`infisical/cli.ts`) relayed an unrelated subprocess's own exit
 * code and never touched this machinery — `evaluateCredential` existed as a
 * primitive but never operated. This file is that missing bin, and the
 * package's second one: it reads one caller-assembled evidence document and
 * reports `evaluateCredential`'s verdict, unchanged.
 *
 * PORT-INJECTED, LIKE `@clossys/inspector`'s AND `@clossys/observer`'s CLIs
 * -----------------------------------------------------------------------
 * Everything this file touches outside itself goes through `CliPort`: `./bin.ts`
 * is the installed executable and supplies the real port (`node:fs`,
 * `process.stdout`/`stderr`); this file exports `main(argv, port)`, testable
 * with an in-memory port and no real filesystem. `main` returns the exit
 * code rather than setting `process.exitCode` itself, for the same reason
 * every sibling CLI in this repository does: a test can assert on it
 * directly, and nothing here can exit a host process that only wanted to
 * call this as a function.
 *
 * WHAT THIS CLI DOES AND DOES NOT DO
 * -----------------------------------
 * This command reads ONE JSON evidence document and judges it. It never
 * mints, fetches, rotates, or reads a credential VALUE, and it never talks
 * to a provider — a caller's own collection step is responsible for
 * assembling evidence about a credential's lifecycle (its declared scope,
 * its job's start and end, whether provider metadata proves manual
 * rotation) before this command ever runs, exactly as `evaluateCredential`'s
 * own contract already requires. It performs no collection of its own.
 *
 * Exit codes — `evaluateCredential`'s own ternary, unchanged:
 *
 *   0 — satisfied.
 *   1 — violated: the evidence itself proves a real problem (missing scope,
 *       an unproven ephemeral-job expiry, an unsupported provider, ...).
 *   2 — indeterminate: the evidence could not be read at all, or could not
 *       establish what it needed to. Never a pass.
 *
 * There is no flag that turns a `2` or a `1` into a `0`. Whether either
 * blocks a merge is a caller's own decision, made at the call site.
 */

import { evaluateCredential } from "./credential.js";
import type { CredentialEvaluation } from "./credential.js";

export const USAGE = `Usage: clossys-locksmith-credential --evidence <path> [options]

  --evidence <path>      Required. A JSON document carrying one credential's lifecycle
                         evidence, in the shape evaluateCredential (@clossys/locksmith)
                         accepts. The calling workflow assembles it; this command performs
                         no collection of its own.
  --format <text|json>   Output format. Defaults to text.
  --help                 Print this message and exit 0.

Exit codes: 0 = satisfied, 1 = violated, 2 = indeterminate (including unreadable input).
`;

/** Everything this CLI touches outside itself. Injected so no test needs a filesystem. */
export interface CliPort {
  /** Reads a text file. Throws for any failure; the caller turns that into exit 2. */
  readTextFile(path: string): string;
  writeOut(text: string): void;
  writeErr(text: string): void;
}

/** Thrown for anything wrong with the arguments themselves. Always exit 2, never 1. */
export class CliInputError extends Error {}

interface ParsedArgs {
  readonly evidencePath?: string;
  readonly format: "text" | "json";
  readonly help: boolean;
}

/** Parses argv. Exported so its edge cases can be tested without a process. */
export function parseArgs(argv: readonly string[]): ParsedArgs {
  let evidencePath: string | undefined;
  let format: "text" | "json" = "text";
  let help = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] as string;
    switch (arg) {
      case "--help":
      case "-h":
        help = true;
        break;
      case "--evidence": {
        const value = argv[++index];
        if (value === undefined) throw new CliInputError("--evidence requires a value");
        evidencePath = value;
        break;
      }
      case "--format": {
        const value = argv[++index];
        if (value !== "text" && value !== "json") {
          throw new CliInputError(`--format must be "text" or "json", got ${JSON.stringify(value)}`);
        }
        format = value;
        break;
      }
      default:
        throw new CliInputError(
          arg.startsWith("-")
            ? `unknown flag "${arg}"`
            : `unexpected argument "${arg}" — every input to this command is named`,
        );
    }
  }

  return { evidencePath, format, help };
}

/** Renders the verdict as a short human-readable report. */
function renderReport(evaluation: CredentialEvaluation): string {
  const lines = [
    `key: ${evaluation.key ?? "<unresolved>"}`,
    `credentialClass: ${evaluation.credentialClass ?? "<unresolved>"}`,
    `verdict: ${evaluation.verdict.toUpperCase()} (exit ${evaluation.exitCode})`,
  ];
  if (evaluation.reasons.length > 0) {
    lines.push(`reasons: ${evaluation.reasons.join(", ")}`);
  }
  if (evaluation.verdict === "indeterminate") {
    lines.push(
      "",
      "An indeterminate result is a failure, not a warning. Something about this credential's " +
        "lifecycle could not be established from the evidence supplied.",
    );
  }
  return `${lines.join("\n")}\n`;
}

/**
 * Runs the command. Returns the exit code rather than setting it, so a test
 * can assert on it directly and so nothing here can exit a host process that
 * only wanted to call the CLI as a function.
 */
export function main(argv: readonly string[], port: CliPort): 0 | 1 | 2 {
  let args: ParsedArgs;
  try {
    args = parseArgs(argv);
  } catch (error) {
    port.writeErr(
      `clossys-locksmith-credential: ${error instanceof Error ? error.message : String(error)}\n\n${USAGE}`,
    );
    return 2;
  }

  if (args.help) {
    port.writeOut(USAGE);
    return 0;
  }

  if (args.evidencePath === undefined) {
    port.writeErr(`clossys-locksmith-credential: --evidence is required\n\n${USAGE}`);
    return 2;
  }

  // An unreadable or unparseable evidence file is exit 2 and never anything
  // else: the run did not happen, so it did not pass and it did not fail.
  let evidence: unknown;
  try {
    evidence = JSON.parse(port.readTextFile(args.evidencePath));
  } catch (error) {
    port.writeErr(
      `clossys-locksmith-credential: could not read the evidence document at ${args.evidencePath}: ` +
        `${error instanceof Error ? error.message : String(error)}\n`,
    );
    return 2;
  }

  // `evaluateCredential` never throws for a data problem — see its own
  // header, and its own `try/catch` wrapper — so there is no
  // catch-and-report-2 backstop needed here the way inspector's CLI needs
  // one for `verifyStandards`. Kept honest by this file's own test suite
  // calling `main` with adversarial evidence and asserting it always
  // returns a number rather than throwing.
  const evaluation = evaluateCredential(evidence);

  port.writeOut(args.format === "json" ? `${JSON.stringify(evaluation, null, 2)}\n` : renderReport(evaluation));
  return evaluation.exitCode;
}
