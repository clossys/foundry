#!/usr/bin/env node
/**
 * `ui-contrast-check` — the CLI for `checkTokenContrast`, mirroring
 * `ui-token-check`'s shape (`../cli.ts`) as closely as this gate's own
 * input allows: parse argv, read a tokens.css-shaped file, run the pure
 * gate against `CONTRAST_PAIRS`, print a report — every pair checked,
 * every pair that could NOT be evaluated, never just the findings — and
 * pick an exit code with the same three-state contract every gate CLI in
 * this repository uses.
 *
 * UNLIKE `ui-token-check`, there is no source-directory walk: this gate
 * checks a TOKEN REGISTRY's own declared color pairs, not styling
 * literals scattered across source files, so its one input is a single
 * `tokens.css`-shaped file rather than a directory. Defaults to this
 * package's own `styles/tokens.css` — the right default for checking this
 * package's own shipped colors — but accepts a path to any other file
 * declaring the same shape (a consumer's brand-bound `tokens.css`, for
 * instance), the same "swap the registry" escape hatch `ui-token-check`'s
 * own `--tokens` flag provides.
 *
 * BOTH THEMES, ALWAYS, WHEN BOTH ARE PRESENT — `styles/tokens.css` ships a
 * light `:root { ... }` block AND a `:root[data-theme="dark"]` block (see
 * that file's own header for the full cascade). This CLI parses BOTH (via
 * `internal/parse-css.ts`, the same reader `contrast.test.ts` already
 * uses) and runs `checkTokenContrast` against each independently — a
 * palette regression that only breaks dark mode is exactly the kind of
 * finding a light-only check would miss silently. A file with no dark
 * block at all (a consumer who hasn't added one yet) is not an error:
 * light theme is still checked, and the report says plainly that dark was
 * skipped, for the reason it was skipped — never a silent narrowing of
 * what got checked.
 *
 * Exit codes — the same three-state contract every gate CLI in this
 * repository uses (`ui-token-check`, `tokens-brand-check`,
 * `copy-check`, `strategy-facts-check`):
 *
 *   0 — every theme checked (at least one) resolved every pair cleanly
 *       and every pair met its threshold.
 *   1 — every theme checked resolved cleanly, and at least one pair fell
 *       below its threshold (a real WCAG finding) in at least one theme.
 *   2 — could not run: bad arguments, the tokens-css file missing/
 *       unreadable, no parseable light `:root { ... }` block at all, OR —
 *       mirroring `ui-token-check`'s own `unchecked` handling — at least
 *       one pair in ANY checked theme could not be evaluated at all
 *       (`ContrastGateResult.unchecked` non-empty: an unresolvable token,
 *       a cyclic alias, an unparseable color value) OR a theme evaluated
 *       zero pairs. `unchecked`/zero-pairs always wins over a same-theme
 *       finding — "could not check" must never read as a pass, and must
 *       never be silently demoted to the SAME severity as a real finding
 *       either, the same discipline `ui-token-check` holds `TokenGateResult
 *       .unchecked` to.
 */

import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CONTRAST_PAIRS } from "./contrast-pairs.js";
import { checkTokenContrast, type ContrastGateResult } from "./contrast-gate.js";
import { parseRootDeclarations, parseDeclarationsForSelector } from "./internal/parse-css.js";
import { mergeDeclarations, registryFromDeclarations } from "./internal/registry-from-css.js";

const DARK_SELECTOR = ':root[data-theme="dark"]';

const USAGE = `Usage: ui-contrast-check [tokens-css-file] [options]

  tokens-css-file   Path to a tokens.css-shaped file to check: must declare
                     a top-level ":root { ... }" block (light theme). A
                     ":root[data-theme=\"dark\"]" block, if present, is
                     checked too. Defaults to this package's own
                     styles/tokens.css.

Options:
  --help            Print this message and exit 0.

Exit codes: 0 = clean, 1 = at least one pair below its WCAG threshold, 2 = could not run (bad input, unreadable/unparseable file, zero pairs evaluated in some checked theme, or at least one pair that could not be evaluated at all).
`;

/** Exported for `contrast-cli.test.ts` — anything wrong with the arguments themselves always maps to exit code 2, never 1. */
export class CliInputError extends Error {}

interface ParsedArgs {
  tokensCssFile?: string;
  help: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  let tokensCssFile: string | undefined;
  let help = false;

  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") {
      help = true;
      continue;
    }
    if (arg.startsWith("-")) {
      throw new CliInputError(`unknown flag "${arg}"`);
    }
    if (tokensCssFile === undefined) {
      tokensCssFile = arg;
    } else {
      throw new CliInputError(`unexpected extra argument "${arg}"`);
    }
  }

  return { tokensCssFile, help };
}

