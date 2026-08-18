import type { EntitlementDeclaration } from "./entitlement.js";
import type { InstalledInventory } from "./inventory.js";
import type { ReachabilityVerdict } from "./reachability.js";
import { compareVersions } from "./semver.js";

/**
 * The version reconciler. This is where entitlement, installed inventory, and
 * registry reachability are combined into the one judgment this whole package
 * exists to make.
 *
 * `PackageCurrency` is a discriminated union, one variant per required state,
 * each carrying only the fields that state can truthfully report -- `behind`
 * is the only variant with a `latestVersion`, `absent-with-reason` is the only
 * one with a `reason`. That is deliberate: a wider shape (a single interface
 * with every field optional, tagged by a plain `state: string`) would let a
 * bug construct `{ state: "current", reason: "..." }` and have it silently
 * type-check. This shape does not allow that object literal to exist at all --
 * TypeScript's excess-property check on a literal rejects `reason` on a
 * `current` result -- which is what "enforced in the types, not just in code
 * review" means here.
 */
export type PackageCurrency =
  | { readonly state: "current"; readonly name: string; readonly installedVersion: string }
  | { readonly state: "behind"; readonly name: string; readonly installedVersion: string; readonly latestVersion: string }
  | { readonly state: "absent-with-reason"; readonly name: string; readonly reason: string }
  | { readonly state: "absent-without-reason"; readonly name: string }
  | { readonly state: "unreachable"; readonly name: string }
  | { readonly state: "unauthenticated"; readonly name: string };

export interface JudgeCurrencyInput {
  readonly declaration: EntitlementDeclaration;
  readonly installed: InstalledInventory;
  /** Per-package reachability verdicts, e.g. from `resolveReachability`. A name with no entry is treated the same as an explicit `unreachable` -- an unprobed package is not a confirmed current one. */
  readonly reachability: ReadonlyMap<string, ReachabilityVerdict>;
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
    let comparison: number;
    try {
      comparison = compareVersions(installedPkg.installedVersion, verdict.latestVersion);
    } catch {
      // An unparseable installed or "latest" version cannot be trusted to
      // compare correctly. Reporting a confident current/behind result off a
      // version string we could not even parse would be worse than reporting
      // that we could not determine it.
      results.push({ state: "unreachable", name });
      continue;
    }

    results.push(
      comparison >= 0
        ? { state: "current", name, installedVersion: installedPkg.installedVersion }
        : { state: "behind", name, installedVersion: installedPkg.installedVersion, latestVersion: verdict.latestVersion },
    );
  }
  return results;
}

export interface UpgradeSetEntry {
  readonly name: string;
  readonly installedVersion: string;
  readonly latestVersion: string;
}

/** The "act" step: what a plane would need to install to close the gap. */
export function upgradeSet(statuses: readonly PackageCurrency[]): readonly UpgradeSetEntry[] {
  const entries: UpgradeSetEntry[] = [];
  for (const status of statuses) {
    if (status.state === "behind") entries.push({ name: status.name, installedVersion: status.installedVersion, latestVersion: status.latestVersion });
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
