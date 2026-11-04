'use client';
import { Background, Badge, BaseNode, BaseNodeContent, Card, CardDescription, CardHeader, CardTitle, Controls, Field, FieldDescription, FieldGroup, FieldTitle, Item, ItemActions, ItemContent, ItemTitle, LabeledHandle, MiniMap, NodeStatusIndicator, Position, ReactFlow, Sheet, SheetDescription, SheetHeader, SheetTitle, SmoothStepEdge, useReactFlow, type Edge, type Node, type NodeProps } from '@clossys/designer-ui';

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
  /** graph.json's step state; the node's status border and the sheet's Writer label follow it. */
  status: StepStatus;
}

/** A step's state as `clossys pipeline status` names it. */
export type StepStatus = 'ready' | 'pending';

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
  command: string;
  inputs: string;
  outputs: string;
  options: string;
  seat: string;
  status: string;
  none: string;
  openSeat: string;
  statuses: Readonly<Record<StepStatus, string>>;
}

/** The `flow` input of `sections.producer.pipeline-flow`. */
export interface PipelineFlowInput { graph: PipelineGraph; copy: PipelineFlowCopy }

type StepNodeData = StepData & { kindLabel: string; inputsLabel: string; outputsLabel: string; copy: PipelineFlowCopy };
type LaneNodeData = { [key: string]: unknown; label: string };

/** Each kind's stock Badge variant; the legend uses the same mapping. */
const KIND_VARIANT = { plumb: 'outline', 'decide:creative': 'secondary', 'decide:judgment': 'default' } as const;

/** A step's status on the stock React Flow UI NodeStatusIndicator: a ready step shows the success border, a pending one the loading border. */
const STATUS_INDICATOR = { ready: 'success', pending: 'loading' } as const;

/**
 * One step: the stock React Flow UI BaseNode anatomy inside the stock NodeStatusIndicator. Its header
 * is the stock shadcn Item: the title in ItemContent (ItemTitle clamps it to one line) and the kind
 * Badge in ItemActions, so the badge stays inside the card at any title length (Item wraps the
 * actions under the title when both do not fit). One labeled handle per side carries the port count.
 * The step's sheet follows React Flow's own selection: a click anywhere on the node, or Enter on the
 * focused node, selects it and opens the sheet; closing the sheet clears the selection.
 */
function StepNode({ id, data, selected }: NodeProps<Node<StepNodeData, 'step'>>) {
  const { updateNode } = useReactFlow();
  return <NodeStatusIndicator status={STATUS_INDICATOR[data.facts.status]}>
    <BaseNode>
      <Item size="sm">
        <ItemContent>
          <ItemTitle>{data.label}</ItemTitle>
        </ItemContent>
        <ItemActions>
          <Badge variant={KIND_VARIANT[data.kind]}>{data.kindLabel}</Badge>
        </ItemActions>
      </Item>
      <BaseNodeContent>
        <LabeledHandle id="in" title={data.inputsLabel} type="target" position={Position.Left} />
        <LabeledHandle id="out" title={data.outputsLabel} type="source" position={Position.Right} />
      </BaseNodeContent>
    </BaseNode>
    <StepSheet step={data} copy={data.copy} isOpen={selected} onOpenChange={open => { if (!open) updateNode(id, { selected: false }); }} />
  </NodeStatusIndicator>;
}

/** One swim row's label, placed once at the row's start. */
function LaneNode({ data }: NodeProps<Node<LaneNodeData, 'lane'>>) {
  return <Badge variant="ghost">{data.label}</Badge>;
}

const NODE_TYPES = { step: StepNode, lane: LaneNode };
/** The pinned components.flow.edge smoothstep edge between a step's right handle and the next step's left handle. */
const EDGE_TYPES = { smoothstep: SmoothStepEdge };
const EDGE_OPTIONS = { type: 'smoothstep' };
/**
 * The initial zoom: step titles are the stock ItemTitle's 14px text, so 0.86 renders them at no less
 * than 12px. The view opens at the graph's top left (the lane labels) at that zoom; the stock
 * Controls and MiniMap pan and zoom from there, down to MIN_ZOOM, past the readable size.
 */
