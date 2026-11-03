import { STEPS } from "./steps/index.js";
import type { Step } from "./define.js";
import { portsOverlap } from "./globs.js";
import { PACKAGE_ROOT, stepOptions } from "./options.js";
import type { CliOption } from "./options.js";
import { readSeats } from "./seats.js";
import type { SeatReport } from "./seats.js";

export const GRAPH_SCHEMA = "clossys.pipeline-graph/1";
export const GRAPH_FILE = "pipeline/graph.json";

export interface GraphEdge { readonly from: string; readonly to: string; readonly via: readonly { readonly output: string; readonly input: string }[] }
export interface PipelineGraph {
  readonly schema: typeof GRAPH_SCHEMA;
  readonly rule: "R-PIPELINE-IS-CODE";
  readonly nodes: readonly Step[];
  readonly edges: readonly GraphEdge[];
  readonly seats: Readonly<Record<string, SeatReport>>;
  readonly options: {
    readonly cli: Readonly<Record<string, readonly CliOption[] | null>>;
    /** Workspace config keys, from the config schema. src/config.ts exports no schema yet, so there are none. */
    readonly config: { readonly schema: string | null; readonly keys: readonly string[] };
  };
}

/** Edges are derived, never listed: A feeds B when one of A's outputs overlaps one of B's inputs. */
export function deriveEdges(steps: readonly Step[]): GraphEdge[] {
  const edges: GraphEdge[] = [];
  for (const from of steps) for (const to of steps) {
    if (from.id === to.id) continue;
    const via = from.outputs.flatMap(output => to.inputs.filter(input => portsOverlap(output.glob, input.glob)).map(input => ({ output: output.glob, input: input.glob })));
    if (via.length) edges.push({ from: from.id, to: to.id, via });
  }
  return edges;
}

/**
 * The graph the canvas reads: nodes from the step definitions, derived edges, seats from the
 * workspace's seat files and options from each verb's parser. No hashes or times, so the committed
 * pipeline/graph.json only changes when a definition, parser or seat changes.
 */
export function buildGraph(root: string, steps: readonly Step[] = STEPS, packageRoot = PACKAGE_ROOT): PipelineGraph {
  const cli: Record<string, readonly CliOption[] | null> = {};
  for (const step of steps) if (step.command.cli) cli[step.id] = stepOptions(step, packageRoot);
  return {
    schema: GRAPH_SCHEMA, rule: "R-PIPELINE-IS-CODE",
    nodes: steps, edges: deriveEdges(steps), seats: readSeats(root, steps),
    options: { cli, config: { schema: null, keys: [] } },
  };
}

export const graphJson = (graph: PipelineGraph): string => `${JSON.stringify(graph, null, 2)}\n`;
