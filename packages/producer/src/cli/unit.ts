/**
 * `clossys unit env|tier|run|check` (CP1-PLANNERRUN): the Planner picks a unit's env and tier from its
 * packet by rule (./unit-rules.ts, owner rules R-UNIT-ENV and R-UNIT-TIER) and launches it, so the right
 * executor picks it up without a hand-written brief. Launches are recorded in the planner's loop state
 * (@clossys/controller/loop), where a launch with no pushed progress after 90 minutes is flagged stale.
 * Nothing here starts a session: `run` writes the prompt and prints the command.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import {
  emptyLoopState, failedCloudLaunches, markLatestLaunchFailed, recordUnitLaunch, refreshUnitRuns, validateLoopState,
  type LoopState, type UnitRun,
} from "@clossys/controller/loop";
import { CliUsageError } from "./args.js";
import type { CliResult } from "./main.js";
import {
  cloudCommand, cloudPrompt, decideEnv, decideTier, localLaunch, readPacket, readTierTable, UnitReadError, UnitRefusal,
  type EnvDecision, type EnvFacts, type PacketBase, type TierDecision, type TierRow, type UnitPacket,
} from "./unit-rules.js";

export const UNIT_USAGE = [
  "Usage: clossys unit env <packet.md> [--root <repo>] [--state <loop.json>] [--json]",
  "       clossys unit tier <packet.md> [--skill <SKILL.md>] [--root <repo>] [--json]",
  "       clossys unit run <packet.md> [--dry-run] [--out <dir>] [--mark-failed <reason>] [--skill <SKILL.md>] [--root <repo>] [--state <loop.json>] [--json]",
  "       clossys unit check <packet.md|dir> [--skill <SKILL.md>] [--root <repo>] [--state <loop.json>]",
  "  env    prints the unit's env and its reason (R-UNIT-ENV): cloud by default; local only when the write set names",
  "         a path outside the repository, the packet says Step: fold (the fold gate), the base commit is not on the",
  "         remote as last fetched, or the launch log shows two failed cloud launches. Env: local with no need is refused.",
  "  tier   applies the tier table in the Planner skill (R-UNIT-TIER): gate-class lexicon is high; one behaviour, at most",
  "         three files and a named failing test is low; otherwise mid. A packet tier below that floor is refused.",
  "  run    cloud: writes a self-sufficient prompt (<out>/<ID>.cloud-prompt.md, default beside the packet) and prints the",
  "         claude --cloud command; local: prints the wt lease command and the tier profile (program-<tier>). It records",
  "         the launch (unit, env, tier, time) in the loop state and flags any launch with no pushed progress after",
  "         90 minutes as stale. --dry-run prints only: no file, no record. --mark-failed records the unit's latest",
  "         launch as failed instead of launching. Nothing starts a session.",
  "  check  runs env and tier over one packet or every *.md packet in a directory; exit 1 when any is refused.",
  "  --root   the repository (default: the git checkout around the working directory)",
  "  --state  the planner's loop state (default: <root>/clossys/.state/planner/loop.json)",
  "  --skill  the Planner skill holding the tier table (default: <root>/packages/planner/skill/SKILL.md)",
  "Exit 0 accepted, 1 refused (the rule is named), 2 on a usage or read error.",
].join("\n");

/** What the verbs read from outside the packet; tests pass fakes, the CLI reads git and the clock. */
export interface UnitDeps {
  readonly now: () => Date;
  /** The branch's head on the remote as last fetched; null when there is none. */
  readonly remoteHead: (root: string, branch: string) => string | null;
  /** Whether the base is on the remote as last fetched; null when that cannot be told. */
  readonly baseOnRemote: (root: string, base: PacketBase) => boolean | null;
}

const gitOut = (root: string, args: readonly string[]): { ok: boolean; out: string } => {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  return { ok: result.status === 0, out: (result.stdout ?? "").trim() };
};

export const GIT_DEPS: UnitDeps = {
  now: () => new Date(),
  remoteHead: (root, branch) => { const head = gitOut(root, ["rev-parse", "--verify", "--quiet", `refs/remotes/origin/${branch}^{commit}`]); return head.ok && head.out ? head.out : null; },
  baseOnRemote: (root, base) => {
    if (!gitOut(root, ["rev-parse", "--git-dir"]).ok || !gitOut(root, ["remote", "get-url", "origin"]).ok) return null;
    if (base.sha) { const on = gitOut(root, ["branch", "-r", "--contains", base.sha]); return on.ok && on.out !== ""; }
    if (base.branch) return gitOut(root, ["rev-parse", "--verify", "--quiet", `refs/remotes/origin/${base.branch}`]).ok;
    return null;
  },
};

