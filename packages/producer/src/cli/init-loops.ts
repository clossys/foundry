/**
 * `clossys init` adopts the loops of every agent the workspace places (foundry-build-0048 U20, owner lean A1: the admin
 * workspace works out of the box, no cold start). After the admin seat, Publisher is always placed (the seat starts its
 * IA); Director, Designer and Writer are placed when their `ia.json` exists. For each, init runs the same adoption
 * `clossys loop` runs (loop.ts adoptAndPinAgentLoops): the agent's loops L1 and five loop slots, each pinned to the
 * agent's package loop candidate through the pin gate on the package-default planner basis. An agent the workspace
 * does not place gets no loop slots (`loop.agent-standard` judges only placed agents), and a loop already pinned is
 * kept, so a second init changes nothing.
 */
import { join } from "node:path";
import { LOOP_AGENTS, type LoopAgent } from "../loop/agent-loops.js";
import { toIsoZ } from "../records/pin.js";
import { iaPath } from "../records/slot-model/layout.js";
import { modelExists } from "../records/slots.js";
import { adoptAndPinAgentLoops } from "./loop.js";

export const INIT_LOOP_BY = "planner:package-default";

export interface InitLoops {
  readonly agents: readonly LoopAgent[];
  readonly adopted: readonly LoopAgent[];
  readonly pinned: readonly string[];
  readonly issues: readonly string[];
}

/** Adopts and pins the loops of every agent the workspace at `root` places; refusals are issues, never thrown. */
export async function adoptInitLoops(root: string, at: string, cwd: string): Promise<InitLoops> {
  const consumer = join(root, "clossys");
  const when = toIsoZ(at) ?? at;
  const agents = LOOP_AGENTS.filter(agent => modelExists(iaPath(consumer, agent)));
  const adopted: LoopAgent[] = [], pinned: string[] = [], issues: string[] = [];
  for (const agent of agents) {
    const own = await adoptAndPinAgentLoops(root, agent, INIT_LOOP_BY, when, cwd);
    if (own.adopted) adopted.push(agent);
    pinned.push(...own.pinned);
    issues.push(...own.issues.map(issue => `${agent}: ${issue}`));
  }
  return { agents, adopted, pinned, issues };
}
