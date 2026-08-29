#!/usr/bin/env node
/**
 * `designer-token-check` — the CLI for `checkTokenPurity`, mirroring
 * `@example/copy`'s `copy-check` shape as closely as this
 * package's own inputs allow. Presentation only: parse argv, import
 * this package's real `TOKENS` registry, walk the scan
 * directory (`style-scan.ts`), run the pure gate (`token-gate.ts`), print a
 * report — every skip/exclusion count, never just the findings — and pick
 * an exit code.
 *
 * UNLIKE `copy-check`, there is no `<record-file>` argument: `copy-check`
 * needs a consumer-authored `CopyRecord` JSON file loaded from disk because
 * copy is inherently consumer-specific (every consumer writes its own
 * words). This gate's "record" is this package's `TOKENS`
 * export — a real, versioned, installable npm dependency of THIS package
 * (see `package.json`'s `dependencies`, the same tier
 * `@example/copy/voice` sits at for `@example/copy` — a sibling
 * workspace package, not a third-party runtime dependency, so this stays
 * inside this repository's zero-third-party-dependency rule for its
 * gates), imported directly rather than read from a file argument.
 *
 * Exit codes — the same three-state contract every gate CLI in this
 * repository uses (`copy-check`, `strategy-facts-check`,
 * `@example/gates`' `foundry-check`):
 *
 *   0 — ran cleanly: at least one file was actually scanned, zero
 *       findings, zero unchecked constructs.
 *   1 — ran cleanly, at least one finding (a styling literal that
 *       hardcodes a token's value, or has no token backing at all).
 *   2 — could not run: bad arguments, the scan directory does not exist,
 *       the walk matched zero files, an unreadable directory during the
 *       walk, an unexpected exception, OR — mirroring `copy-check`'s own
 *       `ScanResult.unchecked` handling exactly — at least one `unchecked`
 *       entry (from either `style-scan.ts` or `token-gate.ts`; see
 *       `TokenGateResult.unchecked`'s own doc comment for why the gate can
 *       add its own). `unchecked` means a CONSTRUCT this scanner recognized
 *       was never actually classified — the same shape of problem
 *       `filesScanned === 0` already is, just at finer grain, so it gets
 *       the same answer: never let a partial picture read as clean. Every
 *       real finding is still printed first — `unchecked` does not
 *       suppress what WAS learned, it only refuses to let the run as a
 *       whole read as fully accounted-for.
 */

import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { TOKENS, type TokenDefinition } from "./tokens/index.js";
import { scanStyleSources, type StyleScanResult } from "./style-scan.js";
import { checkTokenPurity, type TokenGateResult } from "./token-gate.js";

const USAGE = `Usage: designer-token-check [scan-dir] [options]

  scan-dir       Directory to scan for hardcoded styling literals (hex colors, color functions, raw lengths, Tailwind arbitrary-value classes). Defaults to the current working directory.

Options:
  --tokens <path>   Check against a JSON file's token registry instead of this
                     package's own. The file must contain an object mapping
                     any key to a token entry with at least "property" and
                     "value" string fields (this package's own
                     TokenDefinition shape — "family" and other fields are
                     optional for this purpose). Findings will name this
                     file, not "@clossys/designer/tokens", as the registry
                     that was checked.
  --help            Print this message and exit 0.

Exit codes: 0 = clean, 1 = at least one finding, 2 = could not run (bad input, nothing matched to scan, or at least one construct could not be classified).
`;

/** Exported for `cli.test.ts` — anything wrong with the arguments themselves always maps to exit code 2, never 1. */
export class CliInputError extends Error {}

interface ParsedArgs {
  scanDir?: string;
  tokensPath?: string;
  help: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  let scanDir: string | undefined;
  let tokensPath: string | undefined;
  let help = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    if (arg === "--help" || arg === "-h") {
      help = true;
      continue;
    }
    if (arg === "--tokens") {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("-")) {
        throw new CliInputError(`--tokens requires a path argument`);
      }
      tokensPath = value;
      i++;
      continue;
    }
    if (arg.startsWith("-")) {
      throw new CliInputError(`unknown flag "${arg}"`);
    }
    if (scanDir === undefined) {
      scanDir = arg;
    } else {
      throw new CliInputError(`unexpected extra argument "${arg}"`);
    }
  }

  return { scanDir, tokensPath, help };
}

