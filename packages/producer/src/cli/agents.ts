/**
 * `clossys agents check [--repo <dir>] [--dry | --file-requests [--root <workspace>]] [--at <iso>] [--json]` (CP1-AGENTLADDER,
 * owned by Controller in the rules registry: R-AGENTS-CHECK): computes every agent's rung from the rung checks of
 * docs/contracts/agents.json `ladder` (scripts/lib/agent-ladder.mjs of the checkout this Producer is built in), writes
 * docs/contracts/agents.rungs.json and its Producer copy (src/agent-rungs.generated.ts), and exits 1 when an agent's
 * rung falls below the one that file held, or when a member of a list the ladder states a need for (install: packed)
 * is below that rung. Each failure prints with its owner: the agent whose package it is. `--file-requests` files one
 * report per failing agent (`about: agent/<id>`, the missing items as its why) into the workspace's request queue,
 * never a second while one about that agent is open. Root `check` runs it (check:agent-rungs).
 */
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { PRODUCER_ROOT } from "../package-path.js";
import { fileReport, listReports, producerVersion } from "../records/report.js";
import { CliUsageError } from "./args.js";
import type { CliResult } from "./main.js";
import { discoverRoot } from "./root.js";

export const AGENTS_USAGE = "Usage: clossys agents check [--repo <dir>] [--dry | --file-requests [--root <workspace>]] [--at <iso>] [--json]\n"
  + "  computes every agent's rung from the ladder's rung checks, writes docs/contracts/agents.rungs.json, and exits 1 when\n"
  + "  a rung falls or an install agent is below packed. --dry writes nothing. --file-requests files one report per failing\n"
  + "  agent, deduplicated against the open ones.";

/** The lib's computed agent and need, as scripts/lib/agent-ladder.mjs returns them. */
export interface LadderAgent { readonly id: string; readonly rung: string | null; readonly next: string | null; readonly missing: readonly string[] }
export interface LadderResult { readonly ladder: readonly string[]; readonly agents: readonly LadderAgent[]; readonly lists: Readonly<Record<string, { readonly members?: readonly string[] }>> }
interface Shortfall { readonly id: string; readonly list: string; readonly need: string }
interface LadderLib {
  computeLadder(root: string): LadderResult;
  readRungs(root: string): { readonly ladder: readonly string[]; readonly agents: readonly LadderAgent[] } | null;
  writeRungs(root: string, result: LadderResult): readonly string[];
  shortfalls(result: LadderResult): readonly Shortfall[];
  atOrAbove(result: LadderResult, rung: string): readonly string[];
  rungIndex(ladder: readonly string[], rung: string | null): number;
  readonly RUNGS_PATH: string;
}

/** One failing agent: its rung fell, or a list needs a rung it is below. */
export interface AgentFailure { readonly id: string; readonly owner: string; readonly fell?: { readonly from: string | null; readonly to: string | null }; readonly short: readonly Shortfall[]; readonly agent: LadderAgent }

export function failures(lib: LadderLib, prior: ReturnType<LadderLib["readRungs"]>, result: LadderResult): AgentFailure[] {
  const before = new Map((prior?.agents ?? []).map(agent => [agent.id, agent.rung]));
  const short = lib.shortfalls(result);
  return result.agents.flatMap(agent => {
    const was = before.get(agent.id);
    const fell = was !== undefined && prior !== null && lib.rungIndex(prior.ladder, was) > lib.rungIndex(result.ladder, agent.rung) ? { from: was, to: agent.rung } : undefined;
    const mine = short.filter(item => item.id === agent.id);
    return fell || mine.length ? [{ id: agent.id, owner: agent.id, ...(fell ? { fell } : {}), short: mine, agent }] : [];
  });
}

const line = (failure: AgentFailure): string => {
  const head = failure.fell ? `fall ${failure.id}: ${failure.fell.from} -> ${failure.fell.to ?? "none"}` : `shortfall ${failure.id}: at ${failure.agent.rung ?? "none"}`;
  const needs = failure.short.map(item => `${item.list} needs ${item.need}`).join(", ");
  return `${head}${needs ? `; ${needs}` : ""} (owner ${failure.owner}); missing at ${failure.agent.next}: ${failure.agent.missing.join("; ")}`;
};

