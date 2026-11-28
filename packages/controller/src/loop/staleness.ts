/**
 * Fingerprinting and staleness (issue #1195): "every artifact records
 * fingerprints of the inputs it was built from, so staleness is a
 * deterministic comparison" and "changes propagate only through
 * dependents." Reuses this package's own content-addressed primitive
 * (`../policy/digest.js`, already shipped from the `./policy` subpath)
 * rather than a second hashing scheme.
 */
import { computeDigest } from "../policy/digest.js";
import type { Fingerprint, UnitRun, UnitRunStatus } from "./types.js";

/** One input this state was built from: its path and its exact content at the time it was read. */
export interface FingerprintInput {
  readonly path: string;
  readonly content: string | Uint8Array;
}

/** Fingerprints every supplied input under sha256. Pure: no filesystem read happens here, only hashing of content the caller already read. */
export function fingerprintInputs(inputs: readonly FingerprintInput[]): Fingerprint {
  const result: Record<string, string> = {};
  for (const input of inputs) result[input.path] = computeDigest(input.content);
  return Object.freeze(result);
}

/**
 * Whether `current` differs from `recorded` at all: a changed digest for a
 * path both sides declare, a path recorded but no longer present, or a new
 * path neither side declared before. Any of the three is staleness --
 * comparing only shared keys would silently treat a dropped or added input
 * as agreement.
 */
export function isStale(recorded: Fingerprint, current: Fingerprint): boolean {
  const keys = new Set([...Object.keys(recorded), ...Object.keys(current)]);
  for (const key of keys) {
    if (recorded[key] !== current[key]) return true;
  }
  return false;
}

/** Which input paths actually changed -- present in one side but not the other, or present in both with a different digest. */
export function changedInputs(recorded: Fingerprint, current: Fingerprint): readonly string[] {
  const keys = new Set([...Object.keys(recorded), ...Object.keys(current)]);
  const changed: string[] = [];
  for (const key of [...keys].sort()) {
    if (recorded[key] !== current[key]) changed.push(key);
  }
  return Object.freeze(changed);
}

/**
 * Given every capability's own declared input paths (from that role's
 * `needs`, plus its own upstream artifacts), which capabilities a set of
 * changed paths actually touches -- issue #1195's "changes propagate only
 * through dependents." A capability with no declared inputs is never
 * affected by an input change; only its own explicit dependency list can
 * put it in the result.
 */
export function affectedCapabilities(
  changedPaths: readonly string[],
  capabilityInputPaths: Readonly<Record<string, readonly string[]>>,
): readonly string[] {
  const changed = new Set(changedPaths);
  const affected: string[] = [];
  for (const [capabilityId, inputPaths] of Object.entries(capabilityInputPaths)) {
    if (inputPaths.some((path) => changed.has(path))) affected.push(capabilityId);
  }
  return Object.freeze(affected.sort());
}

/** How long a launched unit may go with no pushed progress before it is flagged `stale` (CP1-PLANNERRUN): 90 minutes. */
export const UNIT_RUN_STALE_AFTER_MS = 90 * 60 * 1000;

/**
 * A launched unit's position now: `progressed` once its branch's remote head is no longer the head it
 * launched at, else `stale` when the window has passed since launch, else still `launched`. A run that
 * already progressed or failed keeps its status. Pure: the caller supplies the clock and the head it read.
 */
export function unitRunStatus(run: UnitRun, now: Date, currentHead: string | null, staleAfterMs: number = UNIT_RUN_STALE_AFTER_MS): UnitRunStatus {
  if (run.status === "progressed" || run.status === "failed") return run.status;
  if (currentHead !== null && currentHead !== run.headAtLaunch) return "progressed";
  return now.getTime() - new Date(run.at).getTime() >= staleAfterMs ? "stale" : "launched";
}
