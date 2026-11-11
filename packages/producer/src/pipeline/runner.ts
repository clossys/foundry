import { resolve } from "node:path";
import { CliUsageError, parseArgs, USAGE, VERBS } from "../cli/args.js";
import type { CliArgs } from "../cli/args.js";
import type { CliResult } from "../cli/main.js";
import { discoverRoot } from "../cli/root.js";
import type { Step } from "./define.js";
import { HANDLERS, MODULE_HANDLERS } from "./handlers.js";
import type { StepContext } from "./handlers.js";
import { STEPS } from "./steps/index.js";
import { appendRecord, buildRecord, invocationOf, observe, sanitizeArgv, tracingEnabled } from "./trace.js";

/**
 * The CLI runs a step only by looking it up here: the verb (and its mode flags) selects one
 * defined step, and the step's declared entry selects its handler. A command no step declares
 * cannot run; a pending step (it lands on another branch) is refused, never run.
 */
const flagKey = (flag: string) => flag.slice(2).replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());

/** The step for a shared-parser verb: every one of its mode flags is set; the most specific wins. */
export function selectStep(verb: string, args: CliArgs, steps: readonly Step[] = STEPS): Step | undefined {
  const flagged = (step: Step) => step.command.cli?.flags ?? [];
  return steps
    .filter(step => step.command.cli?.verb === verb && !step.command.cli.parser)
    .filter(step => flagged(step).every(flag => Boolean((args as unknown as Record<string, unknown>)[flagKey(flag)])))
    .sort((a, b) => flagged(b).length - flagged(a).length)[0];
}

const pendingRefusal = (step: Step): CliResult => ({
  exitCode: 2,
  message: `clossys ${step.command.cli?.verb ?? step.id}: step ${step.id} is pending; it lands on ${step.pending!.branch} and does not run in this build`,
});

async function dispatch(step: Step, context: Omit<StepContext, "step">, steps: readonly Step[]): Promise<CliResult> {
  if (step.pending?.change === "adds") return pendingRefusal(step);
  const handler = step.command.entry ? HANDLERS[step.command.entry] : undefined;
  if (!handler) return { exitCode: 2, message: `${step.id}: no handler is registered for ${step.command.entry ?? "this step"}` };
  let composed: unknown[] | undefined;
  if (step.command.steps) {
    composed = [];
    for (const id of step.command.steps) {
      const part = steps.find(candidate => candidate.id === id);
      const module = typeof part?.command.module === "string" ? part.command.module : undefined;
      const run = module ? MODULE_HANDLERS[module] : undefined;
      if (!part || !run) return { exitCode: 2, message: `${step.id}: composed step ${id} has no registered module` };
      if (part.pending?.change === "adds") return pendingRefusal(part);
      composed.push(await run({ ...context, step: part }));
    }
  }
  return handler({ ...context, step, ...(composed ? { composed } : {}) });
}

/** The step a run resolved to, so the runner can record it (trace.ts). */
interface Resolved { step?: Step }

/**
 * Steps the runner does not record: the trace wrapper records the step it wraps instead, and the
 * Studio server runs until it is stopped, so it has no end or exit to record.
 */
const untraced = (step: Step, argv: readonly string[]): boolean =>
  (step.command.cli?.verb === "pipeline" && argv[1] === "trace") || step.command.cli?.verb === "produce";

/** The workspace a run belongs to: `--root <dir>` when given, else the workspace around cwd; null when there is none. */
function runRoot(argv: readonly string[], cwd: string): string | null {
  const at = argv.findIndex(arg => arg === "--root" || arg.startsWith("--root="));
  const given = at < 0 ? undefined : argv[at]!.includes("=") ? argv[at]!.slice("--root=".length) : argv[at + 1];
  try { return discoverRoot(resolve(cwd, given ?? ".")); } catch { return null; }
}

/**
 * Every step execution appends one run record (trace.ts): what it read and wrote, with hashes, and
 * how it exited. The pipeline page and `clossys pipeline status` derive state from these alone.
 */
