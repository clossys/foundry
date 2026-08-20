import { describe, expect, it } from "vitest";
import { classifyCurrencyDistance, computeCurrencyMetric, judgeCurrency, optOutGaps, upgradeSet, type PackageCurrency, type CurrencySeverity, currencyVerdict, currencyVerdictToExitCode } from "./currency.js";
import type { EntitlementDeclaration } from "./entitlement.js";
import type { InstalledInventory } from "./inventory.js";
import type { ReachabilityVerdict } from "./reachability.js";

function declaration(entitlements: string[], optOuts: { name: string; reason: string }[] = []): EntitlementDeclaration {
  return {
    version: 1,
    entitlements: entitlements.map((name) => ({ name })),
    optOuts: optOuts.map((o) => ({ name: o.name, reason: o.reason })),
  };
}

function installed(packages: { name: string; installedVersion: string }[]): InstalledInventory {
  return { packages: packages.map((p) => ({ name: p.name, declaredRange: "*", installedVersion: p.installedVersion })) };
}

// ---------------------------------------------------------------------------
// classifyCurrencyDistance -- the graded-severity ternary this issue asked for
// ---------------------------------------------------------------------------

describe("classifyCurrencyDistance", () => {
  it("grades a same-version pair as current", () => {
    expect(classifyCurrencyDistance("1.4.2", "1.4.2")).toEqual({ kind: "graded", distance: "current" });
  });

  it("grades a patch bump (>=1.0) as patch", () => {
    expect(classifyCurrencyDistance("1.4.2", "1.4.9")).toEqual({ kind: "graded", distance: "patch" });
  });

  it("grades a minor bump (>=1.0) as minor", () => {
    expect(classifyCurrencyDistance("1.4.2", "1.5.0")).toEqual({ kind: "graded", distance: "minor" });
  });

  it("grades a major bump as major", () => {
    expect(classifyCurrencyDistance("1.4.2", "2.0.0")).toEqual({ kind: "graded", distance: "major" });
  });

  it("grades a pre-1.0 patch bump (same 0.y) as patch", () => {
    expect(classifyCurrencyDistance("0.1.2", "0.1.9")).toEqual({ kind: "graded", distance: "patch" });
  });

  it("grades a pre-1.0 MINOR bump as major -- semver permits it to break", () => {
    expect(classifyCurrencyDistance("0.5.0", "0.7.1")).toEqual({ kind: "graded", distance: "major" });
  });

  it("grades crossing 0.x -> 1.0.0 as major", () => {
    expect(classifyCurrencyDistance("0.9.0", "1.0.0")).toEqual({ kind: "graded", distance: "major" });
  });

  it("grades an installed version ahead of latest as current, never behind", () => {
    expect(classifyCurrencyDistance("2.0.0", "1.9.0")).toEqual({ kind: "graded", distance: "current" });
    expect(classifyCurrencyDistance("0.7.1", "0.5.0")).toEqual({ kind: "graded", distance: "current" });
    expect(classifyCurrencyDistance("1.4.9", "1.4.2")).toEqual({ kind: "graded", distance: "current" });
  });

  it("is indeterminate, never guessed, for an unparseable version on either side", () => {
    expect(classifyCurrencyDistance("not-a-version", "1.0.0")).toEqual({ kind: "indeterminate", reason: "version-unparseable" });
    expect(classifyCurrencyDistance("1.0.0", "also-not-a-version")).toEqual({ kind: "indeterminate", reason: "version-unparseable" });
    expect(classifyCurrencyDistance("1.0", "1.0.0")).toEqual({ kind: "indeterminate", reason: "version-unparseable" });
  });

  it("is indeterminate, never guessed, when either side carries a prerelease identifier", () => {
    expect(classifyCurrencyDistance("1.0.0-beta.1", "1.0.0")).toEqual({ kind: "indeterminate", reason: "version-not-comparable" });
    expect(classifyCurrencyDistance("1.0.0", "1.1.0-rc.1")).toEqual({ kind: "indeterminate", reason: "version-not-comparable" });
    expect(classifyCurrencyDistance("1.0.0-alpha", "1.0.0-beta")).toEqual({ kind: "indeterminate", reason: "version-not-comparable" });
  });
});

// ---------------------------------------------------------------------------
// judgeCurrency
// ---------------------------------------------------------------------------

