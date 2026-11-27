/**
 * Consumed package leaves (foundry-build-0048 CONSISTENCY D5 option 1): `clossys ia <agent> --adopt` and `ia sync`
 * place only the Director, Designer and Writer package leaves a publication reaches. Code decides which; nothing is
 * listed by hand.
 *
 * roots  = every slot a publication the installed Publisher package declares names (check/ia-orphans.ts
 *          declaredPublications: its pages, layouts, chrome and every slot their package default files name, the
 *          publication's own default with its Writer meta among them), whether or not the consumer seated it, plus
 *          every slot the consumer's own seated publications reach and the agent loop slots the runner consumes
 *          (ia-orphans publicationReach: a consumer extension or request-placed slot that cites a package leaf consumes
 *          it; an agent loop slot is terminal, so a loop version does not consume a slot it names). A Publisher package
 *          contract is not walked: a layout role's `kinds` are the sections a page may take, not the ones it takes, and
 *          ia.orphans walks no contract either, so an adopted leaf reached only through one would be an orphan
 * edges  = a package leaf's inputs and uses as the adopt verb derives them (ia-sync.ts packageBehaviour, read against
 *          every package leaf so the read graph is the package's own), each to the agent its package ref names, else
 *          the same agent when it holds the id, else the first agent (director, designer, writer) whose package does
 * result = `<agent>/<id>` for every package leaf the walk reaches.
 * Unreadable Publisher package data throws (ia-orphans PublisherDataError); there is no empty-set fallback.
 *
 * The walk uses the same edge kinds the consumer slot.json files carry, so an adopted consumed leaf is reached by
 * ia.orphans through its own refs. A leaf the walk does not reach stays in the package catalog, adoptable on demand
 * through `clossys request` (loop.slot reuse).
 */
import { AGENT_LISTS } from "../../agent-lists.generated.js";
import { declaredPublications, isAgentLoopKey, publicationReach } from "../../check/ia-orphans.js";
import { feedsIndex } from "./derive.js";
import { designerIa, directorIa, slotPositions, writerIa, type FoundryIa } from "./foundry-ia.js";
import { packageBehaviour } from "./ia-sync.js";
import type { IaDoc } from "./types.js";

export const CONSUMED_AGENTS = AGENT_LISTS.placed;
export type ConsumedAgent = (typeof CONSUMED_AGENTS)[number];
export const isConsumedAgent = (agent: string): agent is ConsumedAgent => (CONSUMED_AGENTS as readonly string[]).includes(agent);
/**
 * Whether an agent's adoption and sync are scoped to consumed leaves. The Director is not (CHAT-DIR, gaps 9 and 10): its
 * reader takes the whole catalog, every leaf placed exactly once (director/src/format/tree.ts), so `ia director --adopt`
 * places every leaf and nothing is pruned. Its leaves still count in the walk, as the cells Designer and Writer cite.
 */
export const scopedToConsumed = (agent: string): agent is Exclude<ConsumedAgent, "director"> => isConsumedAgent(agent) && agent !== "director";