export async function runPipeline(argv: readonly string[], cwd: string, steps: readonly Step[] = STEPS): Promise<CliResult> {
  const resolved: Resolved = {};
  // A bare `clossys next --submit <file>` submits to the first open candidates slot (cli/next.ts).
  if (argv[0] === "next" && argv.includes("--submit")) argv = (await import("../cli/next.js")).submitTarget(argv, cwd, steps);
  if (!tracingEnabled()) return run(argv, cwd, steps, resolved);
  const start = new Date();
  const watch = observe();
  let recorded = false;
  const record = (exit: number, result?: CliResult) => {
    const seen = watch.stop();
    // A refused submission (`clossys next --submit`) decided nothing and leaves no record.
    if (recorded || !resolved.step || untraced(resolved.step, argv) || argv.includes("--help") || result?.unrecorded) { recorded = true; return; }
    recorded = true;
    const root = runRoot(argv, cwd);
    if (!root) return;
    const step = resolved.step;
    appendRecord(root, buildRecord({
      root, step: step.id, invocation: invocationOf(argv, step.command.cli?.target), argv: sanitizeArgv(root, argv, cwd),
      start, end: new Date(), exit, observation: seen, ...(result?.runDecision ? { decision: result.runDecision } : {}),
    }));
  };
  // A handler that exits the process still leaves its record.
  const onExit = (code: number) => record(code);
  process.once("exit", onExit);
  try {
    const result = await run(argv, cwd, steps, resolved);
    record(result.exitCode, result);
    return result;
  } catch (error) {
    record(2);
    throw error;
  } finally {
    process.removeListener("exit", onExit);
    watch.stop();
  }
}

async function run(argv: readonly string[], cwd: string, steps: readonly Step[], resolved: Resolved): Promise<CliResult> {
  try {
    const head = argv[0];
    // The chain orchestrators are not steps: they run (and record through) the steps they walk.
    if (head === "run") return await (await import("../cli/run.js")).runRunCli(argv.slice(1), cwd, steps);
    if (head === "next" && !argv.includes("--submit")) return await (await import("../cli/next.js")).runNextCli(argv.slice(1), cwd, steps);
    // The gap finder reads only; the interview (next --owner) asks what it finds.
    if (head === "gaps") return await (await import("../cli/gaps.js")).runGapsCli(argv.slice(1), cwd, steps);
    // A verb with its own parser (specimen, migrate, pipeline) gets its argv untouched.
    // A verb with a target per step (`clossys pin <agent>/<slot>`) runs the step whose agent the argument names.
    const owners = steps.filter(step => step.command.cli?.parser !== undefined && step.command.cli.verb === head);
    const own = owners.find(step => step.command.cli?.target !== undefined && argv.slice(1).some(arg => arg.startsWith(`${step.command.cli!.target}/`))) ?? owners[0];
    if (own) return await dispatch(resolved.step = own, { argv: argv.slice(1), cwd, root: () => discoverRoot(cwd) }, steps);
    // A declared verb the shared parser does not know yet belongs to a pending step.
    const declared = head && !(VERBS as readonly string[]).includes(head) ? steps.find(step => step.command.cli?.verb === head) : undefined;
    if (declared) return await dispatch(resolved.step = declared, { argv, cwd, root: () => discoverRoot(cwd) }, steps);
    const args = parseArgs(argv);
    if (args.help) return { exitCode: 0, message: USAGE };
    const verb = args.verb!;
    const step = selectStep(verb, args, steps);
    if (!step) return { exitCode: 2, message: `${verb}: no pipeline step declares this command` };
    let root: string | undefined;
    return await dispatch(resolved.step = step, { argv, args, cwd, root: () => root ??= discoverRoot(resolve(cwd, args.root ?? ".")) }, steps);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { exitCode: 2, message: error instanceof CliUsageError ? `${message}\n${USAGE}` : message };
  }
}
