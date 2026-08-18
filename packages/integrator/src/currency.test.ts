import { describe, expect, it } from "vitest";
import { computeCurrencyMetric, judgeCurrency, optOutGaps, upgradeSet, type PackageCurrency } from "./currency.js";
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

describe("judgeCurrency", () => {
  it("reports current when the installed version is the latest known", () => {
    const results = judgeCurrency({
      declaration: declaration(["a"]),
      installed: installed([{ name: "a", installedVersion: "1.2.0" }]),
      reachability: new Map<string, ReachabilityVerdict>([["a", { kind: "known", latestVersion: "1.2.0" }]]),
    });
    expect(results).toEqual([{ state: "current", name: "a", installedVersion: "1.2.0" }]);
  });

  it("reports behind when the installed version trails the latest known", () => {
    const results = judgeCurrency({
      declaration: declaration(["a"]),
      installed: installed([{ name: "a", installedVersion: "1.0.0" }]),
      reachability: new Map<string, ReachabilityVerdict>([["a", { kind: "known", latestVersion: "1.2.0" }]]),
    });
    expect(results).toEqual([{ state: "behind", name: "a", installedVersion: "1.0.0", latestVersion: "1.2.0" }]);
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
});

describe("upgradeSet and optOutGaps", () => {
  const statuses: PackageCurrency[] = [
    { state: "current", name: "a", installedVersion: "1.0.0" },
    { state: "behind", name: "b", installedVersion: "1.0.0", latestVersion: "2.0.0" },
    { state: "absent-with-reason", name: "c", reason: "x" },
    { state: "absent-without-reason", name: "d" },
    { state: "unreachable", name: "e" },
    { state: "unauthenticated", name: "f" },
  ];

  it("upgradeSet contains exactly the behind entries", () => {
    expect(upgradeSet(statuses)).toEqual([{ name: "b", installedVersion: "1.0.0", latestVersion: "2.0.0" }]);
  });

  it("optOutGaps contains exactly the absent-without-reason names", () => {
    expect(optOutGaps(statuses)).toEqual(["d"]);
  });
});

describe("computeCurrencyMetric", () => {
  it("computes the share of entitled packages current, and reports the opt-out-gap count separately", () => {
    const statuses: PackageCurrency[] = [
      { state: "current", name: "a", installedVersion: "1.0.0" },
      { state: "current", name: "b", installedVersion: "1.0.0" },
      { state: "behind", name: "c", installedVersion: "1.0.0", latestVersion: "2.0.0" },
      { state: "absent-without-reason", name: "d" },
    ];
    const metric = computeCurrencyMetric(statuses);
    expect(metric).toEqual({ entitledCount: 4, currentCount: 2, absentWithoutReasonCount: 1, currencyShare: 0.5 });
  });

  it("reports a zero share for zero entitlements, not a division-by-zero NaN", () => {
    expect(computeCurrencyMetric([]).currencyShare).toBe(0);
  });
});