describe("judgeCurrency", () => {
  it("reports current when the installed version is the latest known", () => {
    const results = judgeCurrency({
      declaration: declaration(["a"]),
      installed: installed([{ name: "a", installedVersion: "1.2.0" }]),
      reachability: new Map<string, ReachabilityVerdict>([["a", { kind: "known", latestVersion: "1.2.0" }]]),
    });
    expect(results).toEqual([{ state: "current", name: "a", installedVersion: "1.2.0" }]);
  });

  it("reports current, not behind, when the installed version is ahead of latest", () => {
    const results = judgeCurrency({
      declaration: declaration(["a"]),
      installed: installed([{ name: "a", installedVersion: "1.3.0" }]),
      reachability: new Map<string, ReachabilityVerdict>([["a", { kind: "known", latestVersion: "1.2.0" }]]),
    });
    expect(results).toEqual([{ state: "current", name: "a", installedVersion: "1.3.0" }]);
  });

  it("reports behind, graded patch, for a patch-only gap at >=1.0", () => {
    const results = judgeCurrency({
      declaration: declaration(["a"]),
      installed: installed([{ name: "a", installedVersion: "1.0.0" }]),
      reachability: new Map<string, ReachabilityVerdict>([["a", { kind: "known", latestVersion: "1.0.4" }]]),
    });
    expect(results).toEqual([{ state: "behind", name: "a", installedVersion: "1.0.0", latestVersion: "1.0.4", severity: "patch" }]);
  });

  it("reports behind, graded minor, for a minor gap at >=1.0", () => {
    const results = judgeCurrency({
      declaration: declaration(["a"]),
      installed: installed([{ name: "a", installedVersion: "1.0.0" }]),
      reachability: new Map<string, ReachabilityVerdict>([["a", { kind: "known", latestVersion: "1.2.0" }]]),
    });
    expect(results).toEqual([{ state: "behind", name: "a", installedVersion: "1.0.0", latestVersion: "1.2.0", severity: "minor" }]);
  });

  it("reports behind, graded major, for a major gap", () => {
    const results = judgeCurrency({
      declaration: declaration(["a"]),
      installed: installed([{ name: "a", installedVersion: "1.0.0" }]),
      reachability: new Map<string, ReachabilityVerdict>([["a", { kind: "known", latestVersion: "2.0.0" }]]),
    });
    expect(results).toEqual([{ state: "behind", name: "a", installedVersion: "1.0.0", latestVersion: "2.0.0", severity: "major" }]);
  });

  it("reports behind, graded major, for a pre-1.0 minor gap -- the case this issue exists to fix", () => {
    const results = judgeCurrency({
      declaration: declaration(["a"]),
      installed: installed([{ name: "a", installedVersion: "0.6.0" }]),
      reachability: new Map<string, ReachabilityVerdict>([["a", { kind: "known", latestVersion: "0.7.0" }]]),
    });
    expect(results).toEqual([{ state: "behind", name: "a", installedVersion: "0.6.0", latestVersion: "0.7.0", severity: "major" }]);
  });

  it("reports indeterminate, never a guessed current or behind, for an unparseable installed version", () => {
    const results = judgeCurrency({
      declaration: declaration(["a"]),
      installed: installed([{ name: "a", installedVersion: "not-a-version" }]),
      reachability: new Map<string, ReachabilityVerdict>([["a", { kind: "known", latestVersion: "1.0.0" }]]),
    });
    expect(results).toEqual([{ state: "indeterminate", name: "a", reason: "version-unparseable" }]);
  });

  it("reports indeterminate, never a guessed current or behind, for an unparseable latest version", () => {
    const results = judgeCurrency({
      declaration: declaration(["a"]),
      installed: installed([{ name: "a", installedVersion: "1.0.0" }]),
      reachability: new Map<string, ReachabilityVerdict>([["a", { kind: "known", latestVersion: "not-a-version" }]]),
    });
    expect(results).toEqual([{ state: "indeterminate", name: "a", reason: "version-unparseable" }]);
  });

  it("reports indeterminate for a prerelease latest version, never folding it into current or behind", () => {
    const results = judgeCurrency({
      declaration: declaration(["a"]),
      installed: installed([{ name: "a", installedVersion: "1.0.0" }]),
      reachability: new Map<string, ReachabilityVerdict>([["a", { kind: "known", latestVersion: "1.1.0-rc.1" }]]),
    });
    expect(results).toEqual([{ state: "indeterminate", name: "a", reason: "version-not-comparable" }]);
  });

  it("distinguishes absent-with-reason from absent-without-reason -- the whole point", () => {
    const results = judgeCurrency({
      declaration: declaration(["a", "b"], [{ name: "a", reason: "Not needed by this plane." }]),
      installed: installed([]),
      reachability: new Map(),
    });
    expect(results).toEqual([
      { state: "absent-with-reason", name: "a", reason: "Not needed by this plane." },
      { state: "absent-without-reason", name: "b" },
    ]);
  });

  it("judges absence without ever consulting reachability -- absence is an offline fact", () => {
    const results = judgeCurrency({
      declaration: declaration(["a"], [{ name: "a", reason: "deliberate" }]),
      installed: installed([]),
      reachability: new Map<string, ReachabilityVerdict>([["a", { kind: "unreachable" }]]),
    });
    expect(results).toEqual([{ state: "absent-with-reason", name: "a", reason: "deliberate" }]);
  });

  it("reports unreachable, never absent-without-reason or not-entitled, when an installed package's registry lookup could not be trusted", () => {
    const results = judgeCurrency({
      declaration: declaration(["a"]),
      installed: installed([{ name: "a", installedVersion: "1.0.0" }]),
      reachability: new Map<string, ReachabilityVerdict>([["a", { kind: "unreachable" }]]),
    });
    expect(results).toEqual([{ state: "unreachable", name: "a" }]);
  });

  it("treats an unprobed installed package the same as unreachable, not as a silent current", () => {
    const results = judgeCurrency({
      declaration: declaration(["a"]),
      installed: installed([{ name: "a", installedVersion: "1.0.0" }]),
      reachability: new Map(),
    });
    expect(results).toEqual([{ state: "unreachable", name: "a" }]);
  });

  it("reports unauthenticated, never absent or not-published, for a denied lookup on an installed package", () => {
    const results = judgeCurrency({
      declaration: declaration(["a"]),
      installed: installed([{ name: "a", installedVersion: "1.0.0" }]),
      reachability: new Map<string, ReachabilityVerdict>([["a", { kind: "unauthenticated" }]]),
    });
    expect(results).toEqual([{ state: "unauthenticated", name: "a" }]);
  });

  it("reports every entitlement, never stopping at the first problem", () => {
    const results = judgeCurrency({
      declaration: declaration(["a", "b", "c"]),
      installed: installed([{ name: "a", installedVersion: "1.0.0" }]),
      reachability: new Map<string, ReachabilityVerdict>([["a", { kind: "unauthenticated" }]]),
    });
    expect(results.map((r) => r.name)).toEqual(["a", "b", "c"]);
  });

  it("reports #339's own observed example: two patches stay informational, the pre-1.0 minor gap grades major, not advisory", () => {
    // #339's own table: two straightforward patch gaps (0.3.1 -> 0.3.2,
    // 0.1.8 -> 0.1.9) plus a 0.6.0 -> 0.7.0 gap that reads as "minor" by the
    // digits alone. The issue's own refinement is explicit that pre-1.0 must
    // NOT be graded that leniently -- semver permits a 0.y minor bump to
    // break, so this package grades it the same as a major bump, not as an
    // advisory. A consumer folding patch/minor -> satisfied, major ->
    // violated over these three gets exactly two informational findings and
    // one blocking one, never three uniformly-blocking findings and never a
    // false-advisory silently let through.
    const results = judgeCurrency({
      declaration: declaration(["a", "b", "c"]),
      installed: installed([
        { name: "a", installedVersion: "0.3.1" },
        { name: "b", installedVersion: "0.1.8" },
        { name: "c", installedVersion: "0.6.0" },
      ]),
      reachability: new Map<string, ReachabilityVerdict>([
        ["a", { kind: "known", latestVersion: "0.3.2" }],
        ["b", { kind: "known", latestVersion: "0.1.9" }],
        ["c", { kind: "known", latestVersion: "0.7.0" }],
      ]),
    });
    expect(results).toEqual([
      { state: "behind", name: "a", installedVersion: "0.3.1", latestVersion: "0.3.2", severity: "patch" },
      { state: "behind", name: "b", installedVersion: "0.1.8", latestVersion: "0.1.9", severity: "patch" },
      { state: "behind", name: "c", installedVersion: "0.6.0", latestVersion: "0.7.0", severity: "major" },
    ]);
  });
});