interface Options { positional: string[]; set: Set<string>; given: Map<string, string> }
function options(argv: readonly string[]): Options {
  const flags = ["--json", "--dry-run"], values = ["--root", "--state", "--skill", "--out", "--mark-failed"];
  const positional: string[] = [], set = new Set<string>(), given = new Map<string, string>();
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]!;
    if (flags.includes(arg)) { set.add(arg); continue; }
    if (values.includes(arg)) {
      const value = argv[++index];
      if (value === undefined || value.startsWith("--")) throw new CliUsageError(`${arg} requires a value\n${UNIT_USAGE}`);
      given.set(arg, value);
      continue;
    }
    if (arg.startsWith("--")) throw new CliUsageError(`Unknown option ${arg}\n${UNIT_USAGE}`);
    positional.push(arg);
  }
  return { positional, set, given };
}

const repoRoot = (cwd: string) => { const top = gitOut(cwd, ["rev-parse", "--show-toplevel"]); return top.ok && top.out ? top.out : cwd; };
export const STATE_PATH = "clossys/.state/planner/loop.json";
export const SKILL_PATH = "packages/planner/skill/SKILL.md";

function readText(path: string, what: string): string {
  try { return readFileSync(path, "utf8"); } catch (error) { throw new UnitReadError(`cannot read the ${what} at ${path}: ${(error as Error).message}`); }
}

function loadState(path: string): LoopState {
  if (!existsSync(path)) return emptyLoopState("planner");
  let doc: unknown;
  try { doc = JSON.parse(readText(path, "loop state")); } catch (error) { throw error instanceof UnitReadError ? error : new UnitReadError(`the loop state at ${path} is not JSON`); }
  const findings = validateLoopState(doc);
  if (findings.length) throw new UnitReadError(`the loop state at ${path} is malformed: ${findings.map(finding => `${finding.path}: ${finding.message}`).join("; ")}`);
  return doc as LoopState;
}

function saveState(path: string, state: LoopState): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`);
}

interface Context { root: string; statePath: string; skillPath: string; deps: UnitDeps }

const envFacts = (context: Context, state: LoopState): EnvFacts => ({
  baseOnRemote: base => context.deps.baseOnRemote(context.root, base),
  failedCloudLaunches: unit => failedCloudLaunches(state, unit),
});

const tierTable = (context: Context): readonly TierRow[] => readTierTable(readText(context.skillPath, "Planner skill"), context.skillPath);
const packetAt = (path: string): UnitPacket => readPacket(readText(path, "packet"), path);

const envLine = (decision: EnvDecision) => `env: ${decision.env} (${decision.reason})${decision.declared && decision.declared !== decision.env ? `; overrides the packet's Env: ${decision.declared}` : ""}`;
const tierLine = (decision: TierDecision) => `tier: ${decision.tier} (floor ${decision.floor}: ${decision.reason})${decision.declared ? `; the packet says ${decision.declared}` : ""}`;

function staleLines(stale: readonly UnitRun[]): string[] {
  return stale.map(run => `stale: ${run.unit} launched ${run.at} on ${run.env} (${run.tier}); no progress pushed to ${run.branch} in 90 minutes`);
}

function runVerb(packetPath: string, opts: Options, context: Context): CliResult {
  const statePath = context.statePath;
  let state = loadState(statePath);
  const packet = packetAt(packetPath);
  if (opts.given.has("--mark-failed")) {
    const marked = markLatestLaunchFailed(state, packet.id, opts.given.get("--mark-failed")!);
    if (!marked.run) return { exitCode: 2, message: `unit run: ${packet.id} has no recorded launch to mark failed` };
    saveState(statePath, marked.state);
    return { exitCode: 0, message: `unit run: recorded ${packet.id}'s launch of ${marked.run.at} (${marked.run.env}) as failed`, output: { unit: packet.id, failed: marked.run } };
  }
  const env = decideEnv(packet, envFacts(context, state));
  const tier = decideTier(packet, tierTable(context));
  if (!packet.branch) throw new UnitReadError(`${packet.path} has no Branch: \`<unit branch>\` line; a launch pushes to the unit branch`);
  const now = context.deps.now();
  const refreshed = refreshUnitRuns(state, now, branch => context.deps.remoteHead(context.root, branch));
  state = refreshed.state;
  const dryRun = opts.set.has("--dry-run");
  const lines = [envLine(env), tierLine(tier)];
  let output: Record<string, unknown>;
  if (env.env === "cloud") {
    const repository = packet.repository ?? "this repository";
    const prompt = cloudPrompt({ packet, env, tier, repository, branch: packet.branch });
    const promptFile = resolve(opts.given.get("--out") ?? dirname(resolve(packetPath)), `${packet.id}.cloud-prompt.md`);
    const command = cloudCommand(promptFile);
    if (dryRun) lines.push("--- prompt (dry run: not written) ---", prompt, "--- end prompt ---");
    else { mkdirSync(dirname(promptFile), { recursive: true }); writeFileSync(promptFile, prompt); lines.push(`prompt: ${promptFile}`); }
    lines.push(`command: ${command}`);
    output = { unit: packet.id, env, tier, promptFile, command, ...(dryRun ? { prompt } : {}) };
  } else {
    const local = localLaunch(packet, tier.tier, packet.branch);
    lines.push(`command: ${local.command}`, `profile: ${local.profile}`);
    output = { unit: packet.id, env, tier, command: local.command, profile: local.profile };
  }
  lines.push(...staleLines(refreshed.stale));
  if (dryRun) lines.push("dry run: nothing written, no launch recorded");
  else {
    const run: UnitRun = { unit: packet.id, env: env.env, tier: tier.tier, at: now.toISOString(), branch: packet.branch, headAtLaunch: context.deps.remoteHead(context.root, packet.branch), status: "launched" };
    state = recordUnitLaunch(state, run);
    saveState(statePath, state);
    lines.push(`recorded: ${packet.id} ${run.env} ${run.tier} at ${run.at} in ${statePath}`);
  }
  return { exitCode: 0, message: lines.join("\n"), output: { ...output, stale: refreshed.stale, recorded: !dryRun } };
}

