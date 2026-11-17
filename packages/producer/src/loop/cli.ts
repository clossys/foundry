/**
 * `clossys run loop.<name>`: the loop mode of `clossys run` (cli/run.ts keeps the int2 chain mode for every other argv).
 *
 *   clossys run loop.fill [--slot <ref>] [--from <entry>] [--init]
 *   clossys run loop.refine [--slot <ref>] [--from <entry>] [--trigger T3|T5|T6|T7]
 *   clossys run loop.release --publication <id>
 *   clossys run loop.audit
 *   clossys run loop.<name> --resume [--run <runId>] [--step-exit 0|1|2 --model <model> [--step <id>] [--wrote <file>]...]
 *   common: [--root <dir>] [--json]
 *
 * An agent step prints its packet and waits: the agent runs its skill, then the run resumes with the step's exit, the
 * files it wrote and the model that served it (the ledger names the model; the loop version names only the tier).
 * A human step raises its queue entry and waits; `--resume` after `clossys answer` goes on.
 * Exit 0: the run ended done or pinned-ready, or waits. 1: it stopped on a failure. 2: it could not run.
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { REFS_DANGLING, checkRefsDangling } from "../check/refs-dangling.js";
import { LOOP_REACHABLE, loopReachable } from "../check/loop-reachable.js";
import { TREE_CHECKS, runIaSyncCli } from "../cli/ia-sync.js";
import type { CliResult } from "../cli/main.js";
import { discoverRoot } from "../cli/root.js";
import { isLoopName, LOOP_NAMES, RUN_ID, type LoopName } from "./names.js";
import type { Finding } from "./route.js";
import { fillAll, readRunState, resumeRun, runInit, startRun, waitingRuns, type AgentOutcome, type AgentPacket, type CodeCall, type CodeOutcome, type Exit, type RunHooks, type RunResult } from "./runner.js";

export const LOOP_RUN_USAGE = "Usage: clossys run loop.<fill|refine|create|choose|release|audit> [--slot <agent>/<slot-id>] [--from <entry>] [--publication <id>] [--trigger <Tn>] [--init] [--root <dir>] [--json]\n"
  + "       clossys run loop.<name> --resume [--run <runId>] [--step-exit 0|1|2 --model <model> [--step <id>] [--wrote <file>]...] [--root <dir>] [--json]\n"
  + "  Runs the loop version the consumer pins (else the package v1) one step at a time and writes one ledger entry per run.\n"
  + "  An agent step prints its packet and waits for --resume with its exit, files and serving model; a human step waits on its queue entry.\n"
  + "  loop.fill with no --slot fills the next slot still on a package default, in chain order, until none is left or a run waits.";

class LoopUsage extends Error {}

interface LoopFlags {
  loop: LoopName; slot?: string; from?: string; publication?: string; trigger?: string; init: boolean;
  resume: boolean; run?: string; stepExit?: Exit; model?: string; step?: string; wrote: string[]; root?: string; json: boolean; help: boolean;
}

function parse(argv: readonly string[]): LoopFlags {
  const name = argv[0]!;
  if (!isLoopName(name)) throw new LoopUsage(`${name} is not a loop (${LOOP_NAMES.join(", ")})`);
  const flags: LoopFlags = { loop: name, init: false, resume: false, wrote: [], json: false, help: false };
  const value = (index: number, flag: string): string => {
    const next = argv[index];
    if (next === undefined || next.startsWith("--")) throw new LoopUsage(`${flag} requires a value`);
    return next;
  };
  for (let index = 1; index < argv.length; index++) {
    const arg = argv[index]!;
    if (arg === "--json") flags.json = true;
    else if (arg === "--help") flags.help = true;
    else if (arg === "--init") flags.init = true;
    else if (arg === "--resume") flags.resume = true;
    else if (arg === "--slot") flags.slot = value(++index, arg);
    else if (arg === "--from") flags.from = value(++index, arg);
    else if (arg === "--publication") flags.publication = value(++index, arg);
    else if (arg === "--trigger") flags.trigger = value(++index, arg);
    else if (arg === "--run") flags.run = value(++index, arg);
    else if (arg === "--model") flags.model = value(++index, arg);
    else if (arg === "--step") flags.step = value(++index, arg);
    else if (arg === "--wrote") flags.wrote.push(value(++index, arg));
    else if (arg === "--root") flags.root = value(++index, arg);
    else if (arg === "--step-exit") {
      const exit = Number(value(++index, arg));
      if (exit !== 0 && exit !== 1 && exit !== 2) throw new LoopUsage(`--step-exit takes 0, 1 or 2`);
      flags.stepExit = exit;
    } else throw new LoopUsage(`Unknown argument: ${arg}`);
  }
  if (!flags.resume && (flags.run || flags.stepExit !== undefined || flags.model || flags.step || flags.wrote.length)) throw new LoopUsage("--run, --step-exit, --model, --step and --wrote go with --resume");
  if ((flags.step || flags.wrote.length) && flags.stepExit === undefined) throw new LoopUsage("--step and --wrote go with --step-exit");
  // B8: the run id names a file under .clossys/runs/loops/, and --wrote files are read under clossys/agents/.
  if (flags.run !== undefined && !RUN_ID.test(flags.run)) throw new LoopUsage(`--run ${JSON.stringify(flags.run)} is not a run id (<yyyymmdd>T<hhmm>Z-<slug>)`);
  for (const file of flags.wrote) {
    if (!SAFE_WROTE.test(file) || file.split("/").some(part => part === ".." || part === ".")) throw new LoopUsage(`--wrote ${JSON.stringify(file)} is not a path inside clossys/agents/ (relative, no .. or .)`);
  }
  if (flags.stepExit !== undefined && !flags.model) throw new LoopUsage("--step-exit records an agent step: name the model that served it with --model");
  if (flags.init && flags.loop !== "loop.fill") throw new LoopUsage("--init starts loop.fill only (flows.md F1)");
  return flags;
}

const SAFE_WROTE = /^(?:\.clossys\/)?[A-Za-z0-9_][A-Za-z0-9_.@+-]*(?:\/[A-Za-z0-9_.@+-]+)*$/;

/** The checks `clossys check --strict` runs inside a loop (B7): a step check outside this list is recorded as not run. */
export const STRICT_RAN: readonly string[] = [...Object.keys(TREE_CHECKS), LOOP_REACHABLE, REFS_DANGLING];

