import { STEPS } from "./steps/index.js";
import type { Step } from "./define.js";
import { portsOverlap } from "./globs.js";
import { PACKAGE_ROOT, stepOptions } from "./options.js";
import type { CliOption } from "./options.js";
import { computeLayout } from "./layout.js";
import type { NodeLayout, PipelineLayout } from "./layout.js";
import { readSeats } from "./seats.js";
import type { SeatReport } from "./seats.js";

export const GRAPH_SCHEMA = "clossys.pipeline-graph/1";
export const GRAPH_FILE = "pipeline/graph.json";

export interface GraphEdge { readonly from: string; readonly to: string; readonly via: readonly { readonly output: string; readonly input: string; readonly schema: string }[] }
/** A port that names no schema: it feeds no edge, and the graph lists it instead of dropping it. */
export interface UntypedPort { readonly step: string; readonly port: "input" | "output"; readonly glob: string }
/** An output and an input whose globs overlap but whose schemas differ: a broken contract. */
export interface SchemaMismatch { readonly from: string; readonly to: string; readonly output: string; readonly input: string; readonly outputSchema: string; readonly inputSchema: string }
export type GraphNode = Step & { readonly layout: NodeLayout };
export interface PipelineGraph {
  readonly schema: typeof GRAPH_SCHEMA;
  readonly rule: "R-PIPELINE-IS-CODE";
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly GraphEdge[];
  readonly untyped: readonly UntypedPort[];
  readonly layout: Omit<PipelineLayout, "nodes">;
  readonly seats: Readonly<Record<string, SeatReport>>;
  readonly options: {
    readonly cli: Readonly<Record<string, readonly CliOption[] | null>>;
    /** Workspace config keys, from the config schema. src/config.ts exports no schema yet, so there are none. */
    readonly config: { readonly schema: string | null; readonly keys: readonly string[] };
  };
}

/**
 * Edges are derived, never listed: A feeds B only when an output of A and an input of B name the
 * same JSON schema and their globs overlap. A port without a schema feeds no edge (see untypedPorts).
 */
export function deriveEdges(steps: readonly Step[]): GraphEdge[] {
  const edges: GraphEdge[] = [];
  for (const from of steps) for (const to of steps) {
    if (from.id === to.id) continue;
    const via = from.outputs.flatMap(output => output.schema === undefined ? [] : to.inputs
      .filter(input => input.schema === output.schema && portsOverlap(output.glob, input.glob))
      .map(input => ({ output: output.glob, input: input.glob, schema: output.schema! })));
    if (via.length) edges.push({ from: from.id, to: to.id, via });
  }
  return edges;
}

/** Every workspace port (not a caller-chosen `arg:` path) that names no schema, in step order. */
export function untypedPorts(steps: readonly Step[]): UntypedPort[] {
  return steps.flatMap(step => [
    ...step.inputs.filter(port => port.schema === undefined && !port.glob.startsWith("arg:")).map(port => ({ step: step.id, port: "input" as const, glob: port.glob })),
    ...step.outputs.filter(port => port.schema === undefined && !port.glob.startsWith("arg:")).map(port => ({ step: step.id, port: "output" as const, glob: port.glob })),
  ]);
}

/** Typed output/input pairs whose globs overlap but whose schemas differ. */
export function schemaMismatches(steps: readonly Step[]): SchemaMismatch[] {
  const out: SchemaMismatch[] = [];
  for (const from of steps) for (const to of steps) {
    if (from.id === to.id) continue;
    for (const output of from.outputs) for (const input of to.inputs) {
      if (output.schema === undefined || input.schema === undefined || output.schema === input.schema) continue;
      if (portsOverlap(output.glob, input.glob)) out.push({ from: from.id, to: to.id, output: output.glob, input: input.glob, outputSchema: output.schema, inputSchema: input.schema });
    }
  }
  return out;
}

/**
 * The graph the canvas reads: nodes from the step definitions, derived edges, seats from the
 * workspace's seat files and options from each verb's parser. No hashes or times, so the committed
 * pipeline/graph.json only changes when a definition, parser or seat changes.
 */
export function buildGraph(root: string, steps: readonly Step[] = STEPS, packageRoot = PACKAGE_ROOT): PipelineGraph {
  const cli: Record<string, readonly CliOption[] | null> = {};
  for (const step of steps) if (step.command.cli) cli[step.id] = stepOptions(step, packageRoot);
  const edges = deriveEdges(steps);
  const { nodes: positions, ...layout } = computeLayout(steps, edges);
  return {
    schema: GRAPH_SCHEMA, rule: "R-PIPELINE-IS-CODE",
    nodes: steps.map(step => ({ ...step, layout: positions[step.id]! })), edges, untyped: untypedPorts(steps), layout, seats: readSeats(root, steps),
    options: { cli, config: { schema: null, keys: [] } },
  };
}

export const graphJson = (graph: PipelineGraph): string => `${JSON.stringify(graph, null, 2)}\n`;
