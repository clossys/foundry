/**
 * Composing one installation plan from several independently-owned sources.
 *
 * Everything in `runtime.ts` and `apply.ts` assumes one `sourceRoot` and one
 * plan. That is still the right shape for a single caller installing its own
 * manifest, and nothing here changes it: `loadManifest`, `createRuntimeContext`,
 * `planInstallation`, `applyInstallation`, and `verifyInstallation` are
 * untouched, and a caller who never heard of this module keeps working
 * unchanged. See this package's README for that compatibility path.
 *
 * A caller composing several sources — several account-owned workspace
 * checkouts, each with its own manifest and its own `sourceRoot` — builds one
 * `Plan` per source with the existing functions, tags each with the name it
 * asked to be known by, and hands the named plans here. This module never
 * discovers a source and never resolves a policy about which source wins a
 * conflicting destination; it only composes what it is given, and refuses to
 * proceed the moment two sources claim the same one. That is deliberate: see
 * this package's README for the boundary this keeps (no account discovery, no
 * precedence policy) and the manifest engine's own header for why "two
 * entries owning one destination" is refused rather than merged.
 */

import type {
  ApplyOptions,
  ApplyResult,
  FileSystemPort,
  Finding,
  Plan,
  PlanOperation,
} from "./types.js";
import { applyInstallation } from "./apply.js";
import { verifyInstallation } from "./verify.js";

/** One source's already-computed plan, tagged with the identifier it asked to be known by. */
export interface NamedSourcePlan {
  /** The identifier this source requested operations under. Opaque to this module — never validated against any registry, because this module discovers no sources and knows no registry. */
  readonly source: string;
  readonly plan: Plan;
}

/** A `PlanOperation` with the source that requested it attached. */
export interface ComposedPlanOperation extends PlanOperation {
  readonly source: string;
}

/** A `Finding` with the source whose plan it was found against attached. */
export interface ComposedFinding extends Finding {
  readonly source: string;
}

/**
 * One destination two or more sources both planned to manage, and every
 * source that claimed it. This is the evidence a caller needs to resolve the
 * conflict; resolving it is the caller's job, not this module's — see the
 * module header.
 */
export interface DestinationCollision {
  readonly destinationPath: string;
  /** Every source that claimed this destination, sorted for a stable report. */
  readonly sources: readonly string[];
}

export interface ComposedPlan {
  readonly operations: readonly ComposedPlanOperation[];
}

/**
 * Thrown by `composeInstallationPlans` (and, transitively, by
 * `applyComposedInstallation`/`verifyComposedInstallation`, which validate
 * before touching a filesystem) when two or more sources claim the same
 * destination. `collisions` names every offending destination and every
 * contributing source — never a last-writer-wins guess.
 */
export class DestinationCollisionError extends Error {
  readonly collisions: readonly DestinationCollision[];

  constructor(collisions: readonly DestinationCollision[]) {
    super(DestinationCollisionError.describe(collisions));
    this.name = "DestinationCollisionError";
    this.collisions = collisions;
  }

  private static describe(collisions: readonly DestinationCollision[]): string {
    const lines = collisions.map(
      (c) => `  ${c.destinationPath}: claimed by ${c.sources.join(", ")}`,
    );
    return `Destination collision across sources — planning refuses to merge, never last-writer-wins:\n${lines.join("\n")}`;
  }
}

/**
 * Compose several named sources' already-computed plans into one, attaching
 * provenance to every operation.
 *
 * Pure: no filesystem access, same as `planInstallation`. This is the "plan"
 * half of the safety split this package keeps everywhere — compose first,
 * inspect or diff the result, then apply.
 *
 * `privateDirectories` operations are exempt from collision detection.
 * Ensuring a directory exists with the required mode is idempotent and
 * non-destructive regardless of which source asks for it or how many do —
 * unlike a link, copy, or managed block, a private-directory operation never
 * overwrites content another source owns, so two sources both asking for the
 * same directory to exist is not a conflict to report. `loadManifest` draws
 * the identical line for a single manifest's own destinations (see its
 * `destinations` collision check), and composing several sources' plans keeps
 * that same line rather than inventing a stricter one.
 *
 * Throws `DestinationCollisionError` when any non-private-directory
 * destination is claimed by more than one source. Throws a plain `Error` when
 * a source identifier is empty, repeated across `namedPlans`, or — within one
 * source's own plan — repeated on a non-private-directory destination
 * (a defect `loadManifest` would normally have caught already; checked again
 * here in case a plan was built by hand rather than from a validated
 * manifest).
 */
