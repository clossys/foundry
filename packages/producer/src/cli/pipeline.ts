import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildGraph, graphJson } from "../pipeline/graph.js";
import { PACKAGE_ROOT } from "../pipeline/options.js";
import { pipelineStatus } from "../pipeline/status.js";
import { appendRecord, buildRecord, invocationOf, readRuns, readSink, RUNS_DIR, sanitizeArgv, SINK_ENV, storeFile } from "../pipeline/trace.js";
import { ownerWiringIssues } from "../pipeline/owner-wiring.js";
import { buildWiring, wiringCitationIssues } from "../pipeline/wiring.js";
import type { CliResult } from "./main.js";
import { discoverRoot } from "./root.js";

export const PIPELINE_USAGE = "Usage: clossys pipeline status [--json] [--root <dir>]\n"
  + "       clossys pipeline wiring [--json] [--root <dir>]\n"
  + "       clossys pipeline check [--json] [--root <dir>]\n"
  + "       clossys pipeline graph [--json] [--root <dir>] [--out <graph.json>]\n"
  + "       clossys pipeline trace <step | check:<id>> -- <command> [args]\n"
  + "status prints each step's state from its latest run record (passed, failed, stale, never-run) with the record it cites, and the open decisions.\n"
  + "wiring prints what the pipeline page draws: the steps that exist and ran, the edges their runs read and wrote, the computed layout.\n"
  + "check exits 1 when a status the pipeline page shows cites no run record, a Studio section contract shows a status with no citation field,\n"
  + "  or an owner option of clossys next --owner, run on a scratch copy of the records, exits non-zero, changes no record or leaves the gaps unchanged (owner.wiring).\n"
  + "graph prints the declared step graph {nodes, edges, untyped, layout, seats, roster, options, status}; --out writes it without live status (pipeline/graph.json).\n"
  + "trace runs a command (a script step or a check) with its file reads and writes observed and appends its run record to .clossys/runs.";

type Command = "status" | "graph" | "wiring" | "check";
export interface PipelineArgs { readonly command?: Command; readonly json: boolean; readonly root?: string; readonly out?: string; readonly help: boolean }

export class PipelineUsageError extends Error {}

const COMMANDS: readonly Command[] = ["status", "graph", "wiring", "check"];

export function parsePipelineArgs(argv: readonly string[]): PipelineArgs {
  let command: PipelineArgs["command"], json = false, help = false, root: string | undefined, out: string | undefined;
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]!;
    const value = (): string => {
      const next = argv[++index];
      if (!next || next.startsWith("--")) throw new PipelineUsageError(`${arg} requires a value`);
      return next;
    };
    switch (arg) {
      case "--json": json = true; break;
      case "--help": help = true; break;
      case "--root": root = value(); break;
      case "--out": out = value(); break;
      default:
        if (command || !(COMMANDS as readonly string[]).includes(arg)) throw new PipelineUsageError(`Unknown argument: ${arg}`);
        command = arg as Command;
    }
  }
  if (!command && !help) throw new PipelineUsageError("pipeline requires status, wiring, check, graph or trace");
  if (out !== undefined && command !== "graph") throw new PipelineUsageError("--out requires pipeline graph");
  return { command, json, help, ...(root !== undefined ? { root } : {}), ...(out !== undefined ? { out } : {}) };
}

/** Each exported type declaration in a section's source: its name and its text (interface body, or type alias up to its `;`). */
function typeDeclarations(source: string): { name: string; text: string }[] {
  const out: { name: string; text: string }[] = [];
  for (const match of source.matchAll(/^export\s+(interface|type)\s+(\w+)/gm)) {
    let depth = 0, index = match.index! + match[0].length, opened = false;
    for (; index < source.length; index++) {
      const char = source[index]!;
      if (char === "{" || char === "(") { depth++; opened = true; }
      else if (char === "}" || char === ")") { depth--; if (match[1] === "interface" && opened && depth === 0) { index++; break; } }
      else if (char === ";" && depth === 0 && match[1] === "type") break;
    }
    out.push({ name: match[2]!, text: source.slice(match.index!, index) });
  }
  return out;
}