/** Tree-wide findings for `clossys check --strict` inside a loop: the slot/2 tree checks, loop.reachable and refs.dangling. */
export function strictFindings(root: string): Finding[] {
  const findings: Finding[] = [];
  for (const check of [...Object.values(TREE_CHECKS), loopReachable]) {
    for (const finding of check.run(root).findings) findings.push({ check: check.id, subject: finding.subject, detail: finding.detail });
  }
  for (const finding of checkRefsDangling(root).findings) findings.push({ check: finding.check, subject: finding.subject, detail: finding.detail });
  return findings;
}

/** Every file under `clossys/agents/` with what changes when it is written (size, mtime, inode). */
export function agentsSnapshot(root: string): Map<string, string> {
  const out = new Map<string, string>();
  const base = join(root, "clossys", "agents");
  const walk = (dir: string, rel: string): void => {
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir).sort()) {
      if (name.endsWith(".tmp")) continue;
      const path = join(dir, name);
      const stat = statSync(path);
      const at = rel ? `${rel}/${name}` : name;
      if (stat.isDirectory()) walk(path, at);
      else if (stat.isFile()) out.set(at, `${stat.size}:${stat.mtimeMs}:${stat.ino}`);
    }
  };
  walk(base, "");
  return out;
}

/** The files a verb wrote: new or changed under `clossys/agents/` between two snapshots (B4). */
export function wroteBetween(before: ReadonlyMap<string, string>, after: ReadonlyMap<string, string>): string[] {
  return [...after].filter(([file, mark]) => before.get(file) !== mark).map(([file]) => file).sort();
}

