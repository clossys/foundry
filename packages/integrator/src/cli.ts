#!/usr/bin/env node
/**
 * `integrator-supersession-check` — the CLI for `detectSupersession`.
 * Presentation and I/O only: parse argv, read two JSON files, run the pure
 * mechanism, print a report, pick an exit code. All real logic lives in
 * `supersession.ts`.
 *
 * REPORT-ONLY BY DEFAULT. Without `--block`, this CLI always exits `0` --
 * it prints exactly what it found, including every conflicting pair, but
 * never fails a run over it. A consuming plane adopting this gate against
 * its own real supersession map is very likely to find a dozen pre-existing
 * pairs on day one, accumulated before this gate existed to catch them; a
 * gate that goes straight to red against that backlog teaches a team to
 * disable or ignore it rather than to work the list down. `--block` is the
 * one flag that turns this from a report into an enforced gate, once a
 * plane has actually looked at what it would fail on.
 *
 * The declining count is the artifact this CLI is built to make visible: run
 * report-only in CI on every change, watch `count` fall over time as pairs
 * are cleaned up, and flip `--block` on once it reaches (and a plane intends
 * to keep it at) zero.
 *
 * Exit codes with `--block` -- matching this repository's three-state
 * convention (`strategy-facts-check`, `copy-check`, `ledger-check`,
 * `foundry-check`):
 *
 *   0 — ran cleanly: the manifest and supersession map both validated, and
 *       no declared legacy/replacement pair was found installed together.
 *   1 — ran cleanly, but at least one declared pair is installed together.
 *   2 — could not run: bad arguments, a file missing/unreadable, a manifest
 *       or supersession map that did not validate, or an empty supersession
 *       map. Kept strictly distinct from 1 -- a gate that reports "clean"
 *       after failing to run is worse than no gate at all.
 *
 * Without `--block`, the same report prints and the same detail is
 * available, but the exit code is always `0` regardless of verdict --
 * "report-only" means informational, never silently red.
 */

import { readFileSync, existsSync, realpathSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { detectSupersession, supersessionResultToExitCode, type SupersessionResult } from "./supersession.js";

const USAGE = `Usage: integrator-supersession-check <manifest-file> <supersession-map-file> [options]

  manifest-file           Path to a package.json-shaped manifest to scan. Required.
  supersession-map-file   Path to this plane's own, privately declared supersession map
                          ({ "version": 1, "supersededBy": { "<legacy name>": { "replacement": "<name>", "since": "<version>" } } }).
                          Required. Never provided by this repository -- see the package README.

Options:
  --block   Enforce the result: exit 1 on a violation, 2 on indeterminate. Without this flag
            (the default), the report still prints in full but the exit code is always 0.
  --help    Print this message and exit 0.

Exit codes (with --block): 0 = no declared pair installed together, 1 = at least one is, 2 = could not run (bad input, a manifest or map that did not validate, or an empty map).
Without --block: always 0 -- report-only.
`;

/** Exported for `cli.test.ts` — anything wrong with the arguments or input files always maps to exit code 2 under `--block`, never 1. */
export class CliInputError extends Error {}

interface ParsedArgs {
  manifestFile?: string;
  supersessionMapFile?: string;
  block: boolean;
  help: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  let manifestFile: string | undefined;
  let supersessionMapFile: string | undefined;
  let block = false;
  let help = false;

  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") {
      help = true;
      continue;
    }
    if (arg === "--block") {
      block = true;
      continue;
    }
    if (arg.startsWith("-")) {
      throw new CliInputError(`unknown flag "${arg}"`);
    }
    if (manifestFile === undefined) {
      manifestFile = arg;
    } else if (supersessionMapFile === undefined) {
      supersessionMapFile = arg;
    } else {
      throw new CliInputError(`unexpected extra argument "${arg}"`);
    }
  }

  return { manifestFile, supersessionMapFile, block, help };
}

/**
 * Reads `path`'s raw text, throwing `CliInputError` on anything about the
 * path itself being wrong -- missing, unreadable, not a plain file. Same
 * convention as `ledger-check`'s `readFileText`: a bad path is an argument
 * problem, not something the underlying gate should ever see.
 */
