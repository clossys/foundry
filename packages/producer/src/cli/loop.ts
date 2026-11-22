/**
 * `clossys loop <agent>/loop.<name>` (foundry-build-0048 U9a): the agent's own pinned version of one of its five loops,
 * the version the loop runner runs for that agent's subjects.
 *
 * Without --check it first makes the agent's loops the consumer's: it adopts the agent's loops L1 and five loop slots
 * (loop/agent-loop-adopt.ts, one guarded write) and pins each unpinned loop slot to the agent's candidate through the
 * pin gate (`clossys pin`, planner basis by default: certified, scored, recorded). Then it judges the pin against
 * Producer's standard (agent-loops.ts agentLoopIssues) and asks the runner itself what it would run: planRun (writes
 * nothing) for one real subject of the agent (loop.scope --agent, its first open request for loop.slot, its first slot
 * for create, choose and cascade). The verdict says "runs <ref>" only for a version the runner planned; with no subject
 * to plan on it says so. With --check it writes nothing and only judges. Exit 0 when the named loop is pinned, extends
 * its standard and the runner plans that pin.
 */
import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { adoptAgentLoops, adoptedLoopCandidate, holdsAdoptedLoops } from "../loop/agent-loop-adopt.js";
import { AGENT_LOOPS, agentLoopIssues, isAgentLoop, isLoopAgent, readAgentLoopPin, type AgentLoopName, type LoopAgent } from "../loop/agent-loops.js";
import { planRun, type StartInput } from "../loop/runner.js";
import { listRequests, targetOf } from "../records/request.js";
import { toIsoZ } from "../records/pin.js";
import { SeatRefusal } from "../records/seat-owner.js";
import { CliUsageError } from "./args.js";
import type { CliResult } from "./main.js";
import { runStep } from "../pipeline/runner.js";
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
  /** What `clossys run` plans for one real subject of the agent: the subject and the version ref it runs. */
  readonly plan?: { readonly subject: string; readonly runs: string };
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
    const own = await adoptAndPinAgentLoops(workspace, agent, by, when, cwd);
    adopted = own.adopted;
    pinned.push(...own.pinned);
    if (own.issues.length) return done(workspace, { loop: target, adopted, pinned, issues: own.issues });
  }
  if (!holdsAdoptedLoops(workspace, agent)) {
    return done(workspace, { loop: target, adopted, pinned, issues: [`${target}: the consumer holds no ${agent} loop slots; run clossys loop ${target} without --check to adopt and pin them`] });
  }
  const own = readAgentLoopPin(workspace, agent, loop);
  if (own === undefined || !own.ok) return done(workspace, { loop: target, adopted, pinned, issues: [own?.ok === false ? own.reason : `${target} is not pinned`] });
  const issues = agentLoopIssues(agent, loop, own.content, { root: workspace });
  // The runner's own plan for a real subject of the agent: what `clossys run <loop>` would run, nothing injected.
  const input = planInput(workspace, agent, loop);
  let plan: LoopCliOutput["plan"];
  if (input) {
    const planned = planRun(workspace, input.input, when);
    if (!planned.ok) issues.push(`the runner does not plan ${loop} for ${input.subject}: ${planned.reason}`);
    else {
      plan = { subject: input.subject, runs: planned.state.version.ref };
      if (planned.state.version.ref !== own.ref) issues.push(`the runner plans ${planned.state.version.ref} for ${input.subject}, not the pin ${own.ref}`);
    }
  }
  const content = own.content as { steps?: readonly { id: string; decider: { by: string; agent?: string; tier?: string; skill?: string } }[] };
  const steps = (Array.isArray(content.steps) ? content.steps : []).map(step => step.decider.by === "agent"
    ? { id: step.id, by: `agent:${step.decider.agent} ${step.decider.tier}`, ...(step.decider.skill ? { skill: step.decider.skill } : {}) }
    : { id: step.id, by: step.decider.by });
  return done(workspace, { loop: target, adopted, pinned, ref: own.ref, sha256: own.sha256, ...(plan ? { plan } : {}), steps, issues });
}

/**
 * One real subject of the agent the runner can plan this loop on: loop.scope for the agent, the agent's first open
 * request (loop.slot), or the agent's first content slot (create, choose, cascade). Undefined: none to plan on.
 */