/** The fields declared directly in the object type that encloses `at` (nested object types left out). */
function siblingFields(text: string, at: number): string[] {
  let depth = 0, open = -1;
  for (let index = at; index >= 0; index--) {
    const char = text[index]!;
    if (char === "}") depth++;
    else if (char === "{") { if (depth === 0) { open = index; break; } depth--; }
  }
  if (open < 0) return [];
  const fields: string[] = [];
  depth = 0;
  for (let index = open + 1; index < text.length; index++) {
    const char = text[index]!;
    if (char === "{" || char === "(" || char === "[" || char === "<") depth++;
    else if (char === "}" || char === ")" || char === "]" || char === ">") { if (depth === 0) break; depth--; }
    else if (depth === 0) {
      const field = /^(\w+)\??\s*:/.exec(text.slice(index));
      if (field && !/\w/.test(text[index - 1] ?? "")) { fields.push(field[1]!); index += field[0].length - 1; }
    }
  }
  return fields;
}

/**
 * Studio section and frame contracts that show a status: every object type with a `status…` field
 * must carry a `citation` field beside it, so the page can cite the run record or check result the
 * status comes from (and show "not run" without one). Copy contracts (`…Copy`) hold Writer strings
 * that name statuses, not statuses, and are not scanned.
 */
export function uncitedStatusFields(packageRoot = PACKAGE_ROOT): string[] {
  const issues: string[] = [];
  for (const layer of ["sections", "frames"]) {
    const dir = join(packageRoot, "studio", layer);
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir).sort()) {
      const file = join(dir, name, "index.tsx");
      if (!existsSync(file)) continue;
      for (const declaration of typeDeclarations(readFileSync(file, "utf8"))) {
        if (declaration.name.endsWith("Copy")) continue;
        const uncited = new Set<string>();
        for (const field of declaration.text.matchAll(/(?<![\w.'"])(status\w*)\??\s*:/g)) {
          if (!siblingFields(declaration.text, field.index!).includes("citation")) uncited.add(field[1]!);
        }
        if (uncited.size) issues.push(`studio/${layer}/${name}: ${declaration.name} shows ${[...uncited].join(", ")} with no citation field`);
      }
    }
  }
  return issues;
}

/** `clossys pipeline trace <step> -- <command>`: run it observed (trace-preload.js) and record the run. */
function runTrace(argv: readonly string[], cwd: string): CliResult {
  const split = argv.indexOf("--");
  const [id, ...extra] = split < 0 ? argv : argv.slice(0, split);
  const command = split < 0 ? [] : argv.slice(split + 1);
  if (!id || extra.length || !command.length) return { exitCode: 2, message: `pipeline trace needs a step id, then -- and the command\n${PIPELINE_USAGE}` };
  let root: string;
  try { root = discoverRoot(cwd); } catch (error) { return { exitCode: 2, message: error instanceof Error ? error.message : String(error) }; }
  const graph = buildGraph(root);
  const known = id.startsWith("check:") ? graph.nodes.some(node => node.checks.includes(id.slice("check:".length))) : graph.nodes.some(node => node.id === id);
  if (!known) return { exitCode: 2, message: `pipeline trace: ${id} is neither a step in the graph nor check:<id> of a check a step names` };
  const sink = join(tmpdir(), `clossys-trace-${process.pid}-${Date.now()}.jsonl`);
  const preload = pathToFileURL(tracePreload()).href;
  const start = new Date();
  const child = spawnSync(command[0]!, command.slice(1), {
    cwd, stdio: "inherit",
    env: { ...process.env, NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --import ${preload}`.trim(), [SINK_ENV]: sink },
  });
  const end = new Date();
  const observation = readSink(sink);
  try { unlinkSync(sink); } catch { /* the child wrote no observation */ }
  const exit = child.status ?? (child.error ? 127 : 1);
  const record = appendRecord(root, buildRecord({ root, step: id, invocation: invocationOf(sanitizeArgv(root, command, cwd)), argv: sanitizeArgv(root, command, cwd), start, end, exit, observation }));
  // Asked to record, but the workspace does not ignore the store: say so, never write into its tree.
  if (!record) return { exitCode: 2, root, message: `pipeline trace: ${id} exited ${exit}; not recorded: ${root}/.gitignore does not ignore /${RUNS_DIR}/ (add that line to keep local run records)` };
  return {
    exitCode: exit === 0 ? 0 : exit === 1 ? 1 : 2, root,
    message: `pipeline trace: ${id} exited ${exit}${child.error ? ` (${child.error.message})` : ""}; recorded ${record.store}:${record.line} (${record.record.reads.length} reads, ${record.record.writes.length} writes)`,
    output: record,
  };
}

export async function runPipelineCli(argv: readonly string[], cwd: string): Promise<CliResult> {
  if (argv[0] === "trace") return runTrace(argv.slice(1), cwd);
  let args: PipelineArgs;
  try { args = parsePipelineArgs(argv); }
  catch (error) { return { exitCode: 2, message: `${error instanceof Error ? error.message : String(error)}\n${PIPELINE_USAGE}` }; }
  if (args.help) return { exitCode: 0, message: PIPELINE_USAGE };
  let root: string;
  try { root = discoverRoot(resolve(cwd, args.root ?? ".")); }
  catch (error) { return { exitCode: 2, message: error instanceof Error ? error.message : String(error) }; }
  if (args.command === "wiring") {
    const wiring = buildWiring(root);
    return { exitCode: 0, root, message: `pipeline wiring: ${wiring.nodes.length} steps, ${wiring.edges.length} observed edges, ${wiring.counts.runs} run records; ${wiring.undrawn.length} declared steps not drawn`, output: wiring };
  }
  if (args.command === "check") {
    const runs = readRuns(root);
    const wiring = buildWiring(root, { runs });
    const page = wiringCitationIssues(root, wiring, runs);
    const contracts = uncitedStatusFields();
    // owner.wiring: every emitted owner option, run on a scratch copy of the records, records what the gaps see.
    const { runCli } = await import("./main.js");
    const owner = await ownerWiringIssues(root, { run: runCli });
    const issues = [...page.map(issue => `pipeline page: ${issue}`), ...contracts, ...owner.issues.map(issue => `${issue.rule}: ${issue.message}`)];
    const ownerLine = `owner.wiring: ${owner.options} owner options (${owner.calls} calls) run on a scratch copy`;
    return {
      exitCode: issues.length ? 1 : 0, root, output: { page, contracts, owner },
      message: issues.length ? [`pipeline check: ${issues.length} finding(s)`, ...issues.map(issue => `  ${issue}`), ownerLine].join("\n")
        : `pipeline check: every status cites its run record (${wiring.nodes.length} steps, ${runs.length} records); ${ownerLine}, each live`,
    };
  }
  const status = pipelineStatus(root);
  if (args.command === "status") {
    const lines = status.steps.map(step => [
      step.id.padEnd(34), step.kind.padEnd(16), step.state.padEnd(10),
      step.citation ? `${step.citation.store}:${step.citation.line} exit=${step.citation.exit} at ${step.citation.end}` : `no run record (${storeFile(step.step)})`,
      ...(step.changedCount ? [`changed=${step.changedCount}`] : []),
    ].join(" "));
    const undrawn = status.undrawn.map(row => `not drawn: ${row.step} (${row.reason})`);
    const decisions = status.decisions.map(row => `${row.step}: ${row.counter} ${row.count}`);
    const agents = Object.entries(status.agents).map(([agent, counts]) =>
      `${agent}: ${counts.slots} slots, ${counts.candidates} candidates, ${counts.pinned} pinned, ${counts.notNeeded} not needed, ${counts.open} open`);
    const counts = `runs: ${status.counts.runs} records; ${status.counts.passed} passed, ${status.counts.failed} failed, ${status.counts.stale} stale, ${status.counts["never-run"]} never run`;
    return { exitCode: 0, root, message: [...lines, ...undrawn, counts, ...decisions, ...agents, `open decisions: ${status.open} (${status.openParts.slots} undecided slots + ${status.openParts.seats} open seats)`].join("\n"), output: status };
  }
  const graph = buildGraph(root);
  if (args.out) {
    const file = resolve(cwd, args.out);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, graphJson(graph));
  }
  const output = { ...graph, status };
  return { exitCode: 0, root, message: `pipeline graph: ${graph.nodes.length} steps, ${graph.edges.length} edges, ${graph.untyped.length} untyped ports, ${graph.layout.cycleBreaks.length} cycle breaks${args.out ? `; wrote ${args.out}` : ""}`, output };
}

/**
 * The preload a traced child imports: the compiled trace-preload.js beside this module, or the
 * package's dist copy when this module runs from source (vitest), since a child process cannot
 * import the TypeScript source with its `.js` specifiers.
 */
export function tracePreload(): string {
  const beside = fileURLToPath(new URL("../pipeline/trace-preload.js", import.meta.url));
  return existsSync(beside) ? beside : join(PACKAGE_ROOT, "dist", "pipeline", "trace-preload.js");
}