/**
 * Loads and validates a consumer-supplied token registry from a JSON file.
 * JSON only, deliberately: `checkTokenPurity`'s own `tokens` seam already
 * accepts any `Record<string, TokenDefinition>`, so a JS/TS module loader
 * here would add real complexity (async resolution, a `main()` signature
 * change that breaks every existing synchronous test call in
 * `cli.test.ts`) for a case JSON already covers — a consumer's own token
 * build can always emit JSON as one more output alongside its real module.
 *
 * Fails closed (throws `CliInputError`, mapping to exit 2) on anything
 * that is not a plausible registry, rather than silently running a scan
 * against a partially-garbage token set and reporting whatever findings
 * happen to fall out of that.
 */
function loadTokensFile(path: string): Readonly<Record<string, TokenDefinition>> {
  const resolved = resolve(path);
  if (!existsSync(resolved)) throw new CliInputError(`--tokens file "${path}" does not exist`);
  let stat;
  try {
    stat = statSync(resolved);
  } catch (error) {
    throw new CliInputError(`cannot read --tokens file "${path}": ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!stat.isFile()) throw new CliInputError(`--tokens file "${path}" is not a file`);

  let raw: string;
  try {
    raw = readFileSync(resolved, "utf8");
  } catch (error) {
    throw new CliInputError(`cannot read --tokens file "${path}": ${error instanceof Error ? error.message : String(error)}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new CliInputError(`--tokens file "${path}" is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new CliInputError(`--tokens file "${path}" must contain a JSON object mapping token keys to token entries`);
  }
  for (const [key, entry] of Object.entries(parsed as Record<string, unknown>)) {
    if (
      typeof entry !== "object" ||
      entry === null ||
      typeof (entry as Record<string, unknown>).property !== "string" ||
      typeof (entry as Record<string, unknown>).value !== "string"
    ) {
      throw new CliInputError(
        `--tokens file "${path}": entry "${key}" is not a valid token — expected an object with at least string "property" and "value" fields`,
      );
    }
  }

  return parsed as Record<string, TokenDefinition>;
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

/**
 * Prints every scan-side accounting number — candidates, excluded (by
 * reason), skipped-by-design — unconditionally, matching `copy-check`'s
 * own `printScanAccounting`: a gate that quietly narrows its own coverage
 * and reports the narrowed result as a pass is the exact failure mode this
 * whole package exists to close for `@clossys/designer`.
 */
function printScanAccounting(scan: StyleScanResult): void {
  console.log(
    `Scanned ${scan.filesScanned} file${scan.filesScanned === 1 ? "" : "s"}, ` +
      `${scan.candidates.length} candidate${scan.candidates.length === 1 ? "" : "s"} extracted.`,
  );

  if (scan.excluded.length > 0) {
    const byReason = new Map<string, number>();
    for (const e of scan.excluded) byReason.set(e.reason, (byReason.get(e.reason) ?? 0) + 1);
    console.log(`${scan.excluded.length} literal(s) deliberately excluded (never candidates):`);
    for (const [reason, count] of [...byReason.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${count}  ${reason}`);
    }
  }

  if (scan.skippedByDesign.length > 0) {
    console.log(`${scan.skippedByDesign.length} file(s) skipped by design (test/check/declaration files):`);
    for (const s of scan.skippedByDesign) console.log(`  ${s.file}`);
  }
}

