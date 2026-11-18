/**
 * `clossys loop <agent>/loop.<name>` (foundry-build-0048 U9a): the agent's own pinned version of one of its five loops,
 * the version the loop runner runs for that agent's subjects.
 *
 * Without --check it first makes the agent's loops the consumer's: it adopts the agent's loops L1 and five loop slots
 * (loop/agent-loop-adopt.ts, one guarded write) and pins each unpinned loop slot to the agent's candidate through the
 * pin gate (`clossys pin`, planner basis by default: certified, scored, recorded). Then it loads the loop as the runner
 * does (loop/version.ts loadLoopVersion) and judges it against Producer's standard (agent-loops.ts agentLoopIssues).
 * With --check it writes nothing and only judges. Exit 0 when the named loop is pinned and extends its standard.
 */
import { resolve } from "node:path";
import { adoptAgentLoops, adoptedLoopCandidate, holdsAdoptedLoops } from "../loop/agent-loop-adopt.js";
import { AGENT_LOOPS, agentLoopIssues, isAgentLoop, isLoopAgent, readAgentLoopPin, type AgentLoopName, type LoopAgent } from "../loop/agent-loops.js";
import { loadLoopVersion } from "../loop/version.js";
import { toIsoZ } from "../records/pin.js";
import { CliUsageError } from "./args.js";
import type { CliResult } from "./main.js";
import { runPinCli } from "./pin.js";
import { discoverRoot } from "./root.js";

export const LOOP_USAGE = "Usage: clossys loop <agent>/loop.<scope|slot|create|choose|cascade> [--check] [--by planner[:<ref>]|owner:<ref>] [--at <iso>] [--root <dir>] [--json]\n"
  + "  the agent's own pinned version of one of its loops (director, designer, writer, publisher): the version the loop\n"
  + "  runner runs for that agent's slots. Without --check, first adopts the agent's five loop slots (its loops L1) and\n"
  + "  pins each unpinned one to the agent's loop candidate through the pin gate (--by, default planner:package-default).\n"
  + "  --check writes nothing. Exit 1 when the loop is not pinned or does not extend Producer's standard loop.";

const DEFAULT_BY = "planner:package-default";

interface LoopCliOutput {
  readonly loop: string;
  readonly adopted: boolean;
  readonly pinned: readonly string[];
  readonly ref?: string;
  readonly sha256?: string;
  readonly steps?: readonly { readonly id: string; readonly by: string; readonly skill?: string }[];
  readonly issues: readonly string[];
}