export async function runAgentsCli(argv: readonly string[], cwd: string): Promise<CliResult> {
  if (argv[0] === "--help" || argv.length === 0) return { exitCode: argv.length === 0 ? 2 : 0, message: AGENTS_USAGE };
  if (argv[0] !== "check") throw new CliUsageError(`Unknown agents verb ${argv[0]}\n${AGENTS_USAGE}`);
  let repo = resolve(PRODUCER_ROOT, "../.."), root: string | undefined, at = new Date().toISOString().replace(/\.\d+Z$/, "Z"), file = false, json = false, dry = false;
  for (let index = 1; index < argv.length; index++) {
    const arg = argv[index]!;
    if (arg === "--help") return { exitCode: 0, message: AGENTS_USAGE };
    if (arg === "--file-requests") { file = true; continue; }
    if (arg === "--json") { json = true; continue; }
    if (arg === "--dry") { dry = true; continue; }
    if (arg === "--repo" || arg === "--root" || arg === "--at") {
      const value = argv[++index];
      if (value === undefined || value.startsWith("--")) throw new CliUsageError(`${arg} requires a value\n${AGENTS_USAGE}`);
      if (arg === "--repo") repo = resolve(cwd, value); else if (arg === "--root") root = value; else at = value;
      continue;
    }
    throw new CliUsageError(`Unknown option ${arg}\n${AGENTS_USAGE}`);
  }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(at)) throw new CliUsageError(`--at must be an ISO timestamp with seconds, ending in Z\n${AGENTS_USAGE}`);
  if (dry && file) throw new CliUsageError(`--dry writes nothing, so it files nothing: drop --file-requests\n${AGENTS_USAGE}`);
  if (root !== undefined && !file) throw new CliUsageError(`--root names the workspace --file-requests files into\n${AGENTS_USAGE}`);
  // The rung checks are the Foundry checkout's own (this Producer's repository); --repo names the agents.json they judge.
  const libPath = join(resolve(PRODUCER_ROOT, "../.."), "scripts/lib/agent-ladder.mjs");
  if (!existsSync(libPath)) return { exitCode: 2, message: `agents check runs the rung checks of the Foundry repository this Producer is built in: ${libPath} is absent` };
  if (!existsSync(join(repo, "docs/contracts/agents.json"))) return { exitCode: 2, message: `agents check judges the agents of a Foundry repository: ${join(repo, "docs/contracts/agents.json")} is absent` };
  const lib = await import(pathToFileURL(libPath).href) as LadderLib;
  const prior = lib.readRungs(repo);
  const result = lib.computeLadder(repo);
  const written = dry ? [] : lib.writeRungs(repo, result);
  const failed = failures(lib, prior, result);
  const lines = failed.map(line);
  const install = result.lists.install?.members ?? [];
  const packed = lib.atOrAbove(result, "packed");
  lines.push(`install list (the source clossys init, the pack script and the front door read): ${install.join(", ") || "none"}`);
  lines.push(`computed at packed or higher: ${packed.join(", ") || "none"}`);
  lines.push(`rungs: ${result.agents.map(agent => `${agent.id} ${agent.rung ?? "none"}`).join(", ")}`);
  lines.push(dry ? "--dry: wrote nothing" : `wrote ${written.join(", ")}`);
  let filed: { created: string[]; open: string[] } | undefined;
  if (file) {
    const consumer = join(discoverRoot(resolve(cwd, root ?? ".")), "clossys");
    filed = { created: [], open: [] };
    for (const failure of failed) {
      const about = `agent/${failure.id}`;
      if (listReports(consumer).some(read => read.report?.status === "open" && read.report.about === about)) { filed.open.push(failure.id); continue; }
      const { created } = fileReport(consumer, {
        about, what: failure.fell ? "bug" : "gap", why: `clossys agents check: ${line(failure)}`, from: "owner", by: "producer", at, source: "check",
        createdBy: { actor: "code", cli: "clossys agents check", version: producerVersion() },
      });
      (created ? filed.created : filed.open).push(failure.id);
    }
    lines.push(`filed ${filed.created.length} request(s)${filed.created.length ? `: ${filed.created.join(", ")}` : ""}; ${filed.open.length} already open${filed.open.length ? `: ${filed.open.join(", ")}` : ""}`);
  }
  lines.push(failed.length ? `agents check: ${failed.length} agent(s) fail the ladder` : "agents check: no rung fell and every list's need holds");
  return { exitCode: failed.length ? 1 : 0, message: lines.join("\n"), ...(json ? { output: { rungs: result.agents, failures: failed.map(({ agent: _agent, ...rest }) => rest), install, packed, ...(filed ? { filed } : {}) } } : {}) };
}
