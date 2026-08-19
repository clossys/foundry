import type { EntitlementDeclaration } from "./entitlement.js";
import type { InstalledInventory } from "./inventory.js";
import type { ReachabilityVerdict } from "./reachability.js";
import { parseVersion, type ParsedVersion } from "./semver.js";

/**
 * The version reconciler. This is where entitlement, installed inventory, and
 * registry reachability are combined into the one judgment this whole package
 * exists to make.
 *
 * `PackageCurrency` is a discriminated union, one variant per required state,
 * each carrying only the fields that state can truthfully report -- `behind`
 * is the only variant with a `latestVersion` (and the `severity` that grades
 * it), `absent-with-reason` is the only one with a `reason`. That is
 * deliberate: a wider shape (a single interface with every field optional,
 * tagged by a plain `state: string`) would let a bug construct
 * `{ state: "current", reason: "..." }` and have it silently type-check. This
 * shape does not allow that object literal to exist at all -- TypeScript's
 * excess-property check on a literal rejects `reason` on a `current` result
 * -- which is what "enforced in the types, not just in code review" means
 * here.
 *
 * GRADED SEVERITY. A `behind` result is not one undifferentiated "drift"
 * finding -- it is graded by how much the published version actually
 * promises to have changed, using ordinary semver meaning:
 *
 *   patch  (x.y.Z, major >= 1) -> `severity: "patch"`
 *   minor  (x.Y.z, major >= 1) -> `severity: "minor"`
 *   major  (X.y.z)             -> `severity: "major"`
 *   pre-1.0 (0.y.z) minor bump -> `severity: "major"` (semver explicitly
 *                                  permits a 0.y minor bump to break -- there
 *                                  is no "safe" minor bump below 1.0.0)
 *
 * A caller building a gate out of these statuses decides what each severity
 * means for its own pass/fail policy (see `classifyCurrencyDistance`'s own
 * doc comment) -- this package supplies the grading, never the policy of
 * which grades block a merge.
 *
 * A version this package cannot safely grade at all -- unparseable, or
 * carrying a prerelease identifier this comparator will not guess an
 * ordering for -- is never folded into `current` or `behind`. It is its own
 * `indeterminate` state, with a machine-readable `reason`, so a caller can
 * never mistake "could not be evaluated" for "evaluated and fine".
 */
export type CurrencySeverity = "patch" | "minor" | "major";

/** The four gradable outcomes `classifyCurrencyDistance` can report for a comparable pair. */
export type CurrencyDistance = "current" | CurrencySeverity;

/** Why `classifyCurrencyDistance` could not grade a pair at all. */
export type CurrencyIndeterminateReason = "version-unparseable" | "version-not-comparable";

export type ClassifyCurrencyDistanceResult =
  | { readonly kind: "graded"; readonly distance: CurrencyDistance }
  | { readonly kind: "indeterminate"; readonly reason: CurrencyIndeterminateReason };

export type PackageCurrency =
  | { readonly state: "current"; readonly name: string; readonly installedVersion: string }
  | {
      readonly state: "behind";
      readonly name: string;
      readonly installedVersion: string;
      readonly latestVersion: string;
      readonly severity: CurrencySeverity;
    }
  | { readonly state: "absent-with-reason"; readonly name: string; readonly reason: string }
  | { readonly state: "absent-without-reason"; readonly name: string }
  | { readonly state: "unreachable"; readonly name: string }
  | { readonly state: "unauthenticated"; readonly name: string }
  | { readonly state: "indeterminate"; readonly name: string; readonly reason: CurrencyIndeterminateReason };

export interface JudgeCurrencyInput {
  readonly declaration: EntitlementDeclaration;
  readonly installed: InstalledInventory;
  /** Per-package reachability verdicts, e.g. from `resolveReachability`. A name with no entry is treated the same as an explicit `unreachable` -- an unprobed package is not a confirmed current one. */
  readonly reachability: ReadonlyMap<string, ReachabilityVerdict>;
}

/**
 * The one place this package decides how much a version delta actually
 * promises to have changed. `installedVersion`/`latestVersion` are raw
 * version strings, never pre-parsed -- this function owns parsing them and
 * never throws: a version this comparator cannot safely order is reported as
 * `{ kind: "indeterminate", reason }`, never guessed at.
 *
 * An installed version AHEAD of `latestVersion` (the registry's own `latest`
 * dist-tag resolves to something older than what is installed -- e.g. a
 * pinned prerelease channel, or a registry view lagging behind what was
 * actually installed from elsewhere) grades as `"current"`, never a negative
 * distance. This function only ever reports how far BEHIND an installation
 * is; it does not have an opinion on being ahead.
 *
 * A prerelease identifier on either side (`1.0.0-beta.1`) has no ordering
 * this function is willing to guess at against a plain release, so it is
 * always `indeterminate` with reason `"version-not-comparable"` -- never
 * silently treated as ahead, behind, or equal.
 */
export function classifyCurrencyDistance(installedVersion: string, latestVersion: string): ClassifyCurrencyDistanceResult {
  let installed: ParsedVersion;
  let latest: ParsedVersion;
  try {
    installed = parseVersion(installedVersion);
    latest = parseVersion(latestVersion);
  } catch {
    return { kind: "indeterminate", reason: "version-unparseable" };
  }

  if (installed.prerelease.length > 0 || latest.prerelease.length > 0) {
    return { kind: "indeterminate", reason: "version-not-comparable" };
  }

  if (latest.major > installed.major) return { kind: "graded", distance: "major" };
  if (latest.major < installed.major) return { kind: "graded", distance: "current" }; // installed is ahead; never reported as behind

  if (installed.major === 0) {
    // Pre-1.0: semver explicitly permits a 0.y minor bump to break. There is
    // no "safe" minor bump below 1.0.0, so it grades the same as a major bump.
    if (latest.minor > installed.minor) return { kind: "graded", distance: "major" };
    if (latest.minor < installed.minor) return { kind: "graded", distance: "current" };
    if (latest.patch > installed.patch) return { kind: "graded", distance: "patch" };
    return { kind: "graded", distance: "current" };
  }

  if (latest.minor > installed.minor) return { kind: "graded", distance: "minor" };
  if (latest.minor < installed.minor) return { kind: "graded", distance: "current" };
  if (latest.patch > installed.patch) return { kind: "graded", distance: "patch" };
  return { kind: "graded", distance: "current" };
}