function packetsIn(target: string): string[] {
  if (!existsSync(target)) throw new UnitReadError(`no packet or directory at ${target}`);
  if (!statSync(target).isDirectory()) return [target];
  return readdirSync(target).filter(name => name.endsWith(".md")).sort().map(name => join(target, name));
}

function checkVerb(target: string, context: Context): CliResult {
  const state = loadState(context.statePath);
  const table = tierTable(context);
  const lines: string[] = [];
  const results: unknown[] = [];
  let refused = 0;
  for (const path of packetsIn(target)) {
    try {
      const packet = packetAt(path);
      const env = decideEnv(packet, envFacts(context, state));
      const tier = decideTier(packet, table);
      lines.push(`ok      ${basename(path)}  ${env.env}  ${tier.tier}`);
      results.push({ packet: path, env: env.env, tier: tier.tier });
    } catch (error) {
      if (!(error instanceof UnitRefusal)) throw error;
      refused++;
      lines.push(`refused ${basename(path)}  ${error.rule}  ${error.message}`);
      results.push({ packet: path, refused: error.rule, message: error.message });
    }
  }
  lines.push(`unit check: ${results.length} packet(s), ${refused} refused`);
  return { exitCode: refused ? 1 : 0, message: lines.join("\n"), output: { packets: results, refused } };
}

export async function runUnitCli(argv: readonly string[], cwd: string, deps: UnitDeps = GIT_DEPS): Promise<CliResult> {
  if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) return { exitCode: argv.length === 0 ? 2 : 0, message: UNIT_USAGE };
  const [verb, ...rest] = argv as [string, ...string[]];
  if (!["env", "tier", "run", "check"].includes(verb)) throw new CliUsageError(`unit: unknown verb ${JSON.stringify(verb)}\n${UNIT_USAGE}`);
  const opts = options(rest);
  if (opts.positional.length !== 1) throw new CliUsageError(`unit ${verb} needs exactly one ${verb === "check" ? "packet or directory" : "packet"}\n${UNIT_USAGE}`);
  const root = opts.given.has("--root") ? resolve(cwd, opts.given.get("--root")!) : repoRoot(cwd);
  const context: Context = {
    root, deps,
    statePath: resolve(cwd, opts.given.get("--state") ?? join(root, STATE_PATH)),
    skillPath: resolve(cwd, opts.given.get("--skill") ?? join(root, SKILL_PATH)),
  };
  const target = resolve(cwd, opts.positional[0]!);
  try {
    if (verb === "check") return checkVerb(target, context);
    if (verb === "run") return runVerb(target, opts, context);
    const packet = packetAt(target);
    if (verb === "env") {
      const decision = decideEnv(packet, envFacts(context, loadState(context.statePath)));
      return { exitCode: 0, message: envLine(decision), output: { unit: packet.id, ...decision } };
    }
    const decision = decideTier(packet, tierTable(context));
    return { exitCode: 0, message: tierLine(decision), output: { unit: packet.id, ...decision } };
  } catch (error) {
    if (error instanceof UnitRefusal) return { exitCode: 1, message: `unit ${verb}: refused: ${error.message}`, output: { refused: error.rule, message: error.message } };
    if (error instanceof UnitReadError) return { exitCode: 2, message: `unit ${verb}: ${error.message}` };
    throw error;
  }
}
