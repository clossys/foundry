/**
 * The pipeline page's section inputs, from the active wiring alone (`GET /api/pipeline/wiring`,
 * `clossys pipeline wiring`): the steps whose command exists and the runs they recorded. Each wiring
 * node becomes one flow node with the wiring's id and computed position; each observed edge (a file
 * one run wrote and another run read) keeps its `from->to` identity. A node's state is its latest run
 * record's (passed, failed, stale, never run) and cites that record; nothing here is declared.
 * Labels and state names are Writer keys (studio.pipeline.*); step ids, files and lanes are data and
 * pass through unchanged. Server-safe: no hooks and no client-only imports.
 */
import type { CheckStatus, PipelineFlowInput, StepCheck, StepHolder, StepKind, StepStatus } from '../sections/producer-pipeline-flow';
import type { PipelineLegendInput } from '../sections/producer-pipeline-legend';
import type { TeamStripInput } from '../sections/producer-team-strip';
import type { PageHeaderInput } from '../sections/studio-page-header';
import { studioCopy } from './studio-copy';

type SeatKind = 'you' | 'ai' | 'code';
type SeatTier = 'low' | 'mid' | 'high';
/** A step's seat holder as the wiring records it (packages/producer/src/pipeline/roster.ts). */
export interface WiringHolder { id: string; kind: SeatKind | null; source: 'file' | 'derived'; tier: SeatTier | null }
/** One roster entry: what it holds, by kind, source and tier. */
export interface WiringRosterEntry { id: string; kinds: readonly SeatKind[]; steps: number; sources: readonly ('file' | 'derived')[]; tiers: readonly SeatTier[] }
/** Where a state comes from: one line of the run store (packages/producer/src/pipeline/wiring.ts Citation). */
export interface WiringCitation { store: string; line: number; run: string; end: string; exit: number }
/** One check of a node, with the state of its latest run record. */
export interface WiringCheck { id: string; state: CheckStatus; citation: WiringCitation | null }
/** One node as `clossys.pipeline-wiring/1` records it; only the fields the page shows. */
export interface WiringNode {
  id: string;
  step: string;
  kind: StepKind;
  invocation: string | null;
  command: string;
  holder: WiringHolder;
  stage: string;
  state: StepStatus;
  citation: WiringCitation | null;
  changed: readonly string[];
  changedCount: number;
  reads: number;
  writes: number;
  checks: readonly WiringCheck[];
  layout: { lane: string; stage: string; rank: number; x: number; y: number };
}
/** One observed edge: the node whose run wrote files and the node whose run read them. */
export interface WiringEdge { from: string; to: string; files: number; sample: readonly string[]; fresh: boolean }
/** The wiring as Producer serves it. */
export interface PipelineWiringFile {
  schema: 'clossys.pipeline-wiring/1';
  store: string;
  nodes: readonly WiringNode[];
  edges: readonly WiringEdge[];
  layout: { constants: { nodeWidth: number }; lanes: readonly { id: string; x: number; y: number }[]; stages: readonly { id: string; x: number; y: number; round?: string; name?: string }[]; rounds: readonly { id: string; x: number; y: number; stages: readonly string[] }[] };
  roster: readonly WiringRosterEntry[];
  seats: Readonly<Record<string, { by: string | null }>>;
  undrawn: readonly { step: string; reason: string }[];
  counts: Readonly<Record<StepStatus, number>> & { runs: number };
}

const KINDS: readonly StepKind[] = ['plumb', 'decide:creative', 'decide:judgment'];
/** A kind's Writer key suffix: `decide:creative` is `decide-creative`. */
const kindKey = (kind: StepKind) => kind.replace(':', '-');
/** A lane's Writer key suffix: an agent lane (`agent:designer`) is named by its agent. */
const laneKey = (lane: string) => lane.replace(/^agent:/, '');
const unique = (values: readonly string[]) => [...new Set(values)];
const STATUSES: readonly CheckStatus[] = ['passed', 'failed', 'stale', 'never-run', 'not-run'];
/** A stage's Writer key suffix: its name inside its round (`design.make` is `make`). */
const stageKey = (stage: string) => stage.slice(stage.indexOf('.') + 1);
/** A stage's round id (`design.make` is `design`). */
const roundKey = (stage: string) => stage.slice(0, Math.max(0, stage.indexOf('.')));
/** The invocation words a node id carries beyond its step's own (`workspace.check[--slots --readiness]`), or null. */
const modeOf = (node: Pick<WiringNode, 'id' | 'step'>) => node.id.startsWith(`${node.step}[`) && node.id.endsWith(']') ? node.id.slice(node.step.length + 1, -1) : null;
/**
 * A node's canvas label: its step's resolved Writer copy (`studio.pipeline.node.<step>`), a check's
 * (`studio.pipeline.node.check`), with the invocation's extra words when one step ran in several
 * ways; never the raw id.
 */
