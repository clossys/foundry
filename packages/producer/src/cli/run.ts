/**
 * `clossys run`: the chain in pipeline order (src/pipeline/chain.ts). Not a step: it records nothing
 * itself; every plumb step it runs records its own run.
 *
 *   clossys run [--from <step>] [--until <step>] [--dry] [--capture] [--json] [--root <dir>]
 *   clossys run --explain [--dry] [--capture] [--json] [--root <dir>]
 *
 * Capture is on demand (W2-G): the chain skips it unless --capture asks for it (before an owner
 * preview or a landing); --explain lists it as `on demand --capture`.
 *
 * Exit 0 when the chain ran to its end or stopped at an open decide step (printed with its packet),
 * 1 when a plumb step failed (its failed run record cited), 2 when it could not run.
 *
 * Loop mode (system.md 14.5): `clossys run loop.<fill|refine|create|choose|scope|slot|release|audit|cascade> ...` runs a Producer loop version one
 * step at a time and writes one ledger entry per run (src/loop/cli.ts). Any other argv is the chain mode above,
 * unchanged until the stage verbs retire.
 */
import { resolve } from "node:path";
import { explainChain, runChain } from "../pipeline/chain.js";
import type { ChainResult, Exec, Explain } from "../pipeline/chain.js";
import type { Step } from "../pipeline/define.js";
import { PACKAGE_ROOT } from "../pipeline/options.js";
import { STEPS } from "../pipeline/steps/index.js";
import { CliUsageError } from "./args.js";
import type { CliResult } from "./main.js";
import { discoverRoot } from "./root.js";

export const RUN_USAGE = "Usage: clossys run [--from <step>] [--until <step>] [--dry] [--capture] [--json] [--root <dir>]\n"
  + "       clossys run --explain [--dry] [--capture] [--json] [--root <dir>]\n"
  + "  Walks every step in pipeline order: a plumb step whose last run is fresh is skipped, any other runs its command;\n"
  + "  the walk stops red at a failed plumb step and stops at the first decide step with open work (clossys next prints it).\n"
  + "  --dry: run nothing; list what would run.  --explain: the whole graph as a table (step, agent, kind, decider, chain, last run); it runs nothing.\n"
  + "  --capture: also run the on-demand capture step (before an owner preview or a landing); without it the chain skips capture.\n"
  + "       clossys run loop.<fill|refine|create|choose|scope|slot|release|audit|cascade> [--slot <ref>] [--request <id>] [--from <entry>] [--publication <id>] [--resume] ...\n"
  + "  Loop mode: runs a Producer loop version step by step, one ledger entry per run (clossys run loop.fill --help).";

interface Flags { from?: string; until?: string; dry: boolean; explain: boolean; capture: boolean; json: boolean; help: boolean; root?: string }
function parse(argv: readonly string[]): Flags {
  const flags: Flags = { dry: false, explain: false, capture: false, json: false, help: false };
  const value = (index: number, name: string): string => {
    const next = argv[index];
    if (next === undefined || next.startsWith("--")) throw new CliUsageError(`${name} requires a value\n${RUN_USAGE}`);
    return next;
  };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]!;
    if (arg === "--json") flags.json = true;
    else if (arg === "--help") flags.help = true;
    else if (arg === "--dry") flags.dry = true;
    else if (arg === "--explain") flags.explain = true;
    else if (arg === "--capture") flags.capture = true;
    else if (arg === "--from") flags.from = value(++index, "--from");
    else if (arg === "--until") flags.until = value(++index, "--until");
    else if (arg === "--root") flags.root = value(++index, "--root");
    else throw new CliUsageError(`Unknown argument: ${arg}\n${RUN_USAGE}`);
  }
  return flags;
}

const pad = (text: string, width: number) => text.length >= width ? text : text + " ".repeat(width - text.length);
function table(rows: readonly (readonly string[])[]): string {
  const widths = rows[0]!.map((_, column) => Math.max(...rows.map(row => row[column]!.length)));
  return rows.map(row => row.map((cell, column) => column === row.length - 1 ? cell : pad(cell, widths[column]!)).join("  ")).join("\n");
}

export function formatExplain(explain: Explain): string {
  const rows = [["step", "agent", "kind", "decider", "chain", "last run", "open"], ...explain.rows.map(row => [row.step, row.agent, row.kind, row.decider, row.chain, row.last, row.kind === "plumb" ? "-" : String(row.open)])];
  const counts = Object.entries(explain.counts).map(([kind, count]) => `${kind} ${count}`).join(", ");
  return `${table(rows)}\n\n${explain.rows.length} steps: ${counts}`;
}

export function formatChain(result: ChainResult): string {
  const rows = [["#", "step", "kind", "state", "detail"], ...result.rows.map((row, index) => [String(index + 1), row.step, row.kind, row.state, row.detail])];
  const lines = [table(rows), ""];
  if (result.failed) lines.push(`run: stopped red at ${result.failed.step} (exit ${result.failed.exit})${result.failed.store ? `; failed record ${result.failed.store}` : ""}`);
  else if (result.stop) lines.push(`run: stopped at ${result.stop.step}: ${result.stop.open} open, decided by ${result.stop.decider}`, `  next: ${result.stop.packet.question}`, `  record with: ${result.stop.packet.record}`, ...(result.stop.packet.ask ? [`  ask the owner: ${result.stop.packet.ask.argv.join(" ")} (the ${result.stop.packet.ask.agent} round; read ${result.stop.packet.ask.skill})`] : []), "  clossys next --json prints the full packet");
  else lines.push(`run: ${result.dry ? "nothing open; the steps marked would-run run without --dry" : "the chain ran to its end"}`);
  if (result.stale.length) {
    lines.push(`stale (an input changed since the last run): ${result.stale.length}`);
    for (const entry of result.stale) lines.push(`  ${entry.step}: ${entry.changed.slice(0, 4).join(", ")}${entry.changed.length > 4 ? `, +${entry.changed.length - 4}` : ""}`);
  }
  return lines.join("\n");
}

export async function runRunCli(argv: readonly string[], cwd: string, steps: readonly Step[] = STEPS, options: { packageRoot?: string; exec?: Exec } = {}): Promise<CliResult> {
  if (argv[0]?.startsWith("loop.")) return (await import("../loop/cli.js")).runLoopCli(argv, cwd);
  const flags = parse(argv);
  if (flags.help) return { exitCode: 0, message: RUN_USAGE };
  const root = discoverRoot(resolve(cwd, flags.root ?? "."));
  const packageRoot = options.packageRoot ?? PACKAGE_ROOT;
  if (flags.explain) {
    // --explain runs nothing, so --dry changes nothing; --capture shows capture as the run would treat it.
    if (flags.from || flags.until) throw new CliUsageError(`--explain takes no --from or --until\n${RUN_USAGE}`);
    const explain = explainChain(root, { steps, packageRoot, ...(flags.capture ? { demand: ["--capture"] } : {}) });
    return { exitCode: 0, root, output: explain, message: formatExplain(explain) };
  }
  let result: ChainResult;
  try { result = runChain(root, { steps, packageRoot, dry: flags.dry, ...(flags.capture ? { demand: ["--capture"] } : {}), ...(flags.from ? { from: flags.from } : {}), ...(flags.until ? { until: flags.until } : {}), ...(options.exec ? { exec: options.exec } : {}) }); }
  catch (error) { return { exitCode: 2, root, message: `run: ${error instanceof Error ? error.message : String(error)}` }; }
  return { exitCode: result.failed ? 1 : 0, root, output: result, message: formatChain(result) };
}
