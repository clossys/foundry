#!/usr/bin/env node
/**
 * `clossys-locksmith-secret-environments` -- the CLI for
 * `secretEnvironmentsReport` (`./secret-environments.ts`).
 *
 * Reads one caller-assembled JSON secret declaration and zero or more
 * names-only inventory snapshot files, then judges them together. It never
 * reads, prints, or transmits a secret value: only file paths reach this
 * module's own code, and everything it forwards to the evaluator is parsed
 * JSON handed straight to `secretEnvironmentsReport`, which is itself held to
 * that same discipline (see `./secret-environments.ts`'s header comment). A
 * file this command cannot parse is reported by naming its path and its
 * role only -- never the parser's own error text, and never the file's
 * contents -- so a `.env`-shaped decoy sitting in a file some caller pointed
 * this command at can never surface in this command's own output.
 *
 * Mirrors `provider-custody-cli.ts`'s realpath-guarded direct-invocation
 * shape, and `ci-conventions-cli.ts`'s `--mode report|enforce` exit contract
 * exactly: `report` (the default) never exits 1, and prints the same
 * one-line stderr note that command does when a finding was printed but the
 * exit code stayed 2 rather than becoming 1.
 *
 * Exit codes:
 *
 *   0 -- satisfied.
 *   1 -- violated, in `--mode enforce` only.
 *   2 -- indeterminate, bad input, or (in `--mode report`) violated -- report
 *        mode never exits 1.
 */
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { secretEnvironmentsReport } from "./secret-environments.js";

export const USAGE = `Usage: clossys-locksmith-secret-environments --declaration <file> [--inventory <file> ...] [--mode report|enforce]

Reconciles one value-free secret declaration against zero or more names-only
inventory snapshots (@clossys/locksmith). Reads, stores, and transmits no
secret value -- only names, environments, storage kinds, and opaque
provider-issued identifiers ever reach this command's output.

Options:
  --declaration <file>      Required, exactly once. Path to a version-2 secret
                             declaration JSON file.
  --inventory <file>        Path to a version-1 inventory snapshot JSON file.
                             May be given any number of times, including zero.
  --mode <report|enforce>   Defaults to "report". See exit codes below.
  --help, -h                Print this message and exit 0.

Exit codes:
  0 = satisfied
  1 = violated, in --mode enforce only
  2 = indeterminate, bad input, or (in --mode report) violated -- report mode
      never exits 1
`;

export class LocksmithCliInputError extends Error {}

interface ParsedArgs {
  readonly declarationPath?: string;
  readonly inventoryPaths: readonly string[];
  readonly mode: "report" | "enforce";
  readonly help: boolean;
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  let declarationPath: string | undefined;
  const inventoryPaths: string[] = [];
  let mode: "report" | "enforce" = "report";
  let modeGiven = false;
  let help = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case "--help":
      case "-h":
        help = true;
        break;
      case "--declaration": {
        if (declarationPath !== undefined) throw new LocksmithCliInputError("--declaration may be given only once");
        const value = argv[index + 1];
        if (value === undefined) throw new LocksmithCliInputError("--declaration requires a value");
        declarationPath = value;
        index += 1;
        break;
      }
      case "--inventory": {
        const value = argv[index + 1];
        if (value === undefined) throw new LocksmithCliInputError("--inventory requires a value");
        inventoryPaths.push(value);
        index += 1;
        break;
      }
      case "--mode": {
        if (modeGiven) throw new LocksmithCliInputError("--mode may be given only once");
        const value = argv[index + 1];
        if (value !== "report" && value !== "enforce") {
          throw new LocksmithCliInputError(`--mode must be "report" or "enforce", got ${JSON.stringify(value ?? null)}`);
        }
        mode = value;
        modeGiven = true;
        index += 1;
        break;
      }
      default:
        if (typeof arg === "string" && arg.startsWith("--")) throw new LocksmithCliInputError(`unknown option: ${arg}`);
        throw new LocksmithCliInputError(`unexpected argument: ${String(arg)}`);
    }
  }

  return { declarationPath, inventoryPaths, mode, help };
}

/** Reads caller-owned evidence without treating it as validated. On any failure, names only the path and role -- never the parser's error text or the file's contents. */
function readJsonFile(path: string, role: string): unknown {
  const resolved = resolve(path);
  try {
    if (!existsSync(resolved) || !statSync(resolved).isFile()) throw new Error("not a readable file");
    return JSON.parse(readFileSync(resolved, "utf8"));
  } catch {
    throw new LocksmithCliInputError(`${role} file "${path}" could not be read as JSON`);
  }
}

/**
 * This package's own `package.json` `version`, read once per invocation.
 * Falls back to `"0.0.0"` if it cannot be read (a broken install) rather than
 * throwing -- a report with an unreadable version is still more useful than
 * no report, and `verdict`/`findings` are unaffected either way.
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

const EXIT_CODES = {
  report: { satisfied: 0, violated: 2, indeterminate: 2 },
  enforce: { satisfied: 0, violated: 1, indeterminate: 2 },
} as const;

/** Testable CLI dispatcher. Invalid arguments throw; the executable maps them to exit 2. */
export function main(argv: readonly string[]): number {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(USAGE);
    return 0;
  }
  if (args.declarationPath === undefined) throw new LocksmithCliInputError("--declaration is required");

  const declaration = readJsonFile(args.declarationPath, "declaration");
  const inventories = args.inventoryPaths.map((path) => readJsonFile(path, "inventory"));

  const report = secretEnvironmentsReport({ declaration, inventories }, packageVersion());
  console.log(JSON.stringify(report, null, 2));

  if (args.mode === "report" && report.verdict === "violated") {
    console.error(
      `clossys-locksmith-secret-environments: report mode -- ${report.findings.length} finding(s) printed above, exit code 2 (not 1). Switch --mode enforce once this declaration's drift is resolved or declared as an exception.`,
    );
  }

  return EXIT_CODES[args.mode][report.verdict];
}

function run(): void {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (cause) {
    if (cause instanceof LocksmithCliInputError) {
      console.error(`clossys-locksmith-secret-environments: ${cause.message}`);
      console.error(USAGE);
    } else {
      console.error("clossys-locksmith-secret-environments: an unexpected error prevented this check from running.");
    }
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
