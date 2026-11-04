'use client';
import { Badge, BaseNode, BaseNodeContent, BaseNodeHeader, BaseNodeHeaderTitle, Button, Card, CardDescription, CardHeader, CardTitle, LabeledHandle, Position, ReactFlow, Sheet, SheetDescription, SheetHeader, SheetTitle, SheetTrigger, SmoothStepEdge, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, type Edge, type Node, type NodeProps } from '@clossys/designer-ui';

/** The node kinds a pipeline step carries; graph.json names one per step. */
export type StepKind = 'plumb' | 'decide:creative' | 'decide:judgment';

/** One step's facts as graph.json records them; the step sheet shows them, the node shows only counts. */
export interface StepFacts {
  command: string;
  inputs: readonly string[];
  outputs: readonly string[];
  options: readonly string[];
  /** The seat holder, or null for an open seat. */
  seat: string | null;
  status: string;
}

/** A step node's data. Positions are graph.json's; this section computes no layout. */
export interface StepData {
  [key: string]: unknown;
  label: string;
  kind: StepKind;
  lane: string;
  facts: StepFacts;
}

/** One swim row: its lane id and the position graph.json gives its label. */
export interface PipelineLane { id: string; position: { x: number; y: number } }

/** graph.json: the steps with their positions, the lanes, and the edges between steps. */
export interface PipelineGraph { nodes: readonly Node<StepData>[]; edges: readonly Edge[]; lanes: readonly PipelineLane[] }

/** Writer copy of the flow and its step sheet (studio.pipeline.*). */
export interface PipelineFlowCopy {
  label: string;
  kinds: Readonly<Record<StepKind, string>>;
  lanes: Readonly<Record<string, string>>;
  emptyTitle: string;
  emptyDescription: string;
  field: string;
  value: string;
  command: string;
  inputs: string;
  outputs: string;
  options: string;
  seat: string;
  status: string;
  none: string;
  openSeat: string;
}

/** The `flow` input of `sections.producer.pipeline-flow`. */
export interface PipelineFlowInput { graph: PipelineGraph; copy: PipelineFlowCopy }

type StepNodeData = StepData & { kindLabel: string; inputsLabel: string; outputsLabel: string; copy: PipelineFlowCopy };
type LaneNodeData = { [key: string]: unknown; label: string };

/** Each kind's stock Badge variant; the legend uses the same mapping. */
const KIND_VARIANT = { plumb: 'outline', 'decide:creative': 'secondary', 'decide:judgment': 'default' } as const;

/** One step: stock React Flow UI BaseNode with its title, kind and one labeled handle per side carrying the port count. The title is the stock SheetTrigger button that opens the step's sheet; the open state lives in that trigger. */
function StepNode({ data }: NodeProps<Node<StepNodeData, 'step'>>) {
  return <BaseNode>
    <BaseNodeHeader>
      <BaseNodeHeaderTitle>
        <SheetTrigger>
          <Button variant="link">{data.label}</Button>
          <StepSheet step={data} copy={data.copy} />
        </SheetTrigger>
      </BaseNodeHeaderTitle>
      <Badge variant={KIND_VARIANT[data.kind]}>{data.kindLabel}</Badge>
    </BaseNodeHeader>
    <BaseNodeContent>
      <LabeledHandle id="in" title={data.inputsLabel} type="target" position={Position.Left} />
      <LabeledHandle id="out" title={data.outputsLabel} type="source" position={Position.Right} />
    </BaseNodeContent>
  </BaseNode>;
}

/** One swim row's label, placed once at the row's start. */
function LaneNode({ data }: NodeProps<Node<LaneNodeData, 'lane'>>) {
  return <Badge variant="ghost">{data.label}</Badge>;
}

