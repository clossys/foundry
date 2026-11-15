/**
 * Which loop version runs (producer.md 10.1): the consumer pin `clossys/agents/producer/loop.<name>/pin.json`, else the
 * package v1. A version that fails `loop.reachable` never runs: the loader refuses it with its reasons.
 */
import { loopReachableIssues } from "../check/loop-reachable.js";
import type { LoopVersion } from "../records/types.js";
import { readConsumerLoop, readPackageLoop, type LoopFile } from "./files.js";
import type { LoopName } from "./names.js";

export interface LoadedLoop extends LoopFile { readonly content: LoopVersion }
export type LoopLoad = { readonly ok: true; readonly loaded: LoadedLoop } | { readonly ok: false; readonly reason: string };

/** Judges a read file as a runnable version of its loop. */
export function judgeLoopFile(read: LoopFile): LoopLoad {
  const issues = loopReachableIssues(read.loop, read.content, { packageVersion: read.source === "package" });
  if (issues.length) return { ok: false, reason: `${read.ref} fails loop.reachable: ${issues.join("; ")}` };
  return { ok: true, loaded: { ...read, content: read.content as LoopVersion } };
}

export function loadLoopVersion(root: string, loop: LoopName): LoopLoad {
  const pinned = readConsumerLoop(root, loop);
  const read = pinned ?? readPackageLoop(loop);
  if (!read.ok) return read;
  return judgeLoopFile(read);
}
