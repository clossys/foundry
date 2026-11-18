/**
 * Which loop version runs (producer.md 10.1): the consumer pin `clossys/agents/producer/loop.<name>/pin.json`, else the
 * package v1. A version that fails `loop.reachable` never runs: the loader refuses it with its reasons.
 * A run for one content agent's slot runs that agent's own version when the consumer holds it (U9a): its pin
 * `clossys/agents/<agent>/loop.<name>/pin.json`, which must extend Producer's standard (agent-loops.ts); an adopted
 * but unpinned or non-conforming agent loop is refused, never replaced by the standard. The agent pin names the
 * Producer loop it was certified against (a `uses` ref the pin gate records); when that is not the Producer loop the
 * consumer runs now (the owner's pin, else package v1), the agent loop is refused until it is recertified.
 */
import { loopReachableIssues } from "../check/loop-reachable.js";
import { knownSlots } from "./known-slots.js";
import type { LoopVersion } from "../records/types.js";
import { readConsumerLoop, readPackageLoop, type LoopFile } from "./files.js";
import type { LoopName } from "./names.js";
import { agentLoopIssues, certificationIssue, isAgentLoop, isLoopAgent, readAgentLoopPin } from "./agent-loops.js";

export interface LoadedLoop extends LoopFile { readonly content: LoopVersion }
export type LoopLoad = { readonly ok: true; readonly loaded: LoadedLoop } | { readonly ok: false; readonly reason: string };

/** Judges a read file as a runnable version of its loop; a consumer version's `when` may also name the consumer's slots under `root`. */
export function judgeLoopFile(read: LoopFile, root?: string): LoopLoad {
  const issues = loopReachableIssues(read.loop, read.content, { packageVersion: read.source === "package", known: knownSlots(read.source === "pin" ? root : undefined) });
  if (issues.length) return { ok: false, reason: `${read.ref} fails loop.reachable: ${issues.join("; ")}` };
  return { ok: true, loaded: { ...read, content: read.content as LoopVersion } };
}

export function loadLoopVersion(root: string, loop: LoopName, agent?: string): LoopLoad {
  if (agent !== undefined && isLoopAgent(agent) && isAgentLoop(loop)) {
    const own = readAgentLoopPin(root, agent, loop);
    if (own) {
      if (!own.ok) return own;
      // U9a fix round 4 (blind1 B2): the pin holds only while it is certified against the Producer loop the consumer
      // runs now; an owner repin of producer/<loop> refuses it until it is recertified (never either version silently).
      const stale = certificationIssue(root, agent, loop, own.ref);
      if (stale !== undefined) return { ok: false, reason: stale };
      const issues = agentLoopIssues(agent, loop, own.content, { root });
      if (issues.length) return { ok: false, reason: `${own.ref} does not extend producer/${loop}: ${issues.join("; ")}` };
      return judgeLoopFile(own, root);
    }
  }
  const pinned = readConsumerLoop(root, loop);
  const read = pinned ?? readPackageLoop(loop);
  if (!read.ok) return read;
  return judgeLoopFile(read, root);
}
