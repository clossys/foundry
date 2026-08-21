#!/usr/bin/env node
/**
 * `foundry-governance` — the CLI for `runGovernanceCheck` (no subcommand,
 * unchanged) and, as of issue #377, two subcommands that give three
 * previously CLI-less exports a real entry point: `preflight`
 * (`preflightGovernedPackage`, which itself calls `preflightPackage` and
 * `packRoundTrip` — see `preflight.ts` and `release/preflight.ts`) and
 * `verify-published` (`verifyPublishedArtifact`). All three were public
 * library exports reachable only by writing TypeScript; `docs/PUBLISHING.md`
 * names the `preflight` gap directly ("there is currently no local command
 * that proves a package installs and imports cleanly before you propose
 * publishing it").
 *
 * Dispatch happens on `argv[0]` — the literal first token a caller passes
 * on the command line — never on the invoked binary's path or filename.
 * This repository invokes every gate by its compiled path (e.g. `node
 * packages/controller/dist/cli.js`), so a dispatch keyed off
 * `basename(process.argv[1])` would always see `cli.js` and silently run
 * the wrong command — a defect that shipped once already during this same
 * effort (see #377) and was caught only by invoking a gate the way CI does.
 * See `mainAsync` below for the actual dispatch.
 *
 * `main` (the pre-existing, synchronous, no-subcommand entry point) is
 * unchanged — same signature, same behavior, same tests. The two new
 * subcommands call `async` functions (`preflightGovernedPackage` and,
 * transitively, `packRoundTrip`), so they are handled by `mainAsync`, a new
 * dispatcher `run()` now calls instead of `main` directly; `mainAsync` falls
 * through to the original synchronous `main` when no subcommand matches.
 */
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runGovernanceCheck } from "./governance.js";
import { preflightGovernedPackage } from "./preflight.js";
import { verifyPublishedArtifact } from "./release/verify-artifact.js";

const USAGE = `Usage: foundry-governance <lifecycle-file> [root] [options]
       foundry-governance preflight <lifecycle-file> <package-dir> [root] [options]
       foundry-governance verify-published <expected-digest> <content-file> [options]

  lifecycle-file  JSON package lifecycle registry. Required.
  root            Workspace root. Defaults to the current working directory.

Options:
  --scope <scope>  Restrict internal workspace dependencies to this scope.
  --format <type>  Output format: text (default) or json.
  --verbose        Include the complete report in the selected output format.
  --help           Print this message and exit 0.

Exit codes: 0 = governed cleanly, 1 = governance findings, 2 = could not run.

Run "foundry-governance preflight --help" for the preflight subcommand's own usage.
Run "foundry-governance verify-published --help" for the verify-published subcommand's own usage.
`;

const PREFLIGHT_USAGE = `Usage: foundry-governance preflight <lifecycle-file> <package-dir> [root] [options]

  lifecycle-file  JSON package lifecycle registry. Required.
  package-dir     Directory of the package to preflight — packed, installed into a genuinely isolated directory, and every declared export imported. Required.
  root            Workspace root, for the composed lifecycle/catalog check. Defaults to the current working directory.

Options:
  --scope <scope>  Restrict internal workspace dependencies to this scope. Passed to both the catalog check and the round trip.
  --help           Print this message and exit 0.

Exit codes: 0 = the package installs and imports cleanly AND has no lifecycle/catalog error finding, 1 = one of those failed, 2 = could not run (bad arguments, unreadable/invalid JSON, or an unexpected failure — never a silent pass).
`;

const VERIFY_PUBLISHED_USAGE = `Usage: foundry-governance verify-published <expected-digest> <content-file> [options]

  expected-digest  The sha256 digest (as recorded by a policy binding) the content is expected to match. Required.
  content-file     Path to the already-fetched published content (a real registry fetch, an "npm pack <name>@<version>", or similar) to verify. Read as raw bytes. Required.

Options:
  --help  Print this message and exit 0.

Exit codes: 0 = the content's digest matches expected-digest, 1 = a mismatch (or another binding finding), 2 = could not run (bad arguments or an unreadable content-file).
`;

