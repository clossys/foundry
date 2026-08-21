#!/usr/bin/env node
/**
 * `designer-environment-check` — the CLI for `checkEnvironmentConformance`,
 * mirroring `designer-token-check`/`designer-contrast-check`'s shape
 * (`cli.ts`, `tokens/contrast-cli.ts`) as closely as this gate's own input
 * allows: parse argv, run the check, print a report naming exactly what was
 * compared, and pick an exit code.
 *
 * WHAT THIS CHECKS — AND DOES NOT: `checkEnvironmentConformance` verifies
 * only that `RENDER_ENVIRONMENT`'s key set matches `package.json#exports`'
 * subpath set, in both directions. It performs no module resolution and
 * says nothing about whether a `"server-safe"` subpath actually resolves
 * safely under a real export condition — see `environment-conformance.ts`'s
 * own header for why that real verification belongs to `builder` (issue
 * #358), not here, and is not something this CLI substitutes for.
 *
 * ONE POSITIONAL ARGUMENT, defaulting to THIS package's own root (two
 * directories up from this file's own compiled location, `dist/
 * environment-conformance-cli.js` -> package root — the same "resolve
 * relative to `import.meta.url`, never `process.cwd()`" discipline
 * `contrast-cli.ts`'s own `defaultTokensCssPath` uses, and for the same
 * reason: this repository invokes every gate by compiled path from the
 * repo root, where `process.cwd()` is the repo root, not this package).
 * Accepting an explicit `[package-dir]` is what lets this same CLI (and
 * the exported `main`) run against a FIXTURE package directory in
 * `environment-conformance-cli.test.ts` and
 * `environment-conformance.adversarial.test.ts`, without ever touching
 * this package's own real `dist/`.
 *
 * Exit codes — the same three-state contract every gate CLI in this
 * repository uses:
 *
 *   0 — "satisfied": the declaration and the manifest's `exports` map
 *       name the same set of subpaths, over at least one.
 *   1 — "violated": at least one subpath is undeclared (a real export
 *       with no `RENDER_ENVIRONMENT` entry) or stale (a declared subpath
 *       that is not a real export). Every one is reported.
 *   2 — "indeterminate": the manifest is missing/unparseable, it
 *       declares no (or an empty) `exports` map, `RENDER_ENVIRONMENT` is
 *       missing/unparseable, or the declaration-loading subprocess
 *       itself failed.
 */

import { existsSync, realpathSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkEnvironmentConformance, type ConformanceResult } from "./environment-conformance.js";

const USAGE = `Usage: designer-environment-check [package-dir]

  package-dir   Directory containing a package.json (with a non-empty
                "exports" map) and a built "dist/render-environment.js"
                exporting RENDER_ENVIRONMENT. Defaults to this package's
                own root.

Options:
  --help        Print this message and exit 0.

Checks only that RENDER_ENVIRONMENT's declared subpaths and
package.json#exports' real subpaths are the same set, in both
directions. Performs no module resolution and does not verify that a
"server-safe" subpath actually resolves safely (see issue #358).

Exit codes: 0 = satisfied (the declaration and the manifest agree), 1 = violated (an undeclared or stale subpath, or both), 2 = indeterminate (see report for the machine-readable reason).
`;

/** Exported for `environment-conformance-cli.test.ts` — anything wrong with the arguments themselves always maps to exit code 2. */
export class CliInputError extends Error {}

interface ParsedArgs {
  packageDir?: string;
  help: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  let packageDir: string | undefined;
  let help = false;

  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") {
      help = true;
      continue;
    }
    if (arg.startsWith("-")) {
      throw new CliInputError(`unknown flag "${arg}"`);
    }
    if (packageDir === undefined) {
      packageDir = arg;
    } else {
      throw new CliInputError(`unexpected extra argument "${arg}"`);
    }
  }

  return { packageDir, help };
}

/** This package's own root, resolved relative to THIS file — see this file's own header for why never `process.cwd()`. */
function defaultPackageDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, "..");
}

function requireDirectory(label: string, path: string): void {
  if (!existsSync(path)) throw new CliInputError(`${label} "${path}" does not exist`);
  let stat;
  try {
    stat = statSync(path);
  } catch (error) {
    throw new CliInputError(`cannot read ${label} "${path}": ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!stat.isDirectory()) throw new CliInputError(`${label} "${path}" is not a directory`);
}

function printReport(packageDir: string, result: ConformanceResult): void {
  console.log(`Package directory: ${packageDir}`);
  console.log(`Verdict: ${result.verdict}`);

  if (result.verdict === "satisfied") {
    console.log(`${result.agreedSubpaths.length} subpath(s) agree between RENDER_ENVIRONMENT and package.json#exports:`);
    for (const s of result.agreedSubpaths) console.log(`  ${s}`);
    return;
  }

  if (result.verdict === "violated") {
    console.log(`${result.violations.length} violation(s):`);
    for (const v of result.violations) {
      console.log(`  [${v.reason}] ${v.subpath}`);
      console.log(`      ${v.detail}`);
    }
    return;
  }

  // indeterminate — printed to stderr, matching this repository's "could
  // not check must never read as a pass" discipline.
  console.error(`${result.indeterminateReasons.length} reason(s) this run could not reach a verdict:`);
  for (const r of result.indeterminateReasons) {
    console.error(`  [${r.code}] ${r.detail}`);
  }
}

/**
 * Exported (unlike a typical CLI `main`) so `environment-conformance-cli.test.ts`
 * can exercise the whole argv-to-exit-code contract directly against real
 * `mkdtemp` fixture directories. Takes `argv` as a parameter rather than
 * reading `process.argv` itself — `run()` below is the only caller that
 * reads the real `process.argv`.
 */
export async function main(argv: string[]): Promise<number> {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(USAGE);
    return 0;
  }

  const packageDir = resolve(args.packageDir ?? defaultPackageDir());
  requireDirectory("package-dir", packageDir);

  const result = await checkEnvironmentConformance(packageDir);
  printReport(packageDir, result);

  if (result.verdict === "satisfied") return 0;
  if (result.verdict === "violated") return 1;
  return 2;
}

async function run(): Promise<void> {
  try {
    process.exitCode = await main(process.argv.slice(2));
  } catch (error) {
    if (error instanceof CliInputError) {
      console.error(`designer-environment-check: ${error.message}`);
      console.error(`\n${USAGE}`);
      process.exitCode = 2;
    } else {
      console.error(`designer-environment-check: unexpected error: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
      process.exitCode = 2;
    }
  }
}

/**
 * Same real-path guard every other installable CLI in this package uses:
 * `npm install` publishes `bin` entries as symlinks, so comparing
 * `process.argv[1]` to `import.meta.url` without resolving symlinks on
 * both sides fails the moment this file is actually invoked the only way
 * it ships — as an installed CLI.
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
  void run();
}