function planInput(root: string, agent: LoopAgent, loop: AgentLoopName): { input: StartInput; subject: string } | undefined {
  if (loop === "loop.scope") return { input: { loop, agent }, subject: `--agent ${agent}` };
  if (loop === "loop.slot") {
    const open = listRequests(join(root, "clossys")).map(read => read.request).find(request => request !== undefined && request.status === "open" && targetOf(request)?.agent === agent);
    return open ? { input: { loop, request: open.id }, subject: `request ${open.id}` } : undefined;
  }
  const dir = join(root, "clossys", "agents", agent);
  const slot = (existsSync(dir) ? readdirSync(dir).sort() : []).find(id => !isAgentLoop(id) && existsSync(join(dir, id, "slot.json")));
  return slot ? { input: { loop, slot: `${agent}/${slot}` }, subject: `${agent}/${slot}` } : undefined;
}

/**
 * Makes the agent's loops the consumer's: adopts its loops L1 and five loop slots (one guarded write) and pins each
 * unpinned loop slot to the agent's candidate through the pin gate (`by`, a planner or owner basis). `clossys loop`
 * runs it before judging; `clossys init` runs it for every agent the workspace places (init-loops.ts). An existing
 * pin is kept, a pin that does not resolve is reported and never replaced; the first refusal ends it.
 */
export async function adoptAndPinAgentLoops(workspace: string, agent: LoopAgent, by: string, at: string, cwd: string): Promise<{ adopted: boolean; pinned: string[]; issues: string[] }> {
  const pinned: string[] = [];
  // U7 r5 (Q9): adoption judges the actor itself (assertActor) before it writes; a refused actor adopts nothing.
  let adopt: ReturnType<typeof adoptAgentLoops>;
  try { adopt = adoptAgentLoops(workspace, agent, { by, at }); } catch (error) {
    if (error instanceof SeatRefusal) return { adopted: false, pinned, issues: [error.message] };
    throw error;
  }
  if (adopt.refused.length) return { adopted: false, pinned, issues: adopt.refused.map(issue => `adopt refused: ${issue}`) };
  for (const each of AGENT_LOOPS) {
    const pin = await pinOwn(workspace, agent, each, by, at, cwd);
    if (pin === "pinned") pinned.push(`${agent}/${each}`);
    else if (pin !== "held") return { adopted: adopt.adopted, pinned, issues: [`pin ${agent}/${each} refused: ${pin}`] };
  }
  return { adopted: adopt.adopted, pinned, issues: [] };
}

/** Pin the agent's loop slot to its adopted candidate through the pin gate, unless it is already pinned. */
async function pinOwn(root: string, agent: LoopAgent, loop: AgentLoopName, by: string, at: string, cwd: string): Promise<"pinned" | "held" | string> {
  const current = readAgentLoopPin(root, agent, loop);
  if (current?.ok) return "held";
  // A pin that is there but does not resolve is the consumer's (maybe the owner's): reported, never replaced.
  if (existsSync(join(root, "clossys", "agents", agent, loop, "pin.json"))) return `${agent}/${loop} holds a pin that does not resolve (${current?.ok === false ? current.reason : "unreadable"}); fix or repin it with clossys pin`;
  const result = await runStep(["pin", `${agent}/${loop}`, adoptedLoopCandidate(loop), "--by", by, ...(by.startsWith("owner") ? ["--basis", "picked"] : []), "--at", at, "--root", root], cwd);
  return result.exitCode === 0 ? "pinned" : result.message;
}

function done(root: string, output: LoopCliOutput): CliResult {
  const ok = output.issues.length === 0 && output.ref !== undefined;
  const standard = `producer/${output.loop.split("/")[1]}`;
  const head = output.plan ? ` runs ${output.plan.runs} (planned for ${output.plan.subject}${ok ? `; pinned, extends ${standard}` : ""})`
    : output.ref ? ` pins ${output.ref} (no subject to plan a run on${ok ? `; extends ${standard}` : ""})` : "";
  const lines = [
    `VERDICT: ${ok ? "PASS" : "FAIL"} ${output.loop}${head}`,
    ...(output.adopted ? [`  adopted ${output.loop.split("/")[0]}'s five loop slots`] : []),
    ...(output.pinned.length ? [`  pinned ${output.pinned.join(", ")}`] : []),
    ...(output.steps ?? []).map(step => `  step ${step.id}  ${step.by}${step.skill ? `  ${step.skill}` : ""}`),
    ...output.issues.map(issue => `  issue: ${issue}`),
  ];
  return { exitCode: ok ? 0 : 1, root, output, message: lines.join("\n") };
}