/** The answer `--resume --step-exit` gives: bound to the run and the step it waits on (B9). */
export interface StepAnswer { readonly runId: string; readonly step: string; readonly exit: Exit; readonly model: string; readonly wrote: readonly string[] }

/** The hooks the CLI runs with: agents wait (or take --resume's answer), code steps run their verb in-process. */
export function cliHooks(root: string, answer?: StepAnswer, run: (argv: readonly string[], cwd: string) => Promise<CliResult> = defaultRun): RunHooks {
  let pending = answer;
  return {
    agent(packet: AgentPacket): AgentOutcome {
      // The answer is for the step the run waited on; any other agent step waits for its own answer.
      if (!pending || pending.runId !== packet.runId || pending.step !== packet.step) return "wait";
      const outcome = { exit: pending.exit, model: pending.model, wrote: [...pending.wrote] };
      pending = undefined;
      return outcome;
    },
    async code(call: CodeCall): Promise<CodeOutcome> {
      const before = agentsSnapshot(root);
      const outcome = await runCode(call);
      // B4: a step's wrote is what the verb reports (clossys release names its build and manifest), plus every other
      // file the step changed under clossys/agents/, so each code step hands back the files it wrote.
      const changed = wroteBetween(before, agentsSnapshot(root));
      const wrote = [...(outcome.wrote ?? []), ...changed.filter(file => !outcome.wrote?.includes(file))];
      return { ...outcome, wrote };
    },
  };
  async function runCode(call: CodeCall): Promise<CodeOutcome> {
    if (call.cli === "clossys ia sync") {
      const result = await runIaSyncCli(["sync", "--root", root], root);
      return { exit: result.exitCode, detail: result.message };
    }
    if (call.cli === "clossys check --strict") {
      const findings = strictFindings(root);
      return { exit: findings.length ? 1 : 0, findings, ran: STRICT_RAN };
    }
    const argv = call.argv[0] === "clossys" ? call.argv.slice(1) : call.argv;
    try {
      const result = await run([...argv, "--root", root], root);
      // A verb that reports what it wrote and found (clossys release) hands both on: the manifest step names the
      // manifest, a failing gate routes its findings (flows.md F8).
      const output = (typeof result.output === "object" && result.output !== null ? result.output : {}) as { wrote?: unknown; findings?: unknown };
      const wrote = Array.isArray(output.wrote) ? output.wrote.filter((file): file is string => typeof file === "string") : undefined;
      const findings = Array.isArray(output.findings) ? (output.findings as Finding[]).filter(row => typeof row?.subject === "string" && typeof row.detail === "string") : undefined;
      return { exit: result.exitCode, detail: result.message, ...(wrote ? { wrote } : {}), ...(findings?.length ? { findings } : {}) };
    } catch (error) {
      return { exit: 2, detail: error instanceof Error ? error.message : String(error) };
    }
  }
}

async function defaultRun(argv: readonly string[], cwd: string): Promise<CliResult> {
  return (await import("../cli/main.js")).runCli(argv, cwd);
}

function describe(result: RunResult): string {
  const lines = [result.message];
  if (result.state) lines.unshift(`${result.state.loop}@${result.state.version.candidate}${result.state.version.source === "package" ? " (package default)" : ""}  run ${result.state.runId}`);
  if (result.packet) {
    const packet = result.packet;
    lines.push(`  agent ${packet.agent}  verb ${packet.verb}  tier ${packet.tier}${packet.skill ? `  skill ${packet.skill}` : ""}`);
    lines.push(`  do: ${packet.cli}`);
    lines.push(`  then: clossys run ${result.state!.loop} --resume --run ${packet.runId} --step-exit <0|1|2> --model <model> [--wrote <file>]...`);
  }
  if (result.entry) lines.push(`  answer it with clossys answer ${result.entry} ..., then clossys run ${result.state!.loop} --resume --run ${result.state!.runId}`);
  if (result.state?.ledger) lines.push(`  ledger ${result.state.ledger}`);
  return lines.join("\n");
}

