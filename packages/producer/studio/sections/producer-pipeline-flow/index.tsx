'use client';
import { Badge, BaseNode, BaseNodeContent, BaseNodeFooter, BaseNodeHeader, BaseNodeHeaderTitle, Card, CardDescription, CardHeader, CardTitle, LabeledHandle, Position, ReactFlow, type Edge, type Node, type NodeProps } from '@clossys/designer-ui';

/** The node kinds a pipeline step carries; graph.json names one per step. */
export type StepKind = 'plumb' | 'decide:creative' | 'decide:judgment';

/** A step node's data as graph.json records it. Positions are graph.json's; this section computes no layout. */
export interface StepData {
  [key: string]: unknown;
  label: string;
  kind: StepKind;
  lane: string;
  inputs: readonly string[];
  outputs: readonly string[];
}

/** graph.json: the pipeline steps with their positions, and the edges between their handles. */
export interface PipelineGraph { nodes: readonly Node<StepData>[]; edges: readonly Edge[] }

/** Writer copy of the flow (studio.pipeline.kind.*, studio.pipeline.lane.*, studio.pipeline.empty.*). */
export interface PipelineFlowCopy {
  label: string;
  kinds: Readonly<Record<StepKind, string>>;
  lanes: Readonly<Record<string, string>>;
  emptyTitle: string;
  emptyDescription: string;
}

/** The `flow` input of `sections.producer.pipeline-flow`. */
export interface PipelineFlowInput { graph: PipelineGraph; copy: PipelineFlowCopy }

type StepNodeData = StepData & { kindLabel: string; laneLabel: string };

/** Each kind's stock Badge variant; the legend uses the same mapping. */
const KIND_VARIANT = { plumb: 'outline', 'decide:creative': 'secondary', 'decide:judgment': 'default' } as const;

/** One step: stock React Flow UI BaseNode with its header, one LabeledHandle per input and output, and its lane. */
function StepNode({ data }: NodeProps<Node<StepNodeData, 'step'>>) {
  return <BaseNode>
    <BaseNodeHeader>
      <BaseNodeHeaderTitle>{data.label}</BaseNodeHeaderTitle>
      <Badge variant={KIND_VARIANT[data.kind]}>{data.kindLabel}</Badge>
    </BaseNodeHeader>
    <BaseNodeContent>
      {data.inputs.map(id => <LabeledHandle key={`in:${id}`} id={id} title={id} type="target" position={Position.Left} />)}
      {data.outputs.map(id => <LabeledHandle key={`out:${id}`} id={id} title={id} type="source" position={Position.Right} />)}
    </BaseNodeContent>
    <BaseNodeFooter>
      <Badge variant="ghost">{data.laneLabel}</Badge>
    </BaseNodeFooter>
  </BaseNode>;
}

const NODE_TYPES = { step: StepNode };
const EDGE_OPTIONS = { type: 'smoothstep' };

/** `sections.producer.pipeline-flow`: graph.json rendered by @xyflow/react with components.flow.* nodes and the built-in smoothstep edge; its --xy-* theme is the generated studio-flow-theme.css, not a mapping here. */
export default function PipelineFlowSection({ flow, onSelect, ...provenance }: { flow: PipelineFlowInput; onSelect?: (step: string) => void } & { [marker: `data-clossys-${string}`]: string }) {
  const { graph, copy } = flow;
  if (!graph.nodes.length) return <Card size="sm" {...provenance}>
    <CardHeader>
      <CardTitle role="heading" aria-level={2}>{copy.emptyTitle}</CardTitle>
      <CardDescription>{copy.emptyDescription}</CardDescription>
    </CardHeader>
  </Card>;
  const nodes = graph.nodes.map(node => ({ ...node, type: 'step', data: { ...node.data, kindLabel: copy.kinds[node.data.kind], laneLabel: copy.lanes[node.data.lane] ?? node.data.lane } }));
  return <ReactFlow {...provenance} aria-label={copy.label} nodes={nodes} edges={[...graph.edges]} nodeTypes={NODE_TYPES} defaultEdgeOptions={EDGE_OPTIONS}
    nodesDraggable={false} nodesConnectable={false} fitView onNodeClick={(_, node) => onSelect?.(node.id)} />;
}