// ---------------------------------------------------------------------------
// upgradeSet and optOutGaps
// ---------------------------------------------------------------------------

describe("upgradeSet and optOutGaps", () => {
  const statuses: PackageCurrency[] = [
    { state: "current", name: "a", installedVersion: "1.0.0" },
    { state: "behind", name: "b", installedVersion: "1.0.0", latestVersion: "2.0.0", severity: "major" },
    { state: "behind", name: "g", installedVersion: "1.0.0", latestVersion: "1.0.4", severity: "patch" },
    { state: "absent-with-reason", name: "c", reason: "x" },
    { state: "absent-without-reason", name: "d" },
    { state: "unreachable", name: "e" },
    { state: "unauthenticated", name: "f" },
    { state: "indeterminate", name: "h", reason: "version-unparseable" },
  ];

  it("upgradeSet contains exactly the behind entries, each carrying its graded severity", () => {
    expect(upgradeSet(statuses)).toEqual([
      { name: "b", installedVersion: "1.0.0", latestVersion: "2.0.0", severity: "major" },
      { name: "g", installedVersion: "1.0.0", latestVersion: "1.0.4", severity: "patch" },
    ]);
  });

  it("optOutGaps contains exactly the absent-without-reason names", () => {
    expect(optOutGaps(statuses)).toEqual(["d"]);
  });
});