export async function runLoopCli(argv: readonly string[], cwd: string, options: { now?: () => Date; run?: (argv: readonly string[], cwd: string) => Promise<CliResult> } = {}): Promise<CliResult> {
  let flags: LoopFlags;
  try { flags = parse(argv); } catch (error) {
    if (error instanceof LoopUsage) return { exitCode: 2, message: `${error.message}\n${LOOP_RUN_USAGE}` };
    throw error;
  }
  if (flags.help) return { exitCode: 0, message: LOOP_RUN_USAGE };
  const root = discoverRoot(resolve(cwd, flags.root ?? "."));
  const runOptions = options.now ? { now: options.now } : {};
  const results: RunResult[] = [];
  try {
    if (flags.resume) {
      let runId = flags.run;
      if (!runId) {
        const waiting = waitingRuns(root).filter(state => state.loop === flags.loop);
        if (waiting.length !== 1) return { exitCode: 2, root, message: `run: ${waiting.length} ${flags.loop} runs wait${waiting.length ? ` (${waiting.map(state => state.runId).join(", ")}); name one with --run` : ""}` };
        runId = waiting[0]!.runId;
      }
      const state = readRunState(root, runId);
      if (flags.stepExit !== undefined && state?.waiting?.on !== "agent") return { exitCode: 2, root, message: `run: ${runId} waits on ${state?.waiting?.on === "entry" ? state.waiting.entry : "nothing"}, not an agent step; --step-exit answers an agent step` };
      if (flags.step !== undefined && flags.step !== state?.waiting?.step) return { exitCode: 2, root, message: `run: ${runId} waits on step ${state?.waiting?.step ?? "none"}, not ${flags.step}` };
      const answer = flags.stepExit !== undefined && state?.waiting ? { runId, step: state.waiting.step, exit: flags.stepExit, model: flags.model!, wrote: flags.wrote } : undefined;
      const hooks = cliHooks(root, answer, options.run);
      const result = await resumeRun(root, runId, hooks, runOptions);
      results.push(result);
      if (flags.loop === "loop.fill" && !flags.slot && result.exitCode === 0 && result.state?.status === "done" && !result.state.from) results.push(...await fillAll(root, hooks, runOptions));
    } else {
      const hooks = cliHooks(root, undefined, options.run);
      if (flags.init) {
        const init = await runInit(root, hooks, runOptions);
        results.push(init);
        if (init.exitCode === 0) results.push(...await fillAll(root, hooks, runOptions));
      } else if (flags.loop === "loop.fill" && !flags.slot && !flags.from) {
        results.push(...await fillAll(root, hooks, runOptions));
        if (!results.length) return { exitCode: 0, root, message: "run: loop.fill has nothing to fill (no consumed slot is on a package default)" };
      } else {
        results.push(await startRun(root, {
          loop: flags.loop,
          ...(flags.slot ? { slot: flags.slot } : {}), ...(flags.from ? { from: flags.from } : {}),
          ...(flags.publication ? { publication: flags.publication } : {}), ...(flags.trigger ? { trigger: flags.trigger } : {}),
        }, hooks, runOptions));
      }
    }
  } catch (error) {
    return { exitCode: 2, root, message: `run: ${error instanceof Error ? error.message : String(error)}` };
  }
  const last = results[results.length - 1]!;
  return { exitCode: last.exitCode, root, output: results.map(result => ({ exitCode: result.exitCode, message: result.message, state: result.state, packet: result.packet, entry: result.entry })), message: results.map(describe).join("\n") };
}
