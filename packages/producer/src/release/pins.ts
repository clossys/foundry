/**
 * The pins a release is made of: every consumer slot (and every record of a Writer record slot) as it resolves now
 * (records/resolve.ts), keyed `<agent>/<slot-id>[#record]`. A consumer pin is `<candidate>@<sha256>`, a package
 * default `package:<candidate>@<sha256>`, an unresolved slot `unresolved`. Full digests, so a manifest can be
 * checked against the bytes (the spec's excerpt shows them shortened to 8).
 *
 * Release slots are left out: a manifest cannot list the pin that marks it ready. Retired slots are left out, as
 * `pins.resolve` skips them.
 */
import { resolveAll } from "../check/pins-resolve.js";
import type { Resolution } from "../records/resolve.js";
import { RELEASE_SLOT } from "./paths.js";

export type PinMapOf = Record<string, string>;

export const refOf = (resolution: Pick<Resolution, "agent" | "slotId" | "record">): string =>
  `${resolution.agent}/${resolution.slotId}${resolution.record !== undefined ? `#${resolution.record}` : ""}`;

export function pinValue(resolution: Resolution): string {
  if (resolution.state === "pinned") return `${resolution.candidate}@${resolution.sha256}`;
  if (resolution.state === "sample") return `package:${resolution.candidate}@${resolution.sha256}`;
  return "unresolved";
}

/** True for a release slot, whose pin is never part of a release's inputs. */
export const isReleaseSlot = (agent: string, slotId: string): boolean => agent === "publisher" && RELEASE_SLOT.test(slotId);

/** Every resolution a release reads, in agent then slot order. */
export function releaseResolutions(root: string): Resolution[] {
  return resolveAll(root).filter(resolution => !isReleaseSlot(resolution.agent, resolution.slotId));
}

/** The release's pins now, keys sorted. */
export function currentPins(root: string): PinMapOf {
  const rows = releaseResolutions(root).map(resolution => [refOf(resolution), pinValue(resolution)] as const);
  return Object.fromEntries([...rows].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

/** Every difference between two pin maps, as `{ref, from, to}` (null for an added or removed ref), keys sorted. */
export function pinDiff(from: PinMapOf, to: PinMapOf): { ref: string; from: string | null; to: string | null }[] {
  const keys = [...new Set([...Object.keys(from), ...Object.keys(to)])].sort();
  return keys.filter(key => from[key] !== to[key]).map(ref => ({ ref, from: from[ref] ?? null, to: to[ref] ?? null }));
}