/**
 * Judge every entitled package's currency. Every entitlement is reported --
 * this never stops at the first problem, because, same as
 * `@vespeneventures/provisioning`'s `verifyInstallation`, a drift report is
 * only useful when it is complete.
 *
 * Absence is judged BEFORE reachability is even consulted: whether a package
 * is installed, and whether its absence has a recorded reason, are both facts
 * a plane already holds about itself offline. Only `current` vs `behind`
 * needs the registry at all, which is exactly the shape the blindness rule
 * demands -- the parts of this judgment that do not need the network do not
 * touch it.
 */
export function judgeCurrency(input: JudgeCurrencyInput): readonly PackageCurrency[] {
  const installedByName = new Map(input.installed.packages.map((pkg) => [pkg.name, pkg] as const));
  const optOutByName = new Map(input.declaration.optOuts.map((optOut) => [optOut.name, optOut] as const));

  const results: PackageCurrency[] = [];
  for (const entitlement of input.declaration.entitlements) {
    const name = entitlement.name;
    const installedPkg = installedByName.get(name);

    if (installedPkg === undefined) {
      const optOut = optOutByName.get(name);
      results.push(optOut === undefined ? { state: "absent-without-reason", name } : { state: "absent-with-reason", name, reason: optOut.reason });
      continue;
    }

    const verdict = input.reachability.get(name);
    if (verdict === undefined || verdict.kind === "unreachable") {
      results.push({ state: "unreachable", name });
      continue;
    }
    if (verdict.kind === "unauthenticated") {
      results.push({ state: "unauthenticated", name });
      continue;
    }

    // verdict.kind === "known" from here.
    const classification = classifyCurrencyDistance(installedPkg.installedVersion, verdict.latestVersion);
    if (classification.kind === "indeterminate") {
      // An unparseable installed or "latest" version, or a prerelease
      // identifier on either side, cannot be trusted to compare correctly.
      // Reporting a confident current/behind result off a version we could
      // not safely order would be worse than reporting that we could not
      // determine it.
      results.push({ state: "indeterminate", name, reason: classification.reason });
      continue;
    }

    results.push(
      classification.distance === "current"
        ? { state: "current", name, installedVersion: installedPkg.installedVersion }
        : {
            state: "behind",
            name,
            installedVersion: installedPkg.installedVersion,
            latestVersion: verdict.latestVersion,
            severity: classification.distance,
          },
    );
  }
  return results;
}

export interface UpgradeSetEntry {
  readonly name: string;
  readonly installedVersion: string;
  readonly latestVersion: string;
  readonly severity: CurrencySeverity;
}

/** The "act" step: what a plane would need to install to close the gap. */
export function upgradeSet(statuses: readonly PackageCurrency[]): readonly UpgradeSetEntry[] {
  const entries: UpgradeSetEntry[] = [];
  for (const status of statuses) {
    if (status.state === "behind") {
      entries.push({ name: status.name, installedVersion: status.installedVersion, latestVersion: status.latestVersion, severity: status.severity });
    }
  }
  return entries;
}

/** The other half of the "act" step: entitled, absent, and with nothing recorded to explain why. */
export function optOutGaps(statuses: readonly PackageCurrency[]): readonly string[] {
  const names: string[] = [];
  for (const status of statuses) {
    if (status.state === "absent-without-reason") names.push(status.name);
  }
  return names;
}

export interface CurrencyMetric {
  /** Entitled packages installed and at the latest published version, over every entitled package. Zero when there are no entitlements at all, rather than division by zero. */
  readonly currencyShare: number;
  readonly entitledCount: number;
  readonly currentCount: number;
  /** Reported separately from `currencyShare`, per the metric definition: entitled, absent, no recorded opt-out. */
  readonly absentWithoutReasonCount: number;
}

function assertNeverState(value: never): never {
  throw new Error(`Unhandled currency state: ${JSON.stringify(value)}`);
}

/**
 * The package's stated metric: `currencyShare` is the share of entitled
 * packages installed and at the latest published version; `absentWithoutReasonCount`
 * is the entitled-and-absent-with-no-recorded-opt-out count, reported
 * separately rather than folded into the share, because an unexplained
 * absence is a different kind of problem than a stale install and conflating
 * them into one number would hide which one a plane actually has.
 */
export function computeCurrencyMetric(statuses: readonly PackageCurrency[]): CurrencyMetric {
  let currentCount = 0;
  let absentWithoutReasonCount = 0;
  for (const status of statuses) {
    switch (status.state) {
      case "current":
        currentCount += 1;
        break;
      case "absent-without-reason":
        absentWithoutReasonCount += 1;
        break;
      case "behind":
      case "absent-with-reason":
      case "unreachable":
      case "unauthenticated":
      case "indeterminate":
        break;
      default:
        assertNeverState(status);
    }
  }
  const entitledCount = statuses.length;
  return {
    entitledCount,
    currentCount,
    absentWithoutReasonCount,
    currencyShare: entitledCount === 0 ? 0 : currentCount / entitledCount,
  };
}