function requireFile(label: string, path: string): void {
  if (!existsSync(path)) throw new CliInputError(`${label} "${path}" does not exist`);
  let stat;
  try {
    stat = statSync(path);
  } catch (error) {
    throw new CliInputError(`cannot read ${label} "${path}": ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!stat.isFile()) throw new CliInputError(`${label} "${path}" is not a file`);
}

/**
 * This package's own shipped `styles/tokens.css`, resolved relative to
 * THIS file rather than `process.cwd()` — correct both under `vitest`
 * (running from `src/tokens/contrast-cli.ts`) and as the installed CLI
 * (running from `dist/tokens/contrast-cli.js`): both sit two directories
 * below the package root, exactly like `contrast.test.ts`'s own
 * `packageRoot` computation.
 */
function defaultTokensCssPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, "..", "..", "styles", "tokens.css");
}

function printThemeReport(themeLabel: string, result: ContrastGateResult): void {
  console.log(`[${themeLabel}] ${result.pairsChecked} pair(s) checked.`);

  if (result.reason === "nothing-to-check") {
    console.error(`[${themeLabel}] zero pairs were actually evaluated against this registry.`);
    console.error(`[${themeLabel}] Refusing to report a pass for a check that evaluated nothing.`);
    return;
  }

  // "could not evaluate" printed BEFORE findings, and to stderr like
  // ui-token-check's own unchecked report — it means the same thing here:
  // some part of what should have been checked was never actually
  // resolved to a real ratio.
  if (result.unchecked.length > 0) {
    console.error(`[${themeLabel}] ${result.unchecked.length} pair(s) could NOT be evaluated:`);
    for (const u of result.unchecked) console.error(`  [${u.reason}] ${u.pairId}: ${u.detail}`);
  }

  if (result.findings.length === 0) {
    if (result.unchecked.length === 0) console.log(`[${themeLabel}] No findings.`);
    return;
  }
  console.log(`[${themeLabel}] ${result.findings.length} finding(s):`);
  for (const f of result.findings) {
    console.log(`  [${f.rule}] ${f.pairId}  ${f.message}`);
  }
}

type ThemeVerdict = "clean" | "findings" | "could-not-run";

function classify(result: ContrastGateResult): ThemeVerdict {
  if (result.reason === "nothing-to-check") return "could-not-run";
  if (result.unchecked.length > 0) return "could-not-run";
  if (result.findings.length > 0) return "findings";
  return "clean";
}

/**
 * Exported (unlike a typical CLI `main`) so `contrast-cli.test.ts` can
 * exercise the whole argv-to-exit-code contract directly against real
 * `mkdtemp` temp files, without spawning a subprocess for every case.
 * Takes `argv` as a parameter rather than reading `process.argv` itself —
 * `run()` below is the only caller that reads the real `process.argv`.
 */
export function main(argv: string[]): number {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(USAGE);
    return 0;
  }

  const cssPath = resolve(args.tokensCssFile ?? defaultTokensCssPath());
  requireFile("tokens-css-file", cssPath);

  let css: string;
  try {
    css = readFileSync(cssPath, "utf8");
  } catch (error) {
    throw new CliInputError(`cannot read tokens-css-file "${cssPath}": ${error instanceof Error ? error.message : String(error)}`);
  }

  console.log(`Tokens CSS file: ${cssPath}`);
  console.log(`Contrast policy: ${CONTRAST_PAIRS.length} pair(s) (from @vespeneventures/ui/tokens's CONTRAST_PAIRS).`);

  let lightDeclarations;
  try {
    lightDeclarations = parseRootDeclarations(css);
  } catch (error) {
    console.error(`\nCould not parse a top-level ":root { ... }" block from "${cssPath}": ${error instanceof Error ? error.message : String(error)}`);
    console.error("Refusing to report a pass with no trustworthy token registry to check.");
    return 2;
  }

  const lightResult = checkTokenContrast(CONTRAST_PAIRS, { tokens: registryFromDeclarations(lightDeclarations) });
  printThemeReport("light", lightResult);

  let darkResult: ContrastGateResult | undefined;
  try {
    const darkDeclarations = parseDeclarationsForSelector(css, DARK_SELECTOR);
    // Merged on top of the light declarations, not dark alone — see
    // `mergeDeclarations`'s own doc comment for why: a handful of real
    // alias tokens (--color-chart-surface, --color-ink-on-accent, ...)
    // are declared only in :root and deliberately never redeclared in the
    // dark block, exactly the way a real browser cascade still resolves
    // them for a dark-themed page.
    darkResult = checkTokenContrast(CONTRAST_PAIRS, { tokens: registryFromDeclarations(mergeDeclarations(lightDeclarations, darkDeclarations)) });
    printThemeReport("dark", darkResult);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("not found in CSS")) {
      // A real, accepted variant, not a decline: not every tokens.css ships
      // a dark block (a consumer's own may not, yet). Stated plainly, not
      // silently — light theme was still fully checked above.
      console.log(`No "${DARK_SELECTOR}" block found in "${cssPath}" — checked light theme only.`);
    } else {
      // The selector's block exists but couldn't be parsed (e.g.
      // unterminated) — this IS a decline, not a benign absence.
      console.error(`\nCould not parse "${DARK_SELECTOR}" from "${cssPath}": ${message}`);
      console.error("Refusing to report a pass with a dark-theme block present but unreadable.");
      return 2;
    }
  }

  const verdicts = darkResult === undefined ? [classify(lightResult)] : [classify(lightResult), classify(darkResult)];
  if (verdicts.includes("could-not-run")) return 2;
  if (verdicts.includes("findings")) return 1;
  return 0;
}

function run(): void {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    if (error instanceof CliInputError) {
      console.error(`ui-contrast-check: ${error.message}`);
      console.error(`\n${USAGE}`);
      process.exitCode = 2;
    } else {
      console.error(`ui-contrast-check: unexpected error: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
      process.exitCode = 2;
    }
  }
}

/**
 * Same real-path guard every other installable CLI in this package/
 * ecosystem uses: `npm install` publishes `bin` entries as symlinks, so
 * comparing `process.argv[1]` to `import.meta.url` without resolving
 * symlinks on both sides fails the moment this file is actually invoked
 * the only way it ships — as an installed CLI.
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