// ---------------------------------------------------------------------------
// computeCurrencyMetric
// ---------------------------------------------------------------------------

describe("computeCurrencyMetric", () => {
  it("computes the share of entitled packages current, and reports the opt-out-gap count separately", () => {
    const statuses: PackageCurrency[] = [
      { state: "current", name: "a", installedVersion: "1.0.0" },
      { state: "current", name: "b", installedVersion: "1.0.0" },
      { state: "behind", name: "c", installedVersion: "1.0.0", latestVersion: "2.0.0", severity: "major" },
      { state: "absent-without-reason", name: "d" },
    ];
    const metric = computeCurrencyMetric(statuses);
    expect(metric).toEqual({ entitledCount: 4, currentCount: 2, absentWithoutReasonCount: 1, currencyShare: 0.5 });
  });

  it("reports a zero share for zero entitlements, not a division-by-zero NaN", () => {
    expect(computeCurrencyMetric([]).currencyShare).toBe(0);
  });

  it("does not count an indeterminate result as current or as an opt-out gap", () => {
    const statuses: PackageCurrency[] = [
      { state: "current", name: "a", installedVersion: "1.0.0" },
      { state: "indeterminate", name: "b", reason: "version-unparseable" },
      { state: "indeterminate", name: "c", reason: "version-not-comparable" },
    ];
    const metric = computeCurrencyMetric(statuses);
    expect(metric).toEqual({ entitledCount: 3, currentCount: 1, absentWithoutReasonCount: 0, currencyShare: 1 / 3 });
  });
});

describe("currencyVerdict", () => {
  const behind = (name: string, severity: CurrencySeverity): PackageCurrency =>
    ({ state: "behind", name, installedVersion: "0.0.0", latestVersion: "0.0.1", severity });

  it("folds patch and minor gaps to satisfied -- reported, never blocking", () => {
    expect(currencyVerdict([behind("a", "patch"), behind("b", "minor")])).toBe("satisfied");
  });

  it("folds a major gap to violated", () => {
    expect(currencyVerdict([behind("a", "patch"), behind("b", "major")])).toBe("violated");
  });

  it("treats an empty set and an all-current set as satisfied", () => {
    expect(currencyVerdict([])).toBe("satisfied");
    expect(currencyVerdict([{ state: "current", name: "a", installedVersion: "1.0.0" }])).toBe("satisfied");
  });

  // The load-bearing cases. Each of these is a package that was NOT judged
  // current -- it was not judged at all -- so reporting satisfied would be a
  // check reporting success over ground it never examined.
  it.each([
    ["indeterminate", { state: "indeterminate", name: "a", reason: "version-unparseable" }],
    ["unreachable", { state: "unreachable", name: "a" }],
    ["unauthenticated", { state: "unauthenticated", name: "a" }],
  ] as const)("folds %s to indeterminate, never satisfied", (_label, judgment) => {
    expect(currencyVerdict([judgment as PackageCurrency])).toBe("indeterminate");
  });

  // Nothing about an unexplained absence is unexamined: the package is
  // entitled, it is not installed, and no opt-out records a decision. That is
  // a complete evaluation reaching a negative answer, so calling it
  // indeterminate would demote a settled violation into "could not tell".
  it("folds absent-without-reason to violated, not indeterminate", () => {
    expect(currencyVerdict([{ state: "absent-without-reason", name: "a" }])).toBe("violated");
  });

  it("does not let an unexplained absence mask a genuine major gap", () => {
    expect(currencyVerdict([behind("a", "major"), { state: "absent-without-reason", name: "b" }])).toBe("violated");
  });

  it("does not let a recorded absence taint the verdict", () => {
    expect(currencyVerdict([{ state: "absent-with-reason", name: "a", reason: "not adopted here" }])).toBe("satisfied");
  });

  // Precedence matters: a run that could not evaluate part of the set cannot
  // honestly report the set as violated either -- that would present a partial
  // answer as a complete one.
  it("puts indeterminate ahead of violated when both are present", () => {
    expect(currencyVerdict([behind("a", "major"), { state: "unreachable", name: "b" }])).toBe("indeterminate");
  });

  it("maps verdicts onto the fleet's 0/1/2 exit-code ternary", () => {
    expect(currencyVerdictToExitCode("satisfied")).toBe(0);
    expect(currencyVerdictToExitCode("violated")).toBe(1);
    expect(currencyVerdictToExitCode("indeterminate")).toBe(2);
  });
});
