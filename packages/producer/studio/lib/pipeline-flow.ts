/**
 * The pipeline page's section inputs, from graph.json alone (`GET /api/pipeline`). Each step
 * becomes one flow node with graph.json's id and position; each edge keeps its `from->to`
 * identity, the form `check:pipeline` uses. Labels and kind names are Writer keys
 * (studio.pipeline.*); step ids, globs and lanes are data and pass through unchanged.
 * Server-safe: no hooks and no client-only imports.
 */
import type { PipelineFlowInput, StepKind, StepStatus } from '../sections/producer-pipeline-flow';
import type { PipelineLegendInput } from '../sections/producer-pipeline-legend';
import type { PageHeaderInput } from '../sections/studio-page-header';
import { studioCopy } from './studio-copy';

/** One step as graph.json (`clossys.pipeline-graph/1`) records it; only the fields the page shows. */
export interface PipelineGraphStep {
  id: string;
  kind: StepKind;
  inputs: readonly { glob: string }[];
  outputs: readonly { glob: string }[];
  command: Readonly<Record<string, unknown>>;
  open: string | null;
  pending?: unknown;
  layout: { lane: string; x: number; y: number };
}
/** One edge: the step that writes a file and the step that reads it. */
export interface PipelineGraphEdge { from: string; to: string; via: readonly { output: string; input: string }[] }
/** graph.json as Producer serves it. */
export interface PipelineGraphFile {
  schema: 'clossys.pipeline-graph/1';
  nodes: readonly PipelineGraphStep[];
  edges: readonly PipelineGraphEdge[];
  untyped: readonly unknown[];
  layout: { constants: { nodeWidth: number }; lanes: readonly { id: string; x: number; y: number }[] };
  seats?: Readonly<Record<string, { by: string | null }>>;
  options?: { cli?: Readonly<Record<string, readonly { flag: string }[]>> };
}

const KINDS: readonly StepKind[] = ['plumb', 'decide:creative', 'decide:judgment'];
/** A kind's Writer key suffix: `decide:creative` is `decide-creative`. */
const kindKey = (kind: StepKind) => kind.replace(':', '-');
/** A lane's Writer key suffix: an agent lane (`agent:designer`) is named by its agent. */
const laneKey = (lane: string) => lane.replace(/^agent:/, '');
const unique = (values: readonly string[]) => [...new Set(values)];
const words = (value: unknown): string[] => typeof value === 'string' ? [value] : Array.isArray(value) ? value.flatMap(words) : value && typeof value === 'object' ? Object.values(value).flatMap(words) : [];
/** A step's command as graph.json records it, one `<form> <value>` part per field (`cli compile`, `entry src/cli/compile.ts#runCompileCli`). */
export const commandLine = (command: Readonly<Record<string, unknown>>) => Object.entries(command).map(([form, value]) => [form, ...words(value)].join(' ')).join('; ');
/** A step's state as `clossys pipeline status` names it from graph.json alone: pending until its step is declared, otherwise ready. */
const stepStatus = (step: PipelineGraphStep): StepStatus => step.pending ? 'pending' : 'ready';
const STATUSES: readonly StepStatus[] = ['ready', 'pending'];

/** The edge identity the page renders and `check:pipeline-canvas` compares: `from->to`. */
export const edgeId = (edge: { from: string; to: string }) => `${edge.from}->${edge.to}`;

/** The section inputs: the page head (title, purpose), the flow, and the counts and legend row. */
export interface PipelineInputs { header: PageHeaderInput; flow: PipelineFlowInput; legend: PipelineLegendInput }

/** The section inputs for one graph.json; `title` and `description` head the page. */
export function pipelineInputs(graph: PipelineGraphFile, head: PageHeaderInput): PipelineInputs {
  const open = graph.nodes.filter(step => step.open).length;
  const flow: PipelineFlowInput = {
    graph: {
      nodes: graph.nodes.map(step => ({
        id: step.id,
        position: { x: step.layout.x, y: step.layout.y },
        width: graph.layout.constants.nodeWidth,
        data: {
          label: step.id, kind: step.kind, lane: step.layout.lane,
          facts: {
            command: commandLine(step.command),
            inputs: unique(step.inputs.map(port => port.glob)),
            outputs: unique(step.outputs.map(port => port.glob)),
            options: (graph.options?.cli?.[step.id] ?? []).map(option => option.flag),
            seat: graph.seats?.[step.id]?.by ?? null,
            status: stepStatus(step),
          },
        },
      })),
      // One handle per side: every edge leaves its writer's right handle and enters its reader's left handle.
      edges: graph.edges.map(edge => ({ id: edgeId(edge), source: edge.from, target: edge.to, sourceHandle: 'out', targetHandle: 'in' })),
      lanes: graph.layout.lanes.map(lane => ({ id: lane.id, position: { x: lane.x, y: lane.y } })),
    },
    copy: {
      label: studioCopy('studio.pipeline.flow-label'),
      kinds: Object.fromEntries(KINDS.map(kind => [kind, studioCopy(`studio.pipeline.kind.${kindKey(kind)}`)])) as Record<StepKind, string>,
      lanes: Object.fromEntries(graph.layout.lanes.map(lane => [lane.id, studioCopy(`studio.pipeline.lane.${laneKey(lane.id)}`)])),
      emptyTitle: studioCopy('studio.pipeline.empty.title'),
      emptyDescription: studioCopy('studio.pipeline.empty.description'),
      command: studioCopy('studio.pipeline.step.command'),
      inputs: studioCopy('studio.pipeline.step.inputs'),
      outputs: studioCopy('studio.pipeline.step.outputs'),
      options: studioCopy('studio.pipeline.step.options'),
      seat: studioCopy('studio.pipeline.step.seat'),
      status: studioCopy('studio.pipeline.step.status'),
      none: studioCopy('studio.pipeline.step.none'),
      openSeat: studioCopy('studio.pipeline.seat.open'),
      statuses: Object.fromEntries(STATUSES.map(status => [status, studioCopy(`studio.pipeline.status.${status}`)])) as Record<StepStatus, string>,
    },
  };
  const legend: PipelineLegendInput = {
    rows: KINDS.map(kind => ({ kind, label: studioCopy(`studio.pipeline.kind.${kindKey(kind)}`), meaning: studioCopy(`studio.pipeline.legend.${kindKey(kind)}`) })),
    untypedCount: graph.untyped.length,
    copy: {
      title: studioCopy('studio.pipeline.counts.title'),
      counts: studioCopy('studio.pipeline.counts', { steps: graph.nodes.length, edges: graph.edges.length, open }),
      legend: studioCopy('studio.pipeline.legend.title'),
      untyped: studioCopy('studio.pipeline.legend.untyped', { count: graph.untyped.length }),
    },
  };
  return { header: head, flow, legend };
}
