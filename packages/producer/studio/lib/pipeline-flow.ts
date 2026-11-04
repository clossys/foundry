/**
 * The pipeline page's section inputs, from graph.json alone (`GET /api/pipeline`). Each step
 * becomes one flow node with graph.json's id and position; each edge keeps its `from->to`
 * identity, the form `check:pipeline` uses. Labels and kind names are Writer keys
 * (studio.pipeline.*); step ids, globs and lanes are data and pass through unchanged.
 * Server-safe: no hooks and no client-only imports.
 */
import type { PipelineFlowInput, StepKind } from '../sections/producer-pipeline-flow';
import type { PipelineHeaderInput } from '../sections/producer-pipeline-header';
import type { PipelineLegendInput } from '../sections/producer-pipeline-legend';
import type { PageHeaderInput } from '../sections/studio-page-header';
import { studioCopy } from './studio-copy';

/** One step as graph.json (`clossys.pipeline-graph/1`) records it; only the fields the page shows. */
export interface PipelineGraphStep {
  id: string;
  kind: StepKind;
  inputs: readonly { glob: string }[];
  outputs: readonly { glob: string }[];
  open: string | null;
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
  layout: { lanes: readonly { id: string }[] };
}

const KINDS: readonly StepKind[] = ['plumb', 'decide:creative', 'decide:judgment'];
/** A kind's Writer key suffix: `decide:creative` is `decide-creative`. */
const kindKey = (kind: StepKind) => kind.replace(':', '-');
/** A lane's Writer key suffix: an agent lane (`agent:designer`) is named by its agent. */
const laneKey = (lane: string) => lane.replace(/^agent:/, '');
const unique = (values: readonly string[]) => [...new Set(values)];

/** The edge identity the page renders and `check:pipeline-canvas` compares: `from->to`. */
export const edgeId = (edge: { from: string; to: string }) => `${edge.from}->${edge.to}`;

/** The shared `header` input: the page head (title, purpose) and the pipeline counts card. */
export type PipelinePageHeader = PageHeaderInput & PipelineHeaderInput;

export interface PipelineInputs { header: PipelinePageHeader; flow: PipelineFlowInput; legend: PipelineLegendInput }

/** The section inputs for one graph.json; `title` and `description` head the page. */
export function pipelineInputs(graph: PipelineGraphFile, head: PageHeaderInput): PipelineInputs {
  const open = graph.nodes.filter(step => step.open).length;
  const header: PipelinePageHeader = {
    ...head,
    copy: {
      title: studioCopy('studio.pipeline.counts.title'),
      description: studioCopy('studio.pipeline.counts', { steps: graph.nodes.length, edges: graph.edges.length, open }),
    },
  };
  const flow: PipelineFlowInput = {
    graph: {
      nodes: graph.nodes.map(step => ({
        id: step.id,
        position: { x: step.layout.x, y: step.layout.y },
        data: { label: step.id, kind: step.kind, lane: step.layout.lane, inputs: unique(step.inputs.map(port => port.glob)), outputs: unique(step.outputs.map(port => port.glob)) },
      })),
      edges: graph.edges.map(edge => ({
        id: edgeId(edge), source: edge.from, target: edge.to,
        ...(edge.via[0] ? { sourceHandle: edge.via[0].output, targetHandle: edge.via[0].input } : {}),
      })),
    },
    copy: {
      label: studioCopy('studio.pipeline.flow-label'),
      kinds: Object.fromEntries(KINDS.map(kind => [kind, studioCopy(`studio.pipeline.kind.${kindKey(kind)}`)])) as Record<StepKind, string>,
      lanes: Object.fromEntries(graph.layout.lanes.map(lane => [lane.id, studioCopy(`studio.pipeline.lane.${laneKey(lane.id)}`)])),
      emptyTitle: studioCopy('studio.pipeline.empty.title'),
      emptyDescription: studioCopy('studio.pipeline.empty.description'),
    },
  };
  const legend: PipelineLegendInput = {
    rows: KINDS.map(kind => ({ kind, label: studioCopy(`studio.pipeline.kind.${kindKey(kind)}`), meaning: studioCopy(`studio.pipeline.legend.${kindKey(kind)}`) })),
    untypedCount: graph.untyped.length,
    copy: {
      title: studioCopy('studio.pipeline.legend.title'),
      kind: studioCopy('studio.pipeline.legend.kind'),
      meaning: studioCopy('studio.pipeline.legend.meaning'),
      untyped: studioCopy('studio.pipeline.legend.untyped', { count: graph.untyped.length }),
    },
  };
  return { header, flow, legend };
}
