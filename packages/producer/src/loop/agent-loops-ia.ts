/**
 * Where an agent's own loop slots sit in its tree (foundry-build-0048 U9a). Each content agent holds its five loop
 * slots under one L1 named for loops, in one `loops` L0: `loops.design-loops` (Designer), `loops.writing-loops`
 * (Writer), `loops.publishing-loops` (Publisher), each one group `agent`; Director, whose L0s are declared layers, takes
 * a `loops` layer holding its `direction-loops` L1 and the axis values that level it. Each L1 label names its agent's
 * loops, so no two agents share an L1 label (R01.12).
 *
 * The loops are Producer-standard leaves, not package catalog leaves: a consumer holds them once it adopts its agent's
 * loops (`clossys loop`), and `ia sync` keeps the L1 it adopted (targetIa) instead of reporting it as undeclared.
 * Pure data and one IA transform; no records are read here.
 */
import { AGENT_LISTS } from "../agent-lists.generated.js";
import type { AgentId } from "../records/types.js";
import type { IaAxes, IaDoc, IaLayer, IaNode } from "../records/slot-model/types.js";
import type { LoopName } from "./names.js";

/** The five loops every content agent owns a version of (`loop.fill`, `loop.refine`, release and audit stay Producer's). */
export const AGENT_LOOPS = ["loop.scope", "loop.slot", "loop.create", "loop.choose", "loop.cascade"] as const satisfies readonly LoopName[];
export type AgentLoopName = (typeof AGENT_LOOPS)[number];
export const isAgentLoop = (value: string): value is AgentLoopName => (AGENT_LOOPS as readonly string[]).includes(value);

/** The agents that own loops, in chain order. */
export const LOOP_AGENTS = AGENT_LISTS.content satisfies readonly AgentId[];
export type LoopAgent = (typeof LOOP_AGENTS)[number];
export const isLoopAgent = (value: string): value is LoopAgent => (LOOP_AGENTS as readonly string[]).includes(value);

/** The L0 every agent's loops L1 sits in, and its label where the L0 is a declared layer (Director). */
export const LOOPS_L0 = "loops";
export const LOOPS_L0_LABEL = "Loops";
/** The L1 axis Director's loops layer declares (R01.7). */
export const LOOPS_L1_AXIS = "Loop owner";

const L1_KEY: Readonly<Record<LoopAgent, string>> = { director: "direction-loops", designer: "design-loops", writer: "writing-loops", publisher: "publishing-loops" };
const L1_LABEL: Readonly<Record<LoopAgent, string>> = { director: "Direction loops", designer: "Design loops", writer: "Writing loops", publisher: "Publishing loops" };

/** The agent's loops L1 node id: dotted with its L0 where the L0 is implied by the prefix, bare in a layered IA. */
export const loopsL1Id = (agent: LoopAgent): string => agent === "director" ? L1_KEY.director : `${LOOPS_L0}.${L1_KEY[agent]}`;
/** The one L2 group under it, in the agent's own group id convention (Director `<l1>.<x>`, Designer `<key>-<x>`). */
export const loopsGroupId = (agent: LoopAgent): string => agent === "director" ? `${L1_KEY.director}.agent` : agent === "designer" ? `${L1_KEY.designer}-agent` : "agent";
export const loopsL1Label = (agent: LoopAgent): string => L1_LABEL[agent];

/** The agent's loops L1 with its five loop slots, in loop order. */
export function loopsNode(agent: LoopAgent): IaNode {
  return { id: loopsL1Id(agent), label: L1_LABEL[agent], children: [{ id: loopsGroupId(agent), label: "Agent loops", slots: [...AGENT_LOOPS] }] };
}

/** True when the IA places the agent's loops L1. */
export const holdsAgentLoops = (agent: LoopAgent, ia: Pick<IaDoc, "nodes"> | undefined): boolean =>
  !!ia && ia.nodes.some(node => node.id === loopsL1Id(agent));

/**
 * The IA with the agent's loops L1 last (its five slots, nowhere else), and in a layered IA the `loops` layer and the
 * axis values that level it. Idempotent: applying it to its own output changes nothing.
 */
export function withAgentLoopsIa(agent: LoopAgent, ia: IaDoc): IaDoc {
  const l1 = loopsL1Id(agent);
  const loops = new Set<string>(AGENT_LOOPS);
  const nodes: IaNode[] = ia.nodes.filter(node => node.id !== l1)
    .map(node => ({ ...node, children: node.children.map(child => ({ ...child, slots: child.slots.filter(id => !loops.has(id)) })) }));
  nodes.push(loopsNode(agent));
  const out: Record<string, unknown> = { ...ia, nodes };
  if (ia.layers !== undefined) {
    const layers: IaLayer[] = ia.layers.filter(layer => layer.id !== LOOPS_L0).map(layer => ({ ...layer, nodes: layer.nodes.filter(ref => ref.split("/")[0] !== l1) }));
    layers.push({ id: LOOPS_L0, label: LOOPS_L0_LABEL, nodes: [l1] });
    out.layers = layers;
  }
  if (ia.axes !== undefined) {
    const axes: IaAxes = ia.axes;
    const values = axes.L0.values ?? [];
    out.axes = {
      ...axes,
      L0: { ...axes.L0, ...(axes.L0.values !== undefined ? { values: values.includes(LOOPS_L0_LABEL) ? [...values] : [...values, LOOPS_L0_LABEL] } : {}) },
      L1: { ...axes.L1, [LOOPS_L0]: { name: LOOPS_L1_AXIS, values: [L1_LABEL[agent]] } },
    };
  }
  return out as unknown as IaDoc;
}