const PACKAGE_IA: Readonly<Record<ConsumedAgent, () => FoundryIa>> = { director: directorIa, designer: designerIa, writer: writerIa };
const SLOT_REF = /^(director|designer|writer|publisher|producer)\/([a-z][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*){1,3})(?:[/#:].*)?$/;
const keyOf = (to: string): string | undefined => { const match = SLOT_REF.exec(to); return match ? `${match[1]}/${match[2]}` : undefined; };

export interface ConsumedGraph {
  /** The package IA of each consumed agent, as read. */
  readonly packages: Readonly<Record<ConsumedAgent, FoundryIa>>;
  /** Each package leaf's out-edges, `<agent>/<id>` to `<agent>/<id>`. */
  readonly edges: ReadonlyMap<string, readonly string[]>;
}

/** The package read graph over the Director, Designer and Writer package leaves (no consumer state). */
export function consumedGraph(packages: Readonly<Record<ConsumedAgent, FoundryIa>> = { director: directorIa(), designer: designerIa(), writer: writerIa() }): ConsumedGraph {
  const known = new Set<string>();
  for (const agent of CONSUMED_AGENTS) for (const id of packages[agent].slots.keys()) known.add(id);
  const feeds = feedsIndex([...packages.director.slots.values()].map(slot => [slot.id, slot.feeds] as const), known);
  const holderOf = (id: string, self: ConsumedAgent): ConsumedAgent | undefined =>
    packages[self].slots.has(id) ? self : CONSUMED_AGENTS.find(agent => packages[agent].slots.has(id));
  const edges = new Map<string, string[]>();
  for (const agent of CONSUMED_AGENTS) {
    const pkg = packages[agent];
    const positions = slotPositions(agent, pkg.ia);
    for (const [id, slot] of pkg.slots) {
      const position = positions.get(id);
      if (!position) continue;
      const behaviour = packageBehaviour(agent, id, slot, position, { known, feeds });
      const own = new Map<string, string>();
      for (const ref of slot.refs ?? []) { const key = keyOf(ref.to); if (key) own.set(key.slice(key.indexOf("/") + 1), key); }
      const out = new Set<string>();
      for (const target of [...behaviour.inputs, ...behaviour.uses]) {
        const named = own.get(target);
        const holder = named ? undefined : holderOf(target, agent);
        const key = named ?? (holder ? `${holder}/${target}` : undefined);
        if (key && key !== `${agent}/${id}`) out.add(key);
      }
      edges.set(`${agent}/${id}`, [...out]);
    }
  }
  return { packages, edges };
}

let packageGraph: ConsumedGraph | undefined;
/** The read graph of the installed packages, built once per process (package data does not change under a run). */
export const packageConsumedGraph = (): ConsumedGraph => packageGraph ??= consumedGraph();

/**
 * The consumed package leaves of the consumer at `root` (the workspace root, `<root>/clossys` the consumer), as
 * `<agent>/<id>` keys of Director, Designer and Writer package leaves.
 */
export function consumedLeaves(root: string, graph: ConsumedGraph = packageConsumedGraph()): Set<string> {
  const roots: string[] = [];
  for (const slots of declaredPublications(root).values()) roots.push(...slots);
  roots.push(...publicationReach(root).reached);
  const seen = new Set<string>();
  const queue = [...roots];
  while (queue.length) {
    const key = queue.pop()!;
    if (seen.has(key)) continue;
    seen.add(key);
    // The walk stops at an agent loop slot, as ia.orphans does (CONSISTENCY fix r1).
    if (isAgentLoopKey(key)) continue;
    queue.push(...(graph.edges.get(key) ?? []));
  }
  const out = new Set<string>();
  for (const agent of CONSUMED_AGENTS) for (const id of graph.packages[agent].slots.keys()) if (seen.has(`${agent}/${id}`)) out.add(`${agent}/${id}`);
  return out;
}

/** The consumed leaf ids of one agent. */
export const consumedIds = (consumed: ReadonlySet<string>, agent: ConsumedAgent): Set<string> =>
  new Set([...consumed].filter(key => key.startsWith(`${agent}/`)).map(key => key.slice(agent.length + 1)));

/**
 * `ia` with only the leaves `keep` names: a group left with no leaf is dropped (R01.16 IA-EMPTY-GROUP), an L1 left
 * with no group is dropped, and a layer left with no L1 is dropped. `axes` (the closed L0 and L1 vocabularies, R01.7)
 * is copied unchanged: no axis or axis value is pruned here.
 */
export function filterIa(ia: IaDoc, keep: ReadonlySet<string>): IaDoc {
  const nodes = ia.nodes
    .map(node => ({ ...node, children: node.children.map(child => ({ ...child, slots: child.slots.filter(id => keep.has(id)) })).filter(child => child.slots.length) }))
    .filter(node => node.children.length);
  // A layer names an L1 (`<l1>`) or one L2 group shown as an L1 (`<l1>/<l2>`): it keeps the ones still placed.
  const held = new Set(nodes.flatMap(node => [node.id, ...node.children.map(child => `${node.id}/${child.id}`)]));
  const doc: Record<string, unknown> = { ...ia, nodes };
  if (ia.layers !== undefined) doc.layers = ia.layers.map(layer => ({ ...layer, nodes: layer.nodes.filter(ref => held.has(ref)) })).filter(layer => layer.nodes.length);
  return doc as unknown as IaDoc;
}

/** The package IA of `agent` restricted to `keep` (the IA and its slot map). */
export function filterFoundryIa(pkg: FoundryIa, keep: ReadonlySet<string>): FoundryIa {
  return { agent: pkg.agent, ia: filterIa(pkg.ia, keep), slots: new Map([...pkg.slots].filter(([id]) => keep.has(id))) };
}

export { PACKAGE_IA as CONSUMED_PACKAGE_IA };
