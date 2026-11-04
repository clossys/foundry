import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { buildGraph, graphJson } from "../pipeline/graph.js";
import { pipelineStatus } from "../pipeline/status.js";
import type { CliResult } from "./main.js";
import { discoverRoot } from "./root.js";

export const PIPELINE_USAGE = "Usage: clossys pipeline status [--json] [--root <dir>]\n"
  + "       clossys pipeline graph [--json] [--root <dir>] [--out <graph.json>]\n"
  + "status is read-only: per step input/output hashes, last run, checks (never run here) and open decisions; per agent slot counts.\n"
  + "graph prints {nodes, edges, seats, options, status}; --out writes the graph without live status (pipeline/graph.json).";

export interface PipelineArgs { readonly command?: "status" | "graph"; readonly json: boolean; readonly root?: string; readonly out?: string; readonly help: boolean }

export class PipelineUsageError extends Error {}

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
        if (command || (arg !== "status" && arg !== "graph")) throw new PipelineUsageError(`Unknown argument: ${arg}`);
        command = arg;
    }
  }
  if (!command && !help) throw new PipelineUsageError("pipeline requires status or graph");
  if (out !== undefined && command !== "graph") throw new PipelineUsageError("--out requires pipeline graph");
  return { command, json, help, ...(root !== undefined ? { root } : {}), ...(out !== undefined ? { out } : {}) };
}

export async function runPipelineCli(argv: readonly string[], cwd: string): Promise<CliResult> {
  let args: PipelineArgs;
  try { args = parsePipelineArgs(argv); }
  catch (error) { return { exitCode: 2, message: `${error instanceof Error ? error.message : String(error)}\n${PIPELINE_USAGE}` }; }
  if (args.help) return { exitCode: 0, message: PIPELINE_USAGE };
  let root: string;
  try { root = discoverRoot(resolve(cwd, args.root ?? ".")); }
  catch (error) { return { exitCode: 2, message: error instanceof Error ? error.message : String(error) }; }
  const status = pipelineStatus(root);
  if (args.command === "status") {
    const lines = status.steps.map(step => [
      step.id.padEnd(22), step.kind.padEnd(16), step.state.padEnd(8),
      `in=${step.inputs.files ?? "-"}`, `out=${step.outputs.files ?? "-"}`,
      ...(step.seat ? [`seat=${step.seat}`] : []), ...(step.open ? [`open=${step.open.count}`] : []),
    ].join(" "));
    const agents = Object.entries(status.agents).map(([agent, counts]) =>
      `${agent}: ${counts.slots} slots, ${counts.candidates} candidates, ${counts.pinned} pinned, ${counts.notNeeded} not needed, ${counts.open} open`);
    return { exitCode: 0, root, message: [...lines, ...agents, `open decisions: ${status.open}`].join("\n"), output: status };
  }
  const graph = buildGraph(root);
  if (args.out) {
    const file = resolve(cwd, args.out);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, graphJson(graph));
  }
  const output = { ...graph, status };
  return { exitCode: 0, root, message: `pipeline graph: ${graph.nodes.length} steps, ${graph.edges.length} edges${args.out ? `; wrote ${args.out}` : ""}`, output };
}