function readFileText(label: string, path: string): string {
  if (!existsSync(path)) {
    throw new CliInputError(`${label} "${path}" does not exist`);
  }
  let stat;
  try {
    stat = statSync(path);
  } catch (error) {
    throw new CliInputError(`cannot read ${label} "${path}": ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!stat.isFile()) {
    throw new CliInputError(`${label} "${path}" is not a file`);
  }
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    throw new CliInputError(`cannot read ${label} "${path}": ${error instanceof Error ? error.message : String(error)}`);
  }
}

function printReport(result: SupersessionResult): void {
  if (result.verdict === "indeterminate") {
    console.error(`Could not evaluate: ${result.reason}${result.detail ? ` -- ${result.detail}` : ""}`);
    return;
  }
  if (result.verdict === "satisfied") {
    console.log(`Evaluated ${result.evaluated} declared supersession${result.evaluated === 1 ? "" : "s"}. No conflicting pairs installed.`);
    return;
  }
  console.log(`${result.count} conflicting pair${result.count === 1 ? "" : "s"} installed together:`);
  for (const pair of result.pairs) {
    console.log(
      `  "${pair.legacyName}" (${pair.legacyPositions.join(", ")}) alongside its replacement ` +
        `"${pair.replacementName}" (${pair.replacementPositions.join(", ")}), superseded since ${pair.since}.`,
    );
  }
}

/**
 * Exported (unlike a typical CLI `main`) so `cli.test.ts` can exercise the
 * whole argv-to-exit-code contract directly against real `mkdtemp` fixture
 * files, without spawning a subprocess for every case. Takes `argv` as a
 * parameter rather than reading `process.argv` itself -- `run()` below is
 * the only caller that reads the real `process.argv`.
 */
export function main(argv: string[]): number {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(USAGE);
    return 0;
  }
  if (!args.manifestFile) {
    throw new CliInputError("manifest-file is required");
  }
  if (!args.supersessionMapFile) {
    throw new CliInputError("supersession-map-file is required");
  }

  const manifestPath = resolve(args.manifestFile);
  const supersessionMapPath = resolve(args.supersessionMapFile);

  // Both reads can throw CliInputError (a bad path is an argument problem,
  // never something the pure gate itself is asked to judge).
  const manifestRaw = readFileText("manifest-file", manifestPath);
  const supersessionMapRaw = readFileText("supersession-map-file", supersessionMapPath);

  console.log(`Manifest: ${manifestPath}`);
  console.log(`Supersession map: ${supersessionMapPath}`);
  console.log(args.block ? "Mode: blocking (--block)" : "Mode: report-only (pass --block to enforce)");

  // From here on, `detectSupersession` itself decides what is a content
  // problem -- unparseable JSON, the wrong shape, an empty map -- and
  // reports it as `indeterminate` rather than this CLI pre-judging it.
  let parsedManifest: unknown;
  try {
    parsedManifest = JSON.parse(manifestRaw);
  } catch {
    parsedManifest = manifestRaw; // let detectSupersession report the parse failure as indeterminate
  }
  let parsedSupersessionMap: unknown;
  try {
    parsedSupersessionMap = JSON.parse(supersessionMapRaw);
  } catch {
    parsedSupersessionMap = supersessionMapRaw;
  }

  const result = detectSupersession(parsedManifest, parsedSupersessionMap);
  printReport(result);

  if (!args.block) {
    console.log("\nReport-only run -- exiting 0 regardless of verdict. Pass --block to enforce this result.");
    return 0;
  }
  return supersessionResultToExitCode(result);
}

function run(): void {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    if (error instanceof CliInputError) {
      console.error(`integrator-supersession-check: ${error.message}`);
      console.error(`\n${USAGE}`);
      process.exitCode = 2;
    } else {
      console.error(`integrator-supersession-check: unexpected error: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
      process.exitCode = 2;
    }
  }
}

/**
 * Same real-path guard `@vespeneventures/gates`', `@vespeneventures/strategy`'s
 * and `@vespeneventures/ledger`'s `cli.ts` use, for the same reason: `npm
 * install` publishes `bin` entries as symlinks, so comparing
 * `process.argv[1]` to `import.meta.url` without resolving symlinks on both
 * sides fails the moment this file is actually invoked the only way it
 * ships -- as an installed CLI.
 */
function detectMainModule(): boolean {
  const argvPath = process.argv[1];
  if (argvPath === undefined) return false;
  const modulePath = fileURLToPath(import.meta.url);
  try {
    return realpathSync(resolve(argvPath)) === realpathSync(modulePath);
  } catch {
    return resolve(argvPath) === modulePath;
  }
}

if (detectMainModule()) {
  run();
}
