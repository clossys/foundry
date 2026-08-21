#!/usr/bin/env node
/**
 * `ui-compiled-css-check` — this package's own maintainer/CI tool for
 * regenerating and verifying `styles/compiled.css`, mirroring `ui-token-
 * check`'s presentation shape (`../cli.ts`) and this repository's shared
 * three-state gate-exit contract (this repository's own CONTRIBUTING guide,
 * "Gate CLIs exit `0` clean / `1` findings / `2` could not run"):
 *
 *   0 — `--check` (default): the on-disk file is byte-identical to a fresh
 *       re-derivation from source. `--write`: the file was written
 *       successfully.
 *   1 — `--check` only: the on-disk file is STALE (differs from a fresh
 *       re-derivation) — never used for `--write`, which always either
 *       succeeds (0) or fails to run at all (2).
 *   2 — could not run at all: `src/atoms/` unreadable or matched zero
 *       files, `tailwindcss` not resolvable, an unexpected exception, or
 *       (in `--check` mode) `styles/compiled.css` does not exist yet.
 *
 * This is a project-internal tool, not a general-purpose gate a consumer
 * would run against their own code (unlike `designer-token-check`, which accepts
 * an arbitrary `--tokens` registry) — it always checks THIS package's own
 * `styles/compiled.css` against THIS package's own `src/atoms/`. It is not
 * published as a `bin` entry for exactly that reason (see the introducing
 * PR body): invoke it via `npm run generate:compiled-css` / `npm run
 * check:compiled-css` from within this package, or `node dist/compiled-
 * css/cli.js` directly during development.
 */

import { existsSync, mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { scanClassCandidates } from "./class-scan.js";
import { generateCompiledCss } from "./generate.js";
import { checkCompiledCssFreshness } from "./check.js";

const USAGE = `Usage: ui-compiled-css-check [--write] [--package-root <path>]

  --check          (default) Verify styles/compiled.css matches a fresh
                    re-derivation from src/atoms/. Does not write anything.
  --write           Regenerate styles/compiled.css and write it to disk.
  --package-root <path>
                    This package's own root directory (containing styles/
                    and src/atoms/). Defaults to two directories up from
                    this file's own compiled location (dist/compiled-css/).
  --help            Print this message and exit 0.

Exit codes: 0 = clean/written, 1 = stale (--check only), 2 = could not run.
`;

export class CliInputError extends Error {}

interface ParsedArgs {
  mode: "check" | "write";
  packageRoot?: string;
  help: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  let mode: "check" | "write" = "check";
  let packageRoot: string | undefined;
  let help = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    if (arg === "--help" || arg === "-h") {
      help = true;
    } else if (arg === "--check") {
      mode = "check";
    } else if (arg === "--write") {
      mode = "write";
    } else if (arg === "--package-root") {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("-")) throw new CliInputError("--package-root requires a path argument");
      packageRoot = value;
      i++;
    } else {
      throw new CliInputError(`unknown argument "${arg}"`);
    }
  }
  return { mode, packageRoot, help };
}

function defaultPackageRoot(): string {
  // This file lives at src/compiled-css/cli.ts, compiled to
  // dist/compiled-css/cli.js — two directories up from either is this
  // package's own root.
  return resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
}

export async function main(argv: string[]): Promise<number> {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(USAGE);
    return 0;
  }
  const packageRoot = resolve(args.packageRoot ?? defaultPackageRoot());

  // A missing/unreadable src/atoms/ directory, a missing "tailwindcss", or
  // any other failure DURING scanning/generation is a "could not run"
  // outcome (exit 2), never an uncaught rejection — `scanClassCandidates`/
  // `generateCompiledCss`/`checkCompiledCssFreshness` all fail closed by
  // THROWING (matching `designer-token-check`'s own `scanStyleSources`
  // contract), and this is where that gets turned into the shared
  // three-state exit-code contract rather than an unhandled rejection.
  try {
    if (args.mode === "write") {
      const stylesDir = resolve(packageRoot, "styles");
      const atomsDir = resolve(packageRoot, "src", "atoms");
      const scan = scanClassCandidates(atomsDir);
      if (scan.filesScanned === 0) {
        console.error(`No files matched under "${atomsDir}" — nothing was scanned. Refusing to write a compiled.css derived from nothing.`);
        return 2;
      }
      console.log(`Scanned ${scan.filesScanned} file(s) under ${atomsDir}, ${scan.candidates.length} class candidate(s) extracted.`);
      const generated = await generateCompiledCss({ stylesDir, candidates: scan.candidates });
      const outPath = resolve(stylesDir, "compiled.css");
      mkdirSync(dirname(outPath), { recursive: true });
      writeFileSync(outPath, generated.css, "utf8");
      console.log(`Wrote ${outPath} (${generated.classCount} class rule(s), ${generated.byteSize} bytes).`);
      return 0;
    }

    const compiledCssPath = resolve(packageRoot, "styles", "compiled.css");
    if (!existsSync(compiledCssPath)) {
      console.error(`"${compiledCssPath}" does not exist. Run with --write (or \`npm run generate:compiled-css\`) first.`);
      return 2;
    }

    const result = await checkCompiledCssFreshness({ packageRoot });
    console.log(`Scanned ${result.filesScanned} file(s), ${result.classCount} class rule(s) in a fresh re-derivation.`);
    if (result.inSync) {
      console.log(`${compiledCssPath} is in sync with src/atoms/.`);
      return 0;
    }
    console.error(result.diffSummary ?? "styles/compiled.css is stale.");
    return 1;
  } catch (error) {
    console.error(`ui-compiled-css-check: could not run: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }
}

function run(): void {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      if (error instanceof CliInputError) {
        console.error(`ui-compiled-css-check: ${error.message}`);
        console.error(`\n${USAGE}`);
      } else {
        console.error(`ui-compiled-css-check: unexpected error: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
      }
      process.exitCode = 2;
    });
}

/** Same real-path guard `cli.ts` uses — see that file's own comment. */
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