const nodeLabel = (node: Pick<WiringNode, 'id' | 'step'>) => {
  const step = node.step.startsWith('check:') ? studioCopy('studio.pipeline.node.check', { id: node.step.slice('check:'.length) }) : studioCopy(`studio.pipeline.node.${node.step}`);
  const mode = modeOf(node);
  return mode ? studioCopy('studio.pipeline.node.invocation', { step, mode }) : step;
};
/** A run record citation as Writer copy: the store file and line, the exit code and when it ended. */
const citationText = (citation: WiringCitation | null) => citation ? studioCopy('studio.pipeline.citation', { store: citation.store, line: citation.line, exit: citation.exit, end: citation.end }) : null;
const stageLabel = (stage: string) => studioCopy(`studio.pipeline.stage.${stageKey(stage)}`);
const roundLabel = (round: string) => studioCopy(`studio.pipeline.round.${round}`);

const SEAT_KINDS: readonly SeatKind[] = ['you', 'ai', 'code'];
/** A lane's (and team card's) name: `studio.pipeline.lane.<id>`. */
const laneName = (id: string) => studioCopy(`studio.pipeline.lane.${laneKey(id)}`);
const tierLabel = (tier: SeatTier) => studioCopy(`studio.team.tier.${tier}`);
/** The lane a holder sits in: its roster entry, else `unassigned` (the wiring's layout.lane). */
function holderFacts(node: WiringNode): StepHolder {
  return {
    name: laneName(node.layout.lane),
    kind: node.holder.kind ? studioCopy(`studio.team.kind.${node.holder.kind}`) : null,
    tier: node.holder.tier ? tierLabel(node.holder.tier) : node.holder.kind === 'ai' ? studioCopy('studio.team.tier-open') : null,
    source: studioCopy(`studio.pipeline.seat.${node.holder.source}`),
    derived: node.holder.source === 'derived',
  };
}

/** The edge identity the page renders and `check:pipeline-canvas` compares: `from->to`. */
export const edgeId = (edge: { from: string; to: string }) => `${edge.from}->${edge.to}`;

/** The section inputs: the page head (title, purpose), the team strip, the flow, and the counts and legend row. */
export interface PipelineInputs { header: PageHeaderInput; team: TeamStripInput; flow: PipelineFlowInput; legend: PipelineLegendInput }

/**
 * The team strip: one card per lane, in lane order (the wiring's roster, then `unassigned` while a
 * node has no holder). A card's facts are the wiring's roster entry; its link highlights its lane
 * (`?seat=<id>`) on `path`, and the card whose lane `seat` names is active.
 */
