#!/usr/bin/env node
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runGovernanceCheck } from "./governance.js";

const USAGE = `Usage: foundry-governance <lifecycle-file> [root] [options]

  lifecycle-file  JSON package lifecycle registry. Required.
  root            Workspace root. Defaults to the current working directory.

Options:
  --scope <scope>  Restrict internal workspace dependencies to this scope.
  --format <type>  Output format: text (default) or json.
  --verbose        Include the complete report in the selected output format.
  --help           Print this message and exit 0.

Exit codes: 0 = governed cleanly, 1 = governance findings, 2 = could not run.
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
  const lifecycleEntries = typeof lifecycle === "object" && lifecycle !== null && Array.isArray((lifecycle as { packages?: unknown }).packages)
    ? (lifecycle as { packages: unknown[] }).packages.length
    : 0;
  return {
    ok: report.ok,
    scope: scope ?? null,
    packages: report.foundation.catalog.entries.length,
    lifecycleEntries,
    foundationFindings: report.foundation.findings.length,
    lifecycleFindings: report.lifecycleFindings.length,
    buildOrder: report.buildOrder.ok ? "valid" : "invalid",
  };
}

function formatText(summary: ReturnType<typeof compactReport>, verboseReport?: ReturnType<typeof runGovernanceCheck>): string {
  const values = summary as Record<string, unknown>;
  return [
    `Package governance: ${values.ok ? "PASS" : "FAIL"}`,
    `Scope: ${values.scope ?? "(all packages)"}`,
    `Packages: ${values.packages}`,
    `Lifecycle entries: ${values.lifecycleEntries}`,
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

function run(): void {
  try { process.exitCode = main(process.argv.slice(2)); }
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

if (detectMainModule()) run();
