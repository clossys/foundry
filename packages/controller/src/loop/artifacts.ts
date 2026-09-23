/**
 * Artifact-operation planning (issue #1195): "create/update: own folder
 * only, by pull request. A human's edit is detected by fingerprint and
 * merged, never overwritten. Move: fixes every reference in the same pull
 * request. Supersede: append-only proof gets a new entry and is never
 * deleted. Retire: only files the role's own manifest lists, and only
 * after checking dependents."
 *
 * Every function here PLANS an operation -- it computes what should change
 * from already-read state and returns a description of it. None of them
 * write a file, open a pull request, or call a provider: that is
 * generative, live-system work, and belongs to the coding agent applying
 * an approved plan, the same boundary `@clossys/launcher` already draws
 * for composing skills and applying an approved plan as pull requests (the
 * owner's own "who does what" governance, #1187). This module is the
 * deterministic mechanics underneath that decision, not the decision or
 * the write.
 */
import { computeDigest } from "../policy/digest.js";

const ROLE_FOLDER_PREFIX = (role: string): string => `clossys/${role.split("/").pop()}/`;

/** A path a role is about to write falls under that role's own `clossys/<role>/` folder -- the one boundary every operation here shares. */
export function isOwnedByRole(role: string, path: string): boolean {
  return path.startsWith(ROLE_FOLDER_PREFIX(role)) && !path.split("/").includes("..");
}

export interface CreateOrUpdatePlan {
  readonly kind: "create" | "update";
  readonly role: string;
  readonly path: string;
  readonly requiresMerge: boolean;
  readonly reason: string;
}

export interface RefusedPlan {
  readonly kind: "refused";
  readonly role: string;
  readonly path: string;
  readonly reason: string;
}

/**
 * Plans a create or update of one role-owned artifact. `existing` is `null`
 * for a create. For an update, `existing.lastWrittenFingerprint` is what
 * THIS role recorded the last time it wrote the file (from
 * `LoopCapabilityState.lastWrittenFingerprints`); when the file's current
 * digest no longer matches that recording, something else changed it since
 * -- a human edit, most often -- and the plan comes back with
 * `requiresMerge: true` instead of a plain overwrite. The caller applying
 * the plan is responsible for actually merging; this function only ever
 * detects that it must.
 */
export function planCreateOrUpdate(input: {
  readonly role: string;
  readonly path: string;
  readonly existing: { readonly content: string | Uint8Array; readonly lastWrittenFingerprint: string | null } | null;
}): CreateOrUpdatePlan | RefusedPlan {
  const { role, path, existing } = input;
  if (!isOwnedByRole(role, path)) {
    return { kind: "refused", role, path, reason: `path is not under this role's own clossys/${role.split("/").pop()}/ folder` };
  }
  if (existing === null) {
    return { kind: "create", role, path, requiresMerge: false, reason: "no file exists at this path yet" };
  }
  const currentDigest = computeDigest(existing.content);
  const requiresMerge = existing.lastWrittenFingerprint === null || existing.lastWrittenFingerprint !== currentDigest;
  return {
    kind: "update",
    role,
    path,
    requiresMerge,
    reason: requiresMerge
      ? "the file's current content does not match what this role last wrote -- merge, do not overwrite"
      : "the file is unchanged since this role's own last write",
  };
}

export interface MovePlan {
  readonly kind: "move";
  readonly role: string;
  readonly fromPath: string;
  readonly toPath: string;
  readonly referencesToFix: readonly string[];
}

/**
 * Plans a move of one role-owned artifact, and names every OTHER file that
 * cites the old path by a plain substring search over already-read
 * content -- issue #1195's own "move: fixes every reference in the same
 * pull request" rule. A citation this misses (a computed path, a renamed
 * variable holding the string) is a gap in the caller-supplied
 * `candidateReferrers` set, not in this function.
 */
export function planMove(input: {
  readonly role: string;
  readonly fromPath: string;
  readonly toPath: string;
  readonly candidateReferrers: readonly { readonly path: string; readonly content: string }[];
}): MovePlan | RefusedPlan {
  const { role, fromPath, toPath, candidateReferrers } = input;
  if (!isOwnedByRole(role, fromPath)) {
    return { kind: "refused", role, path: fromPath, reason: `source is not under this role's own clossys/${role.split("/").pop()}/ folder` };
  }
  if (!isOwnedByRole(role, toPath)) {
    return { kind: "refused", role, path: toPath, reason: `destination is not under this role's own clossys/${role.split("/").pop()}/ folder` };
  }
  const referencesToFix = candidateReferrers
    .filter((referrer) => referrer.path !== fromPath && referrer.content.includes(fromPath))
    .map((referrer) => referrer.path)
    .sort();
  return { kind: "move", role, fromPath, toPath, referencesToFix: Object.freeze(referencesToFix) };
}

export interface SupersedePlan {
  readonly kind: "supersede";
  readonly role: string;
  readonly path: string;
  readonly supersededEntryId: string;
  readonly reason: string;
}

/**
 * Plans superseding one entry in an append-only artifact: a new entry is
 * added, and `supersededEntryId` names what it replaces, but nothing is
 * deleted. The caller applying this plan is responsible for the actual
 * append; this only ever names what happened and what it supersedes, so
 * the record of the supersession is itself never lost.
 */
export function planSupersede(input: { readonly role: string; readonly path: string; readonly supersededEntryId: string }): SupersedePlan | RefusedPlan {
  const { role, path, supersededEntryId } = input;
  if (!isOwnedByRole(role, path)) {
    return { kind: "refused", role, path, reason: `path is not under this role's own clossys/${role.split("/").pop()}/ folder` };
  }
  return { kind: "supersede", role, path, supersededEntryId, reason: `appends a new entry superseding ${supersededEntryId}; the superseded entry is kept, never deleted` };
}

export interface RetirePlan {
  readonly kind: "retire";
  readonly role: string;
  readonly path: string;
}

export interface BlockedRetirePlan {
  readonly kind: "blocked";
  readonly role: string;
  readonly path: string;
  readonly reason: string;
  readonly dependents: readonly { readonly role: string; readonly path: string }[];
}

/**
 * Plans retiring one role-owned artifact. Refuses outright when `path` is
 * not one this role's own manifest lists as an output -- retiring a file
 * no manifest declares would be guessing what this role owns, exactly what
 * `outputs` discovery (issue #1172) exists to never do. Refuses (as
 * `blocked`, not `refused`: the path IS this role's own, the retirement is
 * simply not safe yet) when any dependent still needs this artifact.
 */
export function planRetire(input: {
  readonly role: string;
  readonly path: string;
  readonly manifestOutputs: readonly string[];
  readonly dependents: readonly { readonly role: string; readonly path: string }[];
}): RetirePlan | BlockedRetirePlan | RefusedPlan {
  const { role, path, manifestOutputs, dependents } = input;
  if (!manifestOutputs.includes(path)) {
    return { kind: "refused", role, path, reason: "path is not listed in this role's own manifest outputs" };
  }
  if (dependents.length > 0) {
    return {
      kind: "blocked",
      role,
      path,
      reason: `${dependents.length} dependent(s) still need this artifact`,
      dependents: Object.freeze([...dependents].sort((a, b) => (a.role === b.role ? a.path.localeCompare(b.path) : a.role.localeCompare(b.role)))),
    };
  }
  return { kind: "retire", role, path };
}