function printGateReport(result: TokenGateResult): void {
  console.log(
    `${result.candidatesScanned} candidate${result.candidatesScanned === 1 ? "" : "s"} evaluated, ` +
      `${result.clean} clean (bare var() reference, no fallback).`,
  );
  if (result.ignored.length > 0) {
    console.log(`${result.ignored.length} explicitly ignored via "token-gate:ignore":`);
    for (const ig of result.ignored) console.log(`  ${ig.file}:${ig.line}  ${ig.snippet}`);
  }

  // "could not check" must never be indistinguishable from a pass — printed
  // BEFORE findings, and to stderr like copy-check's own unchecked report,
  // because it means the same thing: some part of a matched file was never
  // actually classified.
  if (result.unchecked.length > 0) {
    console.error(`${result.unchecked.length} construct(s) recognized but NOT reliably classified — coverage for these is incomplete:`);
    for (const u of result.unchecked) console.error(`  [${u.kind}] ${u.file}:${u.line}  ${u.detail}`);
  }

  if (result.findings.length === 0) {
    console.log("No findings.");
    return;
  }
  // Severity breakdown up front — an "error" (a bare literal, the token
  // system not consulted at all) and a "warning" (a var() fallback
  // literal, a latent drift risk rather than a live defeat — see
  // token-gate.ts's own header, "THREE RULES, NOT TWO") are both real
  // findings and both fail this run, but they are not equally urgent, and
  // a reader should see that split before wading into the full list.
  const errorCount = result.findings.filter((f) => f.severity === "error").length;
  const warningCount = result.findings.filter((f) => f.severity === "warning").length;
  console.log(`\n${result.findings.length} finding(s) — ${errorCount} error(s), ${warningCount} warning(s):`);
  for (const f of result.findings) {
    console.log(`  [${f.severity}] [${f.rule}] ${f.file}:${f.line}  ${f.message}`);
  }
}

/**
 * Exported (unlike a typical CLI `main`) so `cli.test.ts` can exercise the
 * whole argv-to-exit-code contract directly against real `mkdtemp` temp
 * directories, without spawning a subprocess for every case. Takes `argv`
 * as a parameter rather than reading `process.argv` itself — `run()` below
 * is the only caller that reads the real `process.argv`.
 */
export function main(argv: string[]): number {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(USAGE);
    return 0;
  }

  const scanDir = resolve(args.scanDir ?? process.cwd());
  requireDirectory("scan-dir", scanDir);

  // A consumer's own registry, when supplied, fully REPLACES this
  // package's own TOKENS for this run — not merged with it. Merging would
  // silently let a consumer's source pass by matching one of THIS
  // package's tokens instead of their own, which defeats the entire point
  // of supplying a different registry: to check consumer source against
  // consumer tokens.
  const tokens = args.tokensPath ? loadTokensFile(args.tokensPath) : TOKENS;
  const registryLabel = args.tokensPath ? relative(process.cwd(), resolve(args.tokensPath)) : "@clossys/designer/tokens";

  console.log(`Scan directory: ${scanDir}`);
  console.log(`Token registry: ${registryLabel} (${Object.keys(tokens).length} tokens)`);

  const scan = scanStyleSources(scanDir); // throws (fail-closed) on an unreadable directory — caught by run()
  printScanAccounting(scan);

  // Zero files SUCCESSFULLY scanned is never reported as a pass — matching
  // copy-check's own "nothing to scan" discipline.
  if (scan.filesScanned === 0) {
    console.error(`\nNo files matched under "${scanDir}" — nothing was scanned.`);
    console.error("Refusing to report a pass for a scan that checked nothing.");
    return 2;
  }

  const result = checkTokenPurity(scan.candidates, tokens, scan.filesScanned, scan.unchecked, registryLabel);
  printGateReport(result);

  // `unchecked` wins over everything else in the exit-code decision — see
  // this file's own top doc comment for why it is a `2`, not a `1`.
  if (result.unchecked.length > 0) return 2;

  return result.findings.length > 0 ? 1 : 0;
}

function run(): void {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    if (error instanceof CliInputError) {
      console.error(`designer-token-check: ${error.message}`);
      console.error(`\n${USAGE}`);
      process.exitCode = 2;
    } else {
      console.error(`designer-token-check: unexpected error: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
      process.exitCode = 2;
    }
  }
}

/**
 * Same real-path guard `@example/copy`'s `cli.ts` uses, for the
 * same reason: `npm install` publishes `bin` entries as symlinks, so
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