const NODE_TYPES = { step: StepNode, lane: LaneNode };
/** The pinned components.flow.edge smoothstep edge between a step's right handle and the next step's left handle. */
const EDGE_TYPES = { smoothstep: SmoothStepEdge };
const EDGE_OPTIONS = { type: 'smoothstep' };
const FIT_VIEW = { padding: 0.04, minZoom: 0.05 };

const list = (values: readonly string[], none: string) => values.length ? values.join(', ') : none;

/** One step's facts in a stock shadcn Sheet: command, files, options, seat and status. Read-only. */
function StepSheet({ step, copy }: { step: StepData; copy: PipelineFlowCopy }) {
  const facts = step.facts;
  return <Sheet isDismissable>
    <SheetHeader>
      <SheetTitle>{step.label}</SheetTitle>
      <SheetDescription>{copy.lanes[step.lane] ?? step.lane}</SheetDescription>
    </SheetHeader>
    <Table aria-label={step.label}>
      <TableHeader>
        <TableHead isRowHeader>{copy.field}</TableHead>
        <TableHead>{copy.value}</TableHead>
      </TableHeader>
      <TableBody>
        <TableRow id="command"><TableCell>{copy.command}</TableCell><TableCell><code>{facts.command}</code></TableCell></TableRow>
        <TableRow id="inputs"><TableCell>{copy.inputs}</TableCell><TableCell>{list(facts.inputs, copy.none)}</TableCell></TableRow>
        <TableRow id="outputs"><TableCell>{copy.outputs}</TableCell><TableCell>{list(facts.outputs, copy.none)}</TableCell></TableRow>
        <TableRow id="options"><TableCell>{copy.options}</TableCell><TableCell>{list(facts.options, copy.none)}</TableCell></TableRow>
        <TableRow id="seat"><TableCell>{copy.seat}</TableCell><TableCell>{facts.seat ?? <Badge variant="outline">{copy.openSeat}</Badge>}</TableCell></TableRow>
        <TableRow id="status"><TableCell>{copy.status}</TableCell><TableCell><Badge variant="secondary">{facts.status}</Badge></TableCell></TableRow>
      </TableBody>
    </Table>
  </Sheet>;
}

/** `sections.producer.pipeline-flow`: graph.json rendered by @xyflow/react with components.flow.* nodes, one lane label per swim row and the pinned smoothstep edge; a step's title opens its read-only sheet. Its --xy-* theme is the generated studio-flow-theme.css, not a mapping here. */
export default function PipelineFlowSection({ flow, ...provenance }: { flow: PipelineFlowInput } & { [marker: `data-clossys-${string}`]: string }) {
  const { graph, copy } = flow;
  if (!graph.nodes.length) return <Card size="sm" {...provenance}>
    <CardHeader>
      <CardTitle role="heading" aria-level={2}>{copy.emptyTitle}</CardTitle>
      <CardDescription>{copy.emptyDescription}</CardDescription>
    </CardHeader>
  </Card>;
  const steps: Node[] = graph.nodes.map(node => ({
    ...node, type: 'step',
    data: { ...node.data, kindLabel: copy.kinds[node.data.kind], inputsLabel: `${copy.inputs} ${node.data.facts.inputs.length}`, outputsLabel: `${copy.outputs} ${node.data.facts.outputs.length}`, copy },
  }));
  const lanes: Node[] = graph.lanes.map(lane => ({
    id: `lane:${lane.id}`, type: 'lane', position: lane.position, data: { label: copy.lanes[lane.id] ?? lane.id },
    selectable: false, focusable: false, draggable: false, connectable: false,
  }));
  return <ReactFlow {...provenance} aria-label={copy.label} nodes={[...lanes, ...steps]} edges={[...graph.edges]} nodeTypes={NODE_TYPES} edgeTypes={EDGE_TYPES} defaultEdgeOptions={EDGE_OPTIONS}
    nodesDraggable={false} nodesConnectable={false} fitView fitViewOptions={FIT_VIEW} minZoom={FIT_VIEW.minZoom} />;
}