export class CliInputError extends Error {}

type OutputFormat = "text" | "json";

interface CliArgs {
  readonly lifecycleFile?: string;
  readonly root: string;
  readonly scope?: string;
  readonly format: OutputFormat;
  readonly verbose: boolean;
  readonly help: boolean;
}

function parseArgs(argv: readonly string[]): CliArgs {
  let lifecycleFile: string | undefined;
  let root: string | undefined;
  let scope: string | undefined;
  let format: OutputFormat = "text";
  let verbose = false;
  let help = false;
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index] as string;
    if (arg === "--help" || arg === "-h") { help = true; continue; }
    if (arg === "--scope") {
      const value = argv[++index];
      if (value === undefined) throw new CliInputError("--scope requires a value");
      scope = value;
      continue;
    }
    if (arg === "--format") {
      const value = argv[++index];
      if (value !== "text" && value !== "json") throw new CliInputError('--format requires "text" or "json"');
      format = value;
      continue;
    }
    if (arg === "--verbose") { verbose = true; continue; }
    if (arg.startsWith("-")) throw new CliInputError(`unknown option ${JSON.stringify(arg)}`);
    if (!lifecycleFile) lifecycleFile = arg;
    else if (!root) root = arg;
    else throw new CliInputError("expected one lifecycle-file and at most one root");
  }
  if (help && argv.length !== 1) throw new CliInputError("--help cannot be combined with other arguments");
  if (!help && !lifecycleFile) throw new CliInputError("lifecycle-file is required");
  return { lifecycleFile, root: root ?? process.cwd(), scope, format, verbose, help };
}

function readWorkspaceRoot(path: string): string {
  const resolved = resolve(path);
  if (!existsSync(resolved)) throw new CliInputError(`root ${JSON.stringify(path)} does not exist`);
  let stat;
  try { stat = statSync(resolved); } catch (error) { throw new CliInputError(`cannot read root: ${error instanceof Error ? error.message : String(error)}`); }
  if (!stat.isDirectory()) throw new CliInputError(`root ${JSON.stringify(path)} is not a directory`);
  return resolved;
}

function compactReport(report: ReturnType<typeof runGovernanceCheck>, scope: string | undefined, lifecycle: unknown): object {
  const lifecyclePackages = typeof lifecycle === "object" && lifecycle !== null && Array.isArray((lifecycle as { packages?: unknown }).packages)
    ? (lifecycle as { packages: unknown[] }).packages
    : [];
  const lifecycleMaturity = lifecyclePackages.reduce<Record<string, number>>((counts, entry) => {
    const status = typeof entry === "object" && entry !== null && typeof (entry as { status?: unknown }).status === "string"
      ? (entry as { status: string }).status
      : "invalid";
    counts[status] = (counts[status] ?? 0) + 1;
    return counts;
  }, {});
  return {
    ok: report.ok,
    scope: scope ?? null,
    packages: report.foundation.catalog.entries.length,
    lifecycleEntries: lifecyclePackages.length,
    lifecycleMaturity: Object.fromEntries(Object.entries(lifecycleMaturity).sort(([left], [right]) => left.localeCompare(right))),
    foundationFindings: report.foundation.findings.length,
    lifecycleFindings: report.lifecycleFindings.length,
    buildOrder: report.buildOrder.ok ? "valid" : "invalid",
  };
}

function formatText(summary: ReturnType<typeof compactReport>, verboseReport?: ReturnType<typeof runGovernanceCheck>): string {
  const values = summary as Record<string, unknown>;
  const maturity = Object.entries(values.lifecycleMaturity as Record<string, number>).map(([status, count]) => `${status}=${count}`).join(", ");
  return [
    `Package governance: ${values.ok ? "PASS" : "FAIL"}`,
    `Scope: ${values.scope ?? "(all packages)"}`,
    `Packages: ${values.packages}`,
    `Lifecycle entries: ${values.lifecycleEntries}`,
    `Lifecycle maturity: ${maturity || "(none)"}`,
    `Foundation findings: ${values.foundationFindings}`,
    `Lifecycle findings: ${values.lifecycleFindings}`,
    `Build order: ${values.buildOrder}`,
  ].join("\n") + (verboseReport ? `\n\nDetails:\n${JSON.stringify(verboseReport, null, 2)}` : "");
}