export async function runLoopCli(argv: readonly string[], cwd: string): Promise<CliResult> {
  let target: string | undefined, root: string | undefined, by = DEFAULT_BY, at: string | undefined, check = false;
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]!;
    if (arg === "--help") return { exitCode: 0, message: LOOP_USAGE };
    if (arg === "--json") continue;
    if (arg === "--check") { check = true; continue; }
    if (arg === "--root" || arg === "--by" || arg === "--at") {
      const value = argv[++index];
      if (value === undefined || value.startsWith("--")) throw new CliUsageError(`${arg} requires a value\n${LOOP_USAGE}`);
      if (arg === "--root") root = value; else if (arg === "--by") by = value; else at = value;
      continue;
    }
    if (arg.startsWith("--") || target !== undefined) throw new CliUsageError(`Unknown argument: ${arg}\n${LOOP_USAGE}`);
    target = arg;
  }
  if (target === undefined) throw new CliUsageError(`clossys loop needs <agent>/loop.<name>\n${LOOP_USAGE}`);
  const [agent, loop, ...rest] = target.split("/");
  if (rest.length || agent === undefined || loop === undefined || !isLoopAgent(agent) || !isAgentLoop(loop)) {
    throw new CliUsageError(`${target} is no agent loop: <director|designer|writer|publisher>/<${AGENT_LOOPS.join("|")}>\n${LOOP_USAGE}`);
  }
  if (!/^(planner|owner)(:.+)?$/.test(by) || by === "owner") throw new CliUsageError(`--by must be planner[:<ref>] or owner:<ref>, got ${by}\n${LOOP_USAGE}`);
  const when = at === undefined ? new Date().toISOString().replace(/\.\d+Z$/, "Z") : toIsoZ(at);
  if (when === undefined) throw new CliUsageError(`--at must be an ISO timestamp, got ${at}\n${LOOP_USAGE}`);
  const workspace = discoverRoot(resolve(cwd, root ?? "."));

  let adopted = false;
  const pinned: string[] = [];
  if (!check) {
    const adopt = adoptAgentLoops(workspace, agent, { by: by.split(":")[0]!, at: when });
    if (adopt.refused.length) return done(workspace, { loop: target, adopted: false, pinned, issues: adopt.refused.map(issue => `adopt refused: ${issue}`) });
    adopted = adopt.adopted;
    for (const each of AGENT_LOOPS) {
      const pin = await pinOwn(workspace, agent, each, by, when, cwd);
      if (pin === "pinned") pinned.push(`${agent}/${each}`);
      else if (pin !== "held") return done(workspace, { loop: target, adopted, pinned, issues: [`pin ${agent}/${each} refused: ${pin}`] });
    }
  }
  if (!holdsAdoptedLoops(workspace, agent)) {
    return done(workspace, { loop: target, adopted, pinned, issues: [`${target}: the consumer holds no ${agent} loop slots; run clossys loop ${target} without --check to adopt and pin them`] });
  }
  const own = readAgentLoopPin(workspace, agent, loop);
  if (own === undefined || !own.ok) return done(workspace, { loop: target, adopted, pinned, issues: [own?.ok === false ? own.reason : `${target} is not pinned`] });
  const issues = agentLoopIssues(agent, loop, own.content);
  // The runner's own load, so what this verb reports is what `clossys run loop.<name>` runs for the agent's slots.
  const load = loadLoopVersion(workspace, loop, agent);
  if (!load.ok) issues.push(load.reason);
  else if (load.loaded.ref !== own.ref) issues.push(`the runner loads ${load.loaded.ref}, not the pin ${own.ref}`);
  const steps = load.ok ? load.loaded.content.steps.map(step => step.decider.by === "agent"
    ? { id: step.id, by: `agent:${step.decider.agent} ${step.decider.tier}`, ...(step.decider.skill ? { skill: step.decider.skill } : {}) }
    : { id: step.id, by: step.decider.by }) : undefined;
  return done(workspace, { loop: target, adopted, pinned, ref: own.ref, sha256: own.sha256, ...(steps ? { steps } : {}), issues });
}

/** Pin the agent's loop slot to its adopted candidate through the pin gate, unless it is already pinned. */
async function pinOwn(root: string, agent: LoopAgent, loop: AgentLoopName, by: string, at: string, cwd: string): Promise<"pinned" | "held" | string> {
  const current = readAgentLoopPin(root, agent, loop);
  if (current?.ok) return "held";
  const result = await runPinCli([`${agent}/${loop}`, adoptedLoopCandidate(loop), "--by", by, ...(by.startsWith("owner") ? ["--basis", "picked"] : []), "--at", at, "--root", root], cwd);
  return result.exitCode === 0 ? "pinned" : result.message;
}

function done(root: string, output: LoopCliOutput): CliResult {
  const ok = output.issues.length === 0 && output.ref !== undefined;
  const lines = [
    `VERDICT: ${ok ? "PASS" : "FAIL"} ${output.loop}${output.ref ? ` runs ${output.ref}` : ""}${ok ? ` (pinned, extends producer/${output.loop.split("/")[1]})` : ""}`,
    ...(output.adopted ? [`  adopted ${output.loop.split("/")[0]}'s five loop slots`] : []),
    ...(output.pinned.length ? [`  pinned ${output.pinned.join(", ")}`] : []),
    ...(output.steps ?? []).map(step => `  step ${step.id}  ${step.by}${step.skill ? `  ${step.skill}` : ""}`),
    ...output.issues.map(issue => `  issue: ${issue}`),
  ];
  return { exitCode: ok ? 0 : 1, root, output, message: lines.join("\n") };
}
