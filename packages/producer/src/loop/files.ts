/**
 * Loop version files, read without judging them (version.ts judges them through `loop.reachable`):
 *
 * - the package v1 of each loop, `packages/producer/loops/loop.<name>/<name>-v1.json`, read from this installed
 *   Producer package (a consumer never ships its own copy);
 * - the consumer pin, `clossys/agents/producer/loop.<name>/pin.json`, naming one of
 *   `clossys/agents/producer/loop.<name>/candidates/<name>-v<n>.json`. With no pin, package v1 runs.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { readCandidateFile } from "../records/candidate.js";
import { PRODUCER_ROOT } from "../package-path.js";
import { resolveSlot } from "../records/resolve.js";
import { pinPath } from "../records/pin.js";
import type { CandidateName, Sha256 } from "../records/types.js";
import { loopStem, type LoopName } from "./names.js";

export interface LoopFile {
  readonly ok: true;
  readonly loop: LoopName;
  readonly source: "pin" | "package";
  readonly candidate: CandidateName;
  /** `producer/loop.<name>/<candidate>` or `producer/loop.<name>/package:<candidate>`. */
  readonly ref: string;
  readonly file: string;
  readonly sha256: Sha256;
  readonly content: unknown;
}
export type LoopFileRead = LoopFile | { readonly ok: false; readonly reason: string };

/** The package loops folder of this installed Producer package. */
export const PACKAGE_LOOPS_DIR = join(PRODUCER_ROOT, "loops");
export const packageLoopFile = (loop: LoopName): string => join(PACKAGE_LOOPS_DIR, loop, `${loopStem(loop)}-v1.json`);

function readVersionFile(file: string, loop: LoopName, source: "pin" | "package"): LoopFileRead {
  if (!existsSync(file)) return { ok: false, reason: `${loop}: ${file} does not exist` };
  const read = readCandidateFile(file, { agent: "producer", slotId: loop, packageDefault: source === "package" });
  if (read.issues.length) return { ok: false, reason: `${loop}: ${read.name}: ${read.issues.join("; ")}` };
  let content: unknown;
  try { content = (JSON.parse(readFileSync(file, "utf8")) as { content?: unknown }).content; } catch (error) {
    return { ok: false, reason: `${loop}: ${read.name} is not JSON: ${error instanceof Error ? error.message : String(error)}` };
  }
  const ref = `producer/${loop}/${source === "package" ? "package:" : ""}${read.name}`;
  return { ok: true, loop, source, candidate: read.name as CandidateName, ref, file, sha256: read.sha256 as Sha256, content };
}

export function readPackageLoop(loop: LoopName): LoopFileRead {
  return readVersionFile(packageLoopFile(loop), loop, "package");
}

/** The consumer's pinned version; undefined when the consumer pins none (package v1 runs). A broken pin is an error, never a silent fallback. */
export function readConsumerLoop(root: string, loop: LoopName): LoopFileRead | undefined {
  if (!existsSync(pinPath(root, "producer", loop))) return undefined;
  const resolved = resolveSlot(root, "producer", loop);
  if (resolved.state !== "pinned") {
    const reason = resolved.pinIssue ?? (resolved.state === "unresolved" ? resolved.reason : "the pin does not resolve");
    return { ok: false, reason: `${loop}: the consumer pin does not resolve: ${reason}` };
  }
  return readVersionFile(resolved.file, loop, "pin");
}