export function composeInstallationPlans(namedPlans: readonly NamedSourcePlan[]): ComposedPlan {
  if (namedPlans.length === 0) {
    throw new Error("composeInstallationPlans requires at least one named source plan");
  }

  const seenSources = new Set<string>();
  for (const { source } of namedPlans) {
    if (typeof source !== "string" || source.trim() === "") {
      throw new Error("Each named source plan must declare a non-empty source identifier");
    }
    if (seenSources.has(source)) {
      throw new Error(`Duplicate source identifier: ${source}`);
    }
    seenSources.add(source);
  }

  const claimants = new Map<string, Set<string>>();
  const operations: ComposedPlanOperation[] = [];

  for (const { source, plan } of namedPlans) {
    const claimedByThisSource = new Set<string>();
    for (const operation of plan.operations) {
      operations.push({ ...operation, source });

      if (operation.kind === "private-directory") continue;

      if (claimedByThisSource.has(operation.destinationPath)) {
        throw new Error(
          `Source "${source}" manages destination more than once: ${operation.destinationPath}`,
        );
      }
      claimedByThisSource.add(operation.destinationPath);

      const claimSet = claimants.get(operation.destinationPath) ?? new Set<string>();
      claimSet.add(source);
      claimants.set(operation.destinationPath, claimSet);
    }
  }

  const collisions: DestinationCollision[] = [];
  for (const [destinationPath, sources] of claimants) {
    if (sources.size > 1) {
      collisions.push({ destinationPath, sources: [...sources].sort() });
    }
  }
  if (collisions.length > 0) {
    collisions.sort((a, b) => a.destinationPath.localeCompare(b.destinationPath));
    throw new DestinationCollisionError(collisions);
  }

  return { operations: Object.freeze(operations) };
}

/**
 * Apply several named sources' plans as one installation.
 *
 * Validates the full composition — and so raises `DestinationCollisionError`
 * for any colliding destination — before a single filesystem call is made:
 * a conflict is never discovered halfway through an apply. Once validated,
 * each source's plan is applied through the unmodified, already-tested
 * `applyInstallation`, in the order `namedPlans` supplies, sharing one
 * `backupRoot`. Because collision-free composition guarantees no destination
 * is touched by more than one source, applying sources one at a time this way
 * is equivalent to applying one interleaved plan for every destination that
 * does not depend on another source's own output.
 *
 * That last clause is a real, documented limit, not an oversight: a chained
 * link (a `links` entry declared with `target`) or a copy/managed-block
 * destination nested inside another source's private directory can only
 * resolve correctly if the source it depends on has already been applied.
 * This module does not detect or order around such a cross-source
 * dependency — doing so would mean inventing a precedence policy across
 * sources, which is exactly what this package's boundaries rule out (see the
 * module header). A caller with a genuine cross-source dependency is
 * responsible for supplying `namedPlans` in an order that satisfies it, or
 * for not creating the dependency at all.
 */
export function applyComposedInstallation(
  namedPlans: readonly NamedSourcePlan[],
  fs: FileSystemPort,
  options: ApplyOptions,
): ApplyResult {
  composeInstallationPlans(namedPlans);

  const changed: PlanOperation[] = [];
  const unchanged: PlanOperation[] = [];
  for (const { plan } of namedPlans) {
    const result = applyInstallation(plan, fs, options);
    changed.push(...result.changed);
    unchanged.push(...result.unchanged);
  }
  return { changed, unchanged, backupRoot: options.backupRoot };
}

/**
 * Verify several named sources' plans against the machine, with every finding
 * attributed to the source whose plan produced it.
 *
 * Validates the full composition first, for the same reason
 * `applyComposedInstallation` does: a caller should learn about a destination
 * collision before trusting a per-source drift report that never accounted
 * for it. Each source's plan is then verified through the unmodified
 * `verifyInstallation`, which reads the machine rather than the manifest —
 * unchanged here.
 */
export function verifyComposedInstallation(
  namedPlans: readonly NamedSourcePlan[],
  fs: FileSystemPort,
): readonly ComposedFinding[] {
  composeInstallationPlans(namedPlans);

  const findings: ComposedFinding[] = [];
  for (const { source, plan } of namedPlans) {
    for (const finding of verifyInstallation(plan, fs)) {
      findings.push({ ...finding, source });
    }
  }
  return findings;
}