function readJsonFile(path: string): unknown {
  if (!existsSync(path)) throw new CliInputError(`lifecycle-file ${JSON.stringify(path)} does not exist`);
  let stat;
  try { stat = statSync(path); } catch (error) { throw new CliInputError(`cannot read lifecycle-file: ${error instanceof Error ? error.message : String(error)}`); }
  if (!stat.isFile()) throw new CliInputError(`lifecycle-file ${JSON.stringify(path)} is not a file`);
  try { return JSON.parse(readFileSync(path, "utf8")); }
  catch (error) { throw new CliInputError(`lifecycle-file is not valid JSON: ${error instanceof Error ? error.message : String(error)}`); }
}

/** Runs the CLI without global process arguments so its contract is testable. */
export function main(argv: readonly string[]): number {
  const args = parseArgs(argv);
  if (args.help) { console.log(USAGE); return 0; }
  const lifecycle = readJsonFile(resolve(args.lifecycleFile as string));
  const report = runGovernanceCheck(readWorkspaceRoot(args.root), lifecycle, { scope: args.scope });
  const summary = compactReport(report, args.scope, lifecycle);
  console.log(args.format === "json"
    ? JSON.stringify(args.verbose ? report : summary, null, 2)
    : formatText(summary, args.verbose ? report : undefined));
  return report.ok ? 0 : 1;
}

interface PreflightArgs {
  readonly lifecycleFile?: string;
  readonly packageDir?: string;
  readonly root: string;
  readonly scope?: string;
  readonly help: boolean;
}

function parsePreflightArgs(argv: readonly string[]): PreflightArgs {
  let lifecycleFile: string | undefined;
  let packageDir: string | undefined;
  let root: string | undefined;
  let scope: string | undefined;
  let help = false;
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index] as string;
    if (arg === "--help" || arg === "-h") { help = true; continue; }
    if (arg === "--scope") {
      const value = argv[++index];
      if (value === undefined) throw new CliInputError("--scope requires a value");
      scope = value;
      continue;
    }
    if (arg.startsWith("-")) throw new CliInputError(`unknown option ${JSON.stringify(arg)}`);
    if (!lifecycleFile) lifecycleFile = arg;
    else if (!packageDir) packageDir = arg;
    else if (!root) root = arg;
    else throw new CliInputError("expected one lifecycle-file, one package-dir, and at most one root");
  }
  if (help && argv.length !== 1) throw new CliInputError("--help cannot be combined with other arguments");
  if (!help && !lifecycleFile) throw new CliInputError("lifecycle-file is required");
  if (!help && !packageDir) throw new CliInputError("package-dir is required");
  return { lifecycleFile, packageDir, root: root ?? process.cwd(), scope, help };
}

/** Same shape of check `readWorkspaceRoot` already does for `root`, applied to `package-dir` instead. */
function readPackageDir(path: string): string {
  const resolved = resolve(path);
  if (!existsSync(resolved)) throw new CliInputError(`package-dir ${JSON.stringify(path)} does not exist`);
  let stat;
  try { stat = statSync(resolved); } catch (error) { throw new CliInputError(`cannot read package-dir: ${error instanceof Error ? error.message : String(error)}`); }
  if (!stat.isDirectory()) throw new CliInputError(`package-dir ${JSON.stringify(path)} is not a directory`);
  return resolved;
}

/**
 * The `preflight` subcommand (issue #377): `preflightGovernedPackage`, which
 * combines this package's own catalog/lifecycle governance check with a
 * REAL pack-install-import proof (`preflightPackage` → `packRoundTrip`) that
 * `package-dir` actually installs and imports cleanly from outside the
 * workspace. `async` because `packRoundTrip` genuinely packs a tarball and
 * runs `npm install` in an isolated temp directory — this is not a pure,
 * zero-I/O function, unlike the plain `main` above.
 */