export function teamInputs(wiring: PipelineWiringFile, path: string, seat: string | null): TeamStripInput {
  const roster = new Map(wiring.roster.map(entry => [entry.id, entry]));
  return {
    label: studioCopy('studio.team.label'),
    cards: wiring.layout.lanes.map(lane => {
      const entry = roster.get(lane.id);
      const steps = entry?.steps ?? wiring.nodes.filter(node => node.layout.lane === lane.id).length;
      const kinds = entry ? SEAT_KINDS.filter(kind => entry.kinds.includes(kind)) : [];
      const name = laneName(lane.id);
      return {
        id: lane.id, name, initials: studioCopy(`studio.team.initials.${laneKey(lane.id)}`),
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

/** The section inputs for one wiring; `head` heads the page; `seat` is the highlighted lane. */
export function pipelineInputs(wiring: PipelineWiringFile, head: PageHeaderInput, path: string, seat: string | null = null): PipelineInputs {
  const lit = seat && wiring.layout.lanes.some(lane => lane.id === seat) ? seat : null;
  const nodeRole = studioCopy('studio.flow.node-role');
  const labels = new Map(wiring.nodes.map(node => [node.id, nodeLabel(node)]));
  const feeds = (id: string, side: 'from' | 'to') => unique(wiring.edges.filter(edge => edge[side === 'from' ? 'to' : 'from'] === id).map(edge => labels.get(edge[side])!));
  const flow: PipelineFlowInput = {
    graph: {
      nodes: wiring.nodes.map(node => ({
        id: node.id,
        position: { x: node.layout.x, y: node.layout.y },
        width: wiring.layout.constants.nodeWidth,
        domAttributes: { 'aria-roledescription': nodeRole },
        data: {
          label: labels.get(node.id)!, kind: node.kind, lane: node.layout.lane, stage: node.layout.stage,
          inputsLabel: studioCopy('studio.pipeline.step.inputs-count', { count: node.reads }),
          outputsLabel: studioCopy('studio.pipeline.step.outputs-count', { count: node.writes }),
          facts: {
            command: node.command,
            inputs: feeds(node.id, 'from'),
            outputs: feeds(node.id, 'to'),
            changed: node.changedCount > node.changed.length ? [...node.changed, studioCopy('studio.pipeline.step.changed-more', { count: node.changedCount - node.changed.length })] : node.changed,
            seat: wiring.seats[node.step]?.by ?? null,
            status: node.state,
            citation: citationText(node.citation),
            checks: node.checks.map((check): StepCheck => ({ id: check.id, status: check.state, citation: citationText(check.citation) })),
            round: roundLabel(roundKey(node.layout.stage)),
            stage: stageLabel(node.layout.stage),
            holder: holderFacts(node),
          },
        },
      })),
      // One handle per side: every edge leaves its writer's right handle and enters its reader's left handle.
      // React Flow names an edge by its endpoint ids; the words around them are Writer copy (studio.flow.*).
      edges: wiring.edges.map(edge => ({ id: edgeId(edge), source: edge.from, target: edge.to, sourceHandle: 'out', targetHandle: 'in',
        ariaLabel: studioCopy('studio.flow.edge-label', { source: edge.from, target: edge.to }),
        domAttributes: { 'aria-roledescription': studioCopy('studio.flow.edge-role') } })),
      lanes: wiring.layout.lanes.map(lane => ({ id: lane.id, position: { x: lane.x, y: lane.y } })),
      stages: wiring.layout.stages.map(stage => ({ id: stage.id, position: { x: stage.x, y: stage.y } })),
      rounds: wiring.layout.rounds.map(round => ({ id: round.id, position: { x: round.x, y: round.y } })),
    },
    seat: lit,
    copy: {
      label: studioCopy('studio.pipeline.flow-label'),
      kinds: Object.fromEntries(KINDS.map(kind => [kind, studioCopy(`studio.pipeline.kind.${kindKey(kind)}`)])) as Record<StepKind, string>,
      lanes: Object.fromEntries(wiring.layout.lanes.map(lane => [lane.id, laneName(lane.id)])),
      stages: Object.fromEntries(wiring.layout.stages.map(stage => [stage.id, stageLabel(stage.id)])),
      rounds: Object.fromEntries(wiring.layout.rounds.map(round => [round.id, roundLabel(round.id)])),
      emptyTitle: studioCopy('studio.pipeline.empty.title'),
      emptyDescription: studioCopy('studio.pipeline.empty.description'),
      command: studioCopy('studio.pipeline.step.command'),
      inputs: studioCopy('studio.pipeline.step.inputs'),
      outputs: studioCopy('studio.pipeline.step.outputs'),
      changed: studioCopy('studio.pipeline.step.changed'),
      seat: studioCopy('studio.pipeline.step.seat'),
      status: studioCopy('studio.pipeline.step.status'),
      citation: studioCopy('studio.pipeline.step.citation'),
      checks: studioCopy('studio.pipeline.step.checks'),
      round: studioCopy('studio.pipeline.step.round'),
      stage: studioCopy('studio.pipeline.step.stage'),
      holder: studioCopy('studio.pipeline.step.holder'),
      none: studioCopy('studio.pipeline.step.none'),
      openSeat: studioCopy('studio.pipeline.seat.open'),
      statuses: Object.fromEntries(STATUSES.map(status => [status, studioCopy(`studio.pipeline.status.${status}`)])) as Record<CheckStatus, string>,
      nodeRole,
      attribution: studioCopy('studio.flow.attribution'),
      attributionLabel: studioCopy('studio.flow.attribution-label'),
      // Every word React Flow itself renders (its keyboard help, control and minimap labels), as Writer copy.
      aria: {
        'node.a11yDescription.default': studioCopy('studio.flow.node-description'),
        'node.a11yDescription.keyboardDisabled': studioCopy('studio.flow.node-description-keyboard'),
        'node.a11yDescription.ariaLiveMessage': ({ direction, x, y }) => studioCopy('studio.flow.node-moved', { direction, x, y }),
        'edge.a11yDescription.default': studioCopy('studio.flow.edge-description'),
        'controls.ariaLabel': studioCopy('studio.flow.controls'),
        'controls.zoomIn.ariaLabel': studioCopy('studio.flow.zoom-in'),
        'controls.zoomOut.ariaLabel': studioCopy('studio.flow.zoom-out'),
        'controls.fitView.ariaLabel': studioCopy('studio.flow.fit-view'),
        'controls.interactive.ariaLabel': studioCopy('studio.flow.interactive'),
        'minimap.ariaLabel': studioCopy('studio.flow.minimap'),
        'handle.ariaLabel': studioCopy('studio.flow.handle'),
      },
    },
  };
  // The legend row's counts are the wiring's: drawn nodes, observed edges, nodes per state and the
  // run records they come from; the declared steps with no command are counted, never drawn.
  const counts = wiring.counts;
  const legend: PipelineLegendInput = {
    rows: KINDS.map(kind => ({ kind, label: studioCopy(`studio.pipeline.kind.${kindKey(kind)}`), meaning: studioCopy(`studio.pipeline.legend.${kindKey(kind)}`) })),
    untypedCount: wiring.undrawn.length,
    copy: {
      title: studioCopy('studio.pipeline.counts.title'),
      counts: studioCopy('studio.pipeline.counts', { steps: wiring.nodes.length, edges: wiring.edges.length, passed: counts.passed, failed: counts.failed, stale: counts.stale, never: counts['never-run'], runs: counts.runs }),
      legend: studioCopy('studio.pipeline.legend.title'),
      untyped: studioCopy('studio.pipeline.legend.untyped', { count: wiring.undrawn.length }),
    },
  };
  return { header: head, team: teamInputs(wiring, path, lit), flow, legend };
}
