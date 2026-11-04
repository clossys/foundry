/**
 * The pipeline page's section inputs, from graph.json alone (`GET /api/pipeline`). Each step
 * becomes one flow node with graph.json's id and position; each edge keeps its `from->to`
 * identity, the form `check:pipeline` uses. Labels and kind names are Writer keys
 * (studio.pipeline.*); step ids, globs and lanes are data and pass through unchanged.
 * Server-safe: no hooks and no client-only imports.
 */
import type { PipelineFlowInput, StepHolder, StepKind, StepStatus } from '../sections/producer-pipeline-flow';
import type { PipelineLegendInput } from '../sections/producer-pipeline-legend';
import type { TeamStripInput } from '../sections/producer-team-strip';
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
  stage: string;
  holder: GraphHolder;
  layout: { lane: string; stage: string; x: number; y: number };
}
type SeatKind = 'you' | 'ai' | 'code';
type SeatTier = 'low' | 'mid' | 'high';
/** A step's seat holder as graph.json records it (packages/producer/src/pipeline/roster.ts). */
export interface GraphHolder { id: string; kind: SeatKind | null; source: 'file' | 'derived'; tier: SeatTier | null }
/** One roster entry: what it holds, by kind, source and tier. */
export interface GraphRosterEntry { id: string; kinds: readonly SeatKind[]; steps: number; sources: readonly ('file' | 'derived')[]; tiers: readonly SeatTier[] }
/** One edge: the step that writes a file and the step that reads it. */
export interface PipelineGraphEdge { from: string; to: string; via: readonly { output: string; input: string }[] }
/** graph.json as Producer serves it. */
export interface PipelineGraphFile {
  schema: 'clossys.pipeline-graph/1';
  nodes: readonly PipelineGraphStep[];
  edges: readonly PipelineGraphEdge[];
  untyped: readonly unknown[];
  layout: { constants: { nodeWidth: number }; lanes: readonly { id: string; x: number; y: number }[]; stages: readonly { id: string; x: number; y: number }[] };
  roster: readonly GraphRosterEntry[];
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

const SEAT_KINDS: readonly SeatKind[] = ['you', 'ai', 'code'];
/** A lane's (and team card's) name: `studio.pipeline.lane.<id>`. */
const laneName = (id: string) => studioCopy(`studio.pipeline.lane.${laneKey(id)}`);
const tierLabel = (tier: SeatTier) => studioCopy(`studio.team.tier.${tier}`);
/** The lane a holder sits in: its roster entry, else `unassigned` (graph.json's layout.lane). */
function holderFacts(step: PipelineGraphStep): StepHolder {
  return {
    name: laneName(step.layout.lane),
    kind: step.holder.kind ? studioCopy(`studio.team.kind.${step.holder.kind}`) : null,
    tier: step.holder.tier ? tierLabel(step.holder.tier) : step.holder.kind === 'ai' ? studioCopy('studio.team.tier-open') : null,
    source: studioCopy(`studio.pipeline.seat.${step.holder.source}`),
    derived: step.holder.source === 'derived',
  };
}

/** The edge identity the page renders and `check:pipeline-canvas` compares: `from->to`. */
export const edgeId = (edge: { from: string; to: string }) => `${edge.from}->${edge.to}`;

/** The section inputs: the page head (title, purpose), the team strip, the flow, and the counts and legend row. */
export interface PipelineInputs { header: PageHeaderInput; team: TeamStripInput; flow: PipelineFlowInput; legend: PipelineLegendInput }

/**
 * The team strip: one card per lane, in lane order (the roster, then `unassigned` while a step has
 * no holder). A card's facts are graph.json's roster entry; its link highlights its lane (`?seat=<id>`)
 * on `path`, and the card whose lane `seat` names is active.
 */
export function teamInputs(graph: PipelineGraphFile, path: string, seat: string | null): TeamStripInput {
  const roster = new Map(graph.roster.map(entry => [entry.id, entry]));
  return {
    label: studioCopy('studio.team.label'),
    cards: graph.layout.lanes.map(lane => {
      const entry = roster.get(lane.id);
      const steps = entry?.steps ?? graph.nodes.filter(step => step.layout.lane === lane.id).length;
      const kinds = entry ? SEAT_KINDS.filter(kind => entry.kinds.includes(kind)) : [];
      const name = laneName(lane.id);
      return {
        id: lane.id, name, initials: name.slice(0, 1).toUpperCase(),
        kinds: kinds.map(kind => studioCopy(`studio.team.kind.${kind}`)),
        ...(kinds.includes('ai') ? { tier: entry!.tiers.length ? entry!.tiers.map(tierLabel).join(', ') : studioCopy('studio.team.tier-open') } : {}),
        description: studioCopy(`studio.team.about.${laneKey(lane.id)}`),
        steps: studioCopy('studio.team.steps', { count: steps }),
        href: `${path}?seat=${encodeURIComponent(lane.id)}`,
        showLabel: studioCopy('studio.team.show', { name }),
        active: lane.id === seat,
      };
    }),
  };
}

/** The section inputs for one graph.json; `title` and `description` head the page; `seat` is the highlighted lane. */
export function pipelineInputs(graph: PipelineGraphFile, head: PageHeaderInput, path: string, seat: string | null = null): PipelineInputs {
  const lit = seat && graph.layout.lanes.some(lane => lane.id === seat) ? seat : null;
  const open = graph.nodes.filter(step => step.open).length;
  const flow: PipelineFlowInput = {
    graph: {
      nodes: graph.nodes.map(step => ({
        id: step.id,
        position: { x: step.layout.x, y: step.layout.y },
        width: graph.layout.constants.nodeWidth,
        data: {
          label: step.id, kind: step.kind, lane: step.layout.lane, stage: step.layout.stage,
          facts: {
            command: commandLine(step.command),
            inputs: unique(step.inputs.map(port => port.glob)),
            outputs: unique(step.outputs.map(port => port.glob)),
            options: (graph.options?.cli?.[step.id] ?? []).map(option => option.flag),
            seat: graph.seats?.[step.id]?.by ?? null,
            status: stepStatus(step),
            stage: studioCopy(`studio.pipeline.stage.${step.layout.stage}`),
            holder: holderFacts(step),
          },
        },
      })),
      // One handle per side: every edge leaves its writer's right handle and enters its reader's left handle.
      edges: graph.edges.map(edge => ({ id: edgeId(edge), source: edge.from, target: edge.to, sourceHandle: 'out', targetHandle: 'in' })),
      lanes: graph.layout.lanes.map(lane => ({ id: lane.id, position: { x: lane.x, y: lane.y } })),
      stages: graph.layout.stages.map(stage => ({ id: stage.id, position: { x: stage.x, y: stage.y } })),
    },
    seat: lit,
    copy: {
      label: studioCopy('studio.pipeline.flow-label'),
      kinds: Object.fromEntries(KINDS.map(kind => [kind, studioCopy(`studio.pipeline.kind.${kindKey(kind)}`)])) as Record<StepKind, string>,
      lanes: Object.fromEntries(graph.layout.lanes.map(lane => [lane.id, laneName(lane.id)])),
      stages: Object.fromEntries(graph.layout.stages.map(stage => [stage.id, studioCopy(`studio.pipeline.stage.${stage.id}`)])),
      emptyTitle: studioCopy('studio.pipeline.empty.title'),
      emptyDescription: studioCopy('studio.pipeline.empty.description'),
      command: studioCopy('studio.pipeline.step.command'),
      inputs: studioCopy('studio.pipeline.step.inputs'),
      outputs: studioCopy('studio.pipeline.step.outputs'),
      options: studioCopy('studio.pipeline.step.options'),
      seat: studioCopy('studio.pipeline.step.seat'),
      status: studioCopy('studio.pipeline.step.status'),
      stage: studioCopy('studio.pipeline.step.stage'),
      holder: studioCopy('studio.pipeline.step.holder'),
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
  return { header: head, team: teamInputs(graph, path, lit), flow, legend };
}