async function runPreflight(argv: readonly string[]): Promise<number> {
  const args = parsePreflightArgs(argv);
  if (args.help) { console.log(PREFLIGHT_USAGE); return 0; }
  const lifecycle = readJsonFile(resolve(args.lifecycleFile as string));
  const root = readWorkspaceRoot(args.root);
  const packageDir = readPackageDir(args.packageDir as string);
  const report = await preflightGovernedPackage(root, packageDir, lifecycle, { scope: args.scope });
  console.log(JSON.stringify(report, null, 2));
  return report.ok ? 0 : 1;
}

interface VerifyPublishedArgs {
  readonly expectedDigest?: string;
  readonly contentFile?: string;
  readonly help: boolean;
}

function parseVerifyPublishedArgs(argv: readonly string[]): VerifyPublishedArgs {
  let expectedDigest: string | undefined;
  let contentFile: string | undefined;
  let help = false;
  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") { help = true; continue; }
    if (arg.startsWith("-")) throw new CliInputError(`unknown option ${JSON.stringify(arg)}`);
    if (!expectedDigest) expectedDigest = arg;
    else if (!contentFile) contentFile = arg;
    else throw new CliInputError("expected one expected-digest and one content-file");
  }
  if (help && argv.length !== 1) throw new CliInputError("--help cannot be combined with other arguments");
  if (!help && !expectedDigest) throw new CliInputError("expected-digest is required");
  if (!help && !contentFile) throw new CliInputError("content-file is required");
  return { expectedDigest, contentFile, help };
}

/**
 * The `verify-published` subcommand (issue #377): a thin wrapper around
 * `verifyPublishedArtifact`, itself a thin wrapper around this package's own
 * `./policy` binding verifier (see `release/verify-artifact.ts`'s header).
 * Reads `content-file` as raw bytes, deliberately: `verifyPublishedArtifact`
 * takes `string | Uint8Array` and does no fetching of its own, so whatever
 * already-obtained bytes a caller points this at are hashed exactly as they
 * are, never re-encoded through a text codec first.
 */
function runVerifyPublished(argv: readonly string[]): number {
  const args = parseVerifyPublishedArgs(argv);
  if (args.help) { console.log(VERIFY_PUBLISHED_USAGE); return 0; }
  const contentPath = resolve(args.contentFile as string);
  if (!existsSync(contentPath)) throw new CliInputError(`content-file ${JSON.stringify(args.contentFile)} does not exist`);
  let content: Uint8Array;
  try { content = readFileSync(contentPath); }
  catch (error) { throw new CliInputError(`cannot read content-file: ${error instanceof Error ? error.message : String(error)}`); }
  const findings = verifyPublishedArtifact(args.expectedDigest as string, content);
  console.log(JSON.stringify({ ok: findings.length === 0, findings }, null, 2));
  return findings.length === 0 ? 0 : 1;
}

/**
 * The real top-level dispatcher (issue #377), keyed on the literal
 * `argv[0]` — never on the invoked binary's path or filename; see this
 * file's own header for why. `run()` below calls this instead of `main`
 * directly; `main` itself, and every one of its existing tests, is
 * unchanged — a caller not typing `preflight` or `verify-published` first
 * gets exactly the previous behavior. Exported (unlike a typical CLI
 * dispatcher) so `cli.test.ts` can exercise the whole argv-to-exit-code
 * contract in-process, without spawning a subprocess for every case.
 */
export async function mainAsync(argv: readonly string[]): Promise<number> {
  if (argv[0] === "preflight") return runPreflight(argv.slice(1));
  if (argv[0] === "verify-published") return runVerifyPublished(argv.slice(1));
  return main(argv);
}

async function run(): Promise<void> {
  try { process.exitCode = await mainAsync(process.argv.slice(2)); }
  catch (error) {
    console.error(`foundry-governance: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 2;
  }
}

function detectMainModule(): boolean {
  const argvPath = process.argv[1];
  if (!argvPath) return false;
  try { return realpathSync(resolve(argvPath)) === realpathSync(fileURLToPath(import.meta.url)); }
  catch { return false; }
}

if (detectMainModule()) void run();
