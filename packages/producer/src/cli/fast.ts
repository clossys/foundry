/**
 * `clossys check --fast` (src/check/fast.ts): Reviewer's quick gate over a diff, before any review. Every executor
 * runs it before DONE; review starts only on a FAST PASS record at the exact head (packages/reviewer/skill/SKILL.md,
 * rule R-FAST-BEFORE-REVIEW).
 */
import { resolve } from "node:path";
import { FastUsageError, formatFast, runFast, type FastRecord } from "../check/fast.js";
import { CliUsageError } from "./args.js";
import { FAST_USAGE } from "./fast-usage.js";
import type { CliResult } from "./main.js";
import { discoverRoot, RootDiscoveryError } from "./root.js";

interface FastArgs { base?: string; json: boolean; fileRequests: boolean; root?: string }

function parse(argv: readonly string[]): FastArgs {
  const args: FastArgs = { json: false, fileRequests: false };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]!;
    const value = () => { const next = argv[++index]; if (next === undefined || next.startsWith("--")) throw new CliUsageError(`${arg} requires a value\n${FAST_USAGE}`); return next; };
    if (arg === "check" && index === 0) continue;
    if (arg === "--fast") continue;
    if (arg === "--json") args.json = true;
    else if (arg === "--file-requests") args.fileRequests = true;
    else if (arg === "--base") args.base = value();
    else if (arg === "--root") args.root = value();
    else throw new CliUsageError(`check --fast does not take ${arg}\n${FAST_USAGE}`);
  }
  if (args.root !== undefined && !args.fileRequests) throw new CliUsageError(`check --fast takes --root only with --file-requests\n${FAST_USAGE}`);
  return args;
}

/** One request per slow test, to the agent that owns its package, through `clossys request --kind report`. */
async function fileRequests(record: FastRecord, repo: string, root: string): Promise<{ lines: string[]; failed: boolean }> {
  const { runRequestCli } = await import("./request.js");
  const lines: string[] = [];
  let failed = false;
  for (const slow of record.slow) {
    const owner = slow.owner;
    if (!owner) { lines.push(`request: ${slow.id}: no owning package (a root test); none filed`); continue; }
    const why = `clossys check --fast at ${record.head}: ${slow.id} took ${slow.seconds}s run alone, over the ${record.slowSeconds}s test budget (no timeout was raised)`;
    const result = await runRequestCli(["--kind", "report", "--about", `agent/${owner}`, "--what", "gap", "--why", why, "--from", "owner", "--by", "producer", "--root", root], repo);
    if (result.exitCode !== 0) failed = true;
    lines.push(`request: ${slow.id} -> agent/${owner}: ${result.message.split("\n")[0]}`);
  }
  return { lines, failed };
}

export async function runFastCli(argv: readonly string[], cwd: string, budget: { budgetMs?: number; slowMs?: number } = {}): Promise<CliResult> {
  const args = parse(argv);
  let workspace: string | undefined;
  if (args.fileRequests) {
    try { workspace = discoverRoot(resolve(cwd, args.root ?? ".")); }
    catch (error) {
      if (error instanceof RootDiscoveryError) throw new CliUsageError(`check --fast --file-requests needs a clossys workspace to file into: ${error.message}\n${FAST_USAGE}`);
      throw error;
    }
  }
  let record: FastRecord;
  try {
    record = await runFast({ repo: cwd, ...(args.base !== undefined ? { base: args.base } : {}), ...budget, ...(args.json ? {} : { log: line => process.stderr.write(`${line}\n`) }) });
  } catch (error) {
    if (error instanceof FastUsageError) throw new CliUsageError(`${error.message}\n${FAST_USAGE}`);
    throw error;
  }
  let requestsFailed = false;
  if (workspace && record.slow.length) {
    const filed = await fileRequests(record, resolve(cwd), workspace);
    requestsFailed = filed.failed;
    record = { ...record, requests: filed.lines };
  }
  const exitCode = record.verdict === "FAST PASS" && !requestsFailed ? 0 : 1;
  return { exitCode, verb: "check", check: true, message: formatFast(record), output: record };
}