const READABLE_ZOOM = 0.86;
const MIN_ZOOM = 0.1;
/** Screen inset of the opening view from the canvas's top left corner, in pixels. */
const INSET = 16;
/** The stock Controls' fit-view button shows every step. */
const FIT_ALL = { padding: 0.04 };

const list = (values: readonly string[], none: string) => values.length ? values.join(', ') : none;

/** One step's facts in a stock shadcn Sheet on the right: a stock FieldGroup with one Field (title, then the value) per fact, so long values wrap; the command keeps the code style. Read-only. */
function StepSheet({ step, copy, isOpen, onOpenChange }: { step: StepData; copy: PipelineFlowCopy; isOpen: boolean; onOpenChange: (open: boolean) => void }) {
  const facts = step.facts;
  return <Sheet isDismissable isOpen={isOpen} onOpenChange={onOpenChange}>
    <SheetHeader>
      <SheetTitle>{step.label}</SheetTitle>
      <SheetDescription>{copy.lanes[step.lane] ?? step.lane}</SheetDescription>
    </SheetHeader>
    <FieldGroup className="px-4">
      <Field data-fact="command"><FieldTitle>{copy.command}</FieldTitle><FieldDescription><code>{facts.command}</code></FieldDescription></Field>
      <Field data-fact="inputs"><FieldTitle>{copy.inputs}</FieldTitle><FieldDescription>{list(facts.inputs, copy.none)}</FieldDescription></Field>
      <Field data-fact="outputs"><FieldTitle>{copy.outputs}</FieldTitle><FieldDescription>{list(facts.outputs, copy.none)}</FieldDescription></Field>
      <Field data-fact="options"><FieldTitle>{copy.options}</FieldTitle><FieldDescription>{list(facts.options, copy.none)}</FieldDescription></Field>
      <Field data-fact="seat"><FieldTitle>{copy.seat}</FieldTitle><FieldDescription>{facts.seat ?? <Badge variant="outline">{copy.openSeat}</Badge>}</FieldDescription></Field>
      <Field data-fact="status"><FieldTitle>{copy.status}</FieldTitle><FieldDescription><Badge variant="secondary" data-status={facts.status}>{copy.statuses[facts.status]}</Badge></FieldDescription></Field>
    </FieldGroup>
  </Sheet>;
}

/** `sections.producer.pipeline-flow`: the standard canvas-app layout. graph.json rendered by @xyflow/react in a stock Card that fills the content area: components.flow.* step nodes with their status, one lane label per swim row, the pinned smoothstep edge, the stock Background, Controls (bottom left) and MiniMap (bottom right). It opens at the top left at a readable zoom; a click on a step (or Enter on a focused step) opens its read-only sheet on the right. Its --xy-* theme is the generated studio-flow-theme.css, not a mapping here. */
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
  // Open at the lane labels' top left corner at the readable zoom.
  const left = Math.min(...graph.lanes.map(lane => lane.position.x), ...graph.nodes.map(node => node.position.x));
  const top = Math.min(...graph.lanes.map(lane => lane.position.y), ...graph.nodes.map(node => node.position.y));
  const viewport = { x: INSET - left * READABLE_ZOOM, y: INSET - top * READABLE_ZOOM, zoom: READABLE_ZOOM };
  // Uncontrolled (defaultNodes, defaultEdges): React Flow keeps the measured node sizes, which the stock MiniMap draws from.
  // The flow is read-only and mounts once graph.json has loaded (the empty state renders until then).
  // The stock Card is the canvas's frame and fills the content area below the page's header rows (flex-1); the canvas fills the Card.
  return <Card size="sm" className="flex-1" {...provenance}>
    <ReactFlow aria-label={copy.label} defaultNodes={[...lanes, ...steps]} defaultEdges={[...graph.edges]} nodeTypes={NODE_TYPES} edgeTypes={EDGE_TYPES} defaultEdgeOptions={EDGE_OPTIONS}
      nodesDraggable={false} nodesConnectable={false} selectionKeyCode={null} multiSelectionKeyCode={null} defaultViewport={viewport} minZoom={MIN_ZOOM}>
      <Background />
      <Controls position="bottom-left" showInteractive={false} fitViewOptions={FIT_ALL} />
      <MiniMap position="bottom-right" pannable zoomable />
    </ReactFlow>
  </Card>;
}
