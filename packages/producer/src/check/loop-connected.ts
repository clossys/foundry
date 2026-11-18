/**
 * The agent loop tree checks (foundry-build-0048 U9a, owner 2026-11-17: "each agent is built to standard with their
 * own loops, and all agents are connected via loops overseen by the producer").
 *
 * - `loop.agent-standard`: every content agent's package loop candidates extend Producer's standard loop of the same
 *   name (agent-loops.ts agentLoopIssues). A consumer that holds any of an agent's loop slots holds all five, each
 *   pinned, and each pinned version extends its standard; so does a consumer that places the agent (its ia.json) but
 *   holds none of its loop slots (no vacuous pass): a missing slot, an unpinned slot, or a version that drops
 *   a required step, exit check, failure route or owner-class `when` is a finding.
 * - `loop.connected`: the versions each agent's loops run for this consumer (its pins, else Producer's standard as it
 *   runs for that agent: the standard's steps but other agents' own; never the package candidates the runner does not load)
 *   form one chain overseen by Producer: every agent loop output is read by a Producer connection loop or by another
 *   agent's loop, every Director -> Designer + Writer -> Publisher handoff is a read of what the upstream agent's loops
 *   write, and an agent loop reaches another agent only by a request or a cascade event (agent-loops.ts
 *   loopConnectedIssues).
 */
import { treeResult, type TreeCheck, type TreeCheckResult, type TreeFinding } from "../records/slot.js";
import { AGENT_LOOPS, LOOP_AGENTS, agentLoopIssues, consumerLoopSet, hasAgentLoopSlot, loopConnectedIssues, placesAgent, readAgentLoopPin, readAgentPackageLoop } from "../loop/agent-loops.js";

export const LOOP_AGENT_STANDARD = "loop.agent-standard";
export const LOOP_CONNECTED = "loop.connected";

/** The `<agent>/<loop>` an issue names first, as the finding's subject; the rest is its detail. */
function finding(issue: string, fallback: string): TreeFinding {
  const match = /^([a-z]+\/loop\.[a-z]+|handoff [a-z]+ -> [a-z]+|producer\/loop\.[a-z]+): (.*)$/s.exec(issue);
  return match ? { subject: match[1]!, detail: match[2]! } : { subject: fallback, detail: issue };
}

export function runLoopAgentStandard(root: string): TreeCheckResult {
  const findings: TreeFinding[] = [];
  for (const agent of LOOP_AGENTS) {
    const held = AGENT_LOOPS.filter(loop => hasAgentLoopSlot(root, agent, loop));
    for (const loop of AGENT_LOOPS) {
      const ref = `${agent}/${loop}`;
      const packaged = readAgentPackageLoop(agent, loop);
      if (!packaged.ok) findings.push({ subject: ref, detail: packaged.reason });
      else for (const issue of agentLoopIssues(agent, loop, packaged.content, { packageVersion: true })) findings.push({ subject: packaged.ref, detail: issue });
      // A consumer that places the agent (its IA) or holds one of its loop slots holds all five: no vacuous pass.
      if (!held.length && !placesAgent(root, agent)) continue;
      if (!held.includes(loop)) {
        findings.push({ subject: ref, detail: held.length ? `missing: the consumer holds ${agent}'s ${held.join(", ")} but not ${loop}; run clossys loop ${ref}` : `missing: the consumer places ${agent} but holds none of its loop slots; run clossys loop ${ref}` });
        continue;
      }
      const pinned = readAgentLoopPin(root, agent, loop);
      if (pinned === undefined || !pinned.ok) { findings.push({ subject: ref, detail: pinned?.ok === false ? pinned.reason : `${ref} is not pinned` }); continue; }
      for (const issue of agentLoopIssues(agent, loop, pinned.content, { root })) findings.push({ subject: pinned.ref, detail: issue });
    }
  }
  return treeResult(LOOP_AGENT_STANDARD, findings);
}

export function runLoopConnected(root: string): TreeCheckResult {
  return treeResult(LOOP_CONNECTED, loopConnectedIssues(consumerLoopSet(root)).map(issue => finding(issue, "loops")));
}

export const loopAgentStandard: TreeCheck = { id: LOOP_AGENT_STANDARD, run: runLoopAgentStandard };
export const loopConnected: TreeCheck = { id: LOOP_CONNECTED, run: runLoopConnected };
