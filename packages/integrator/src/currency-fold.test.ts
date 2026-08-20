import { describe, expect, it } from "vitest";
import { foldCurrencyDelta, currencyFoldResultToExitCode, type CurrencyFoldFinding } from "./currency-fold.js";
import type { PackageCurrency, CurrencySeverity } from "./currency.js";

const blocking = new Set<CurrencySeverity>(["major"]);
const majorAndMinorBlocking = new Set<CurrencySeverity>(["major", "minor"]);

function behind(name: string, installedVersion: string, latestVersion: string, severity: CurrencySeverity): PackageCurrency {
  return { state: "behind", name, installedVersion, latestVersion, severity };
}

function current(name: string, installedVersion = "1.0.0"): PackageCurrency {
  return { state: "current", name, installedVersion };
}

// ---------------------------------------------------------------------------
// absolute scope -- currencyVerdict's existing semantics, generalized to a
// caller-supplied blocking-severity set instead of a hardcoded "major"
// ---------------------------------------------------------------------------

describe("foldCurrencyDelta -- absolute scope", () => {
  it("is satisfied with no findings when nothing is behind at a blocking severity", () => {
    const result = foldCurrencyDelta({
      scope: "absolute",
      statuses: [current("a"), behind("b", "1.0.0", "1.0.1", "patch")],
      blockingSeverities: blocking,
    });
    expect(result).toEqual({ scope: "absolute", verdict: "satisfied" });
  });

  it("is violated for a behind package whose severity is in the caller's blocking set", () => {
    const result = foldCurrencyDelta({
      scope: "absolute",
      statuses: [behind("a", "1.0.0", "2.0.0", "major")],
      blockingSeverities: blocking,
    });
    expect(result).toEqual({
      scope: "absolute",
      verdict: "violated",
      violations: [{ kind: "behind", name: "a", installedVersion: "1.0.0", latestVersion: "2.0.0", severity: "major" }],
    });
  });

  it("respects a wider caller-supplied blocking set -- minor now blocks too", () => {
    const result = foldCurrencyDelta({
      scope: "absolute",
      statuses: [behind("a", "1.0.0", "1.1.0", "minor")],
      blockingSeverities: majorAndMinorBlocking,
    });
    expect(result.verdict).toBe("violated");
  });

  it("does not block on a severity outside the caller's blocking set, even though it is graded behind", () => {
    const result = foldCurrencyDelta({
      scope: "absolute",
      statuses: [behind("a", "1.0.0", "1.1.0", "minor")],
      blockingSeverities: blocking, // major only
    });
    expect(result).toEqual({ scope: "absolute", verdict: "satisfied" });
  });

  it("treats absent-without-reason as an unconditional violation, regardless of blockingSeverities", () => {
    const result = foldCurrencyDelta({
      scope: "absolute",
      statuses: [{ state: "absent-without-reason", name: "a" }],
      blockingSeverities: new Set(), // empty -- nothing severity-graded blocks at all
    });
    expect(result).toEqual({
      scope: "absolute",
      verdict: "violated",
      violations: [{ kind: "absent-without-reason", name: "a" }],
    });
  });

  it("does not let a recorded absence (absent-with-reason) taint the verdict", () => {
    const result = foldCurrencyDelta({
      scope: "absolute",
      statuses: [{ state: "absent-with-reason", name: "a", reason: "not adopted here" }],
      blockingSeverities: blocking,
    });
    expect(result).toEqual({ scope: "absolute", verdict: "satisfied" });
  });

  it.each([
    ["indeterminate", { state: "indeterminate", name: "a", reason: "version-unparseable" }],
    ["unreachable", { state: "unreachable", name: "a" }],
    ["unauthenticated", { state: "unauthenticated", name: "a" }],
  ] as const)("folds a %s status to indeterminate, never satisfied and never violated", (_label, status) => {
    const result = foldCurrencyDelta({ scope: "absolute", statuses: [status as PackageCurrency], blockingSeverities: blocking });
    expect(result.verdict).toBe("indeterminate");
    if (result.verdict === "indeterminate") expect(result.reason.length).toBeGreaterThan(0);
  });

  it("puts indeterminate ahead of violated when both are present, regardless of array order", () => {
    const result = foldCurrencyDelta({
      scope: "absolute",
      statuses: [behind("a", "1.0.0", "2.0.0", "major"), { state: "unreachable", name: "b" }],
      blockingSeverities: blocking,
    });
    expect(result.verdict).toBe("indeterminate");
  });

  it("maps verdicts onto the fleet's 0/1/2 exit-code ternary", () => {
    expect(currencyFoldResultToExitCode({ scope: "absolute", verdict: "satisfied" })).toBe(0);
    expect(currencyFoldResultToExitCode({ scope: "absolute", verdict: "violated", violations: [] })).toBe(1);
    expect(currencyFoldResultToExitCode({ scope: "absolute", verdict: "indeterminate", reason: "x" })).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// introduced scope -- the fix: grade only what THIS change made worse
// ---------------------------------------------------------------------------

describe("foldCurrencyDelta -- introduced scope: the missing-baseline rule", () => {
  it("is indeterminate, never satisfied, when no baseline is supplied at all -- must not fail open", () => {
    const result = foldCurrencyDelta({
      scope: "introduced",
      statuses: [behind("a", "1.0.0", "2.0.0", "major")],
      baseline: undefined,
      blockingSeverities: blocking,
    });
    expect(result.verdict).toBe("indeterminate");
    if (result.verdict === "indeterminate") expect(result.reason).toMatch(/baseline/i);
  });

  it("is indeterminate, never satisfied, when the baseline is an explicit unreadable marker", () => {
    const result = foldCurrencyDelta({
      scope: "introduced",
      statuses: [behind("a", "1.0.0", "2.0.0", "major")],
      baseline: { kind: "unreadable", reason: "merge base commit not present in this shallow clone" },
      blockingSeverities: blocking,
    });
    expect(result.verdict).toBe("indeterminate");
    if (result.verdict === "indeterminate") {
      expect(result.reason).toMatch(/baseline/i);
      expect(result.reason).toMatch(/shallow clone/i);
    }
  });

  it("does not fall back to absolute grading when the baseline is unreadable -- a satisfied-looking absolute answer must not leak through", () => {
    // Every package here is CURRENT absolutely, so an absolute-grading
    // fallback would silently answer "satisfied". The unread baseline must
    // still win.
    const result = foldCurrencyDelta({
      scope: "introduced",
      statuses: [current("a")],
      baseline: undefined,
      blockingSeverities: blocking,
    });
    expect(result.verdict).toBe("indeterminate");
  });

  it("an empty array baseline (a merge base genuinely entitled to nothing) is a real, readable baseline -- not the same as unreadable", () => {
    const result = foldCurrencyDelta({
      scope: "introduced",
      statuses: [behind("a", "1.0.0", "2.0.0", "major")],
      baseline: [],
      blockingSeverities: blocking,
    });
    expect(result.verdict).toBe("violated");
  });
});

describe("foldCurrencyDelta -- introduced scope: the delta rules", () => {
  it("grades a newly-added, already-stale dependency as introduced", () => {
    const result = foldCurrencyDelta({
      scope: "introduced",
      statuses: [behind("new-dep", "1.0.0", "2.0.0", "major")],
      baseline: [], // not present at the merge base at all
      blockingSeverities: blocking,
    });
    expect(result.verdict).toBe("violated");
    if (result.verdict === "violated") {
      expect(result.introduced).toEqual<CurrencyFoldFinding[]>([
        { kind: "behind", name: "new-dep", installedVersion: "1.0.0", latestVersion: "2.0.0", severity: "major" },
      ]);
      expect(result.inherited).toEqual([]);
    }
  });

  it("grades unrelated pre-existing drift as inherited, never blocking, when installedVersion did not move", () => {
    const result = foldCurrencyDelta({
      scope: "introduced",
      statuses: [behind("legacy", "1.0.0", "2.0.0", "major")],
      baseline: [behind("legacy", "1.0.0", "2.0.0", "major")],
      blockingSeverities: blocking,
    });
    expect(result).toEqual({
      scope: "introduced",
      verdict: "satisfied",
      inherited: [{ kind: "behind", name: "legacy", installedVersion: "1.0.0", latestVersion: "2.0.0", severity: "major" }],
    });
  });

  it("still reports pre-existing drift as inherited even when the registry's `latest` moved further away, and does not block on it -- the moving-target case", () => {
    // installedVersion is unchanged; only latestVersion (and therefore the
    // severity grade) moved, because the registry moved during the workday.
    // This must never read as this change's doing.
    const result = foldCurrencyDelta({
      scope: "introduced",
      statuses: [behind("legacy", "1.0.0", "3.0.0", "major")],
      baseline: [behind("legacy", "1.0.0", "1.1.0", "minor")],
      blockingSeverities: majorAndMinorBlocking,
    });
    expect(result.verdict).toBe("satisfied");
    if (result.verdict === "satisfied") {
      expect(result.inherited).toEqual([{ kind: "behind", name: "legacy", installedVersion: "1.0.0", latestVersion: "3.0.0", severity: "major" }]);
    }
  });

  it("grades a real regression (installedVersion moved backward) as introduced", () => {
    const result = foldCurrencyDelta({
      scope: "introduced",
      statuses: [behind("dep", "1.0.0", "2.0.0", "major")],
      baseline: [behind("dep", "1.5.0", "2.0.0", "major")],
      blockingSeverities: blocking,
    });
    expect(result.verdict).toBe("violated");
    if (result.verdict === "violated") {
      expect(result.introduced.map((f) => f.name)).toEqual(["dep"]);
    }
  });

  it("grades an advance that still lands at a worse severity as introduced -- the bump was real but not enough", () => {
    // baseline: 1.4.0 vs latest 1.5.0 -> minor gap. This change bumped
    // installedVersion (an advance, 1.4.0 -> 1.4.5) but the registry had
    // already moved further (latest is now 2.0.0), landing at major.
    const result = foldCurrencyDelta({
      scope: "introduced",
      statuses: [behind("dep", "1.4.5", "2.0.0", "major")],
      baseline: [behind("dep", "1.4.0", "1.5.0", "minor")],
      blockingSeverities: majorAndMinorBlocking,
    });
    expect(result.verdict).toBe("violated");
    if (result.verdict === "violated") {
      expect(result.introduced.map((f) => f.name)).toEqual(["dep"]);
    }
  });

  it("grades an improved-but-still-behind advance as inherited, never blocking -- partial progress must never be punished", () => {
    const result = foldCurrencyDelta({
      scope: "introduced",
      statuses: [behind("dep", "1.9.0", "2.0.0", "major")],
      baseline: [behind("dep", "1.0.0", "2.0.0", "major")],
      blockingSeverities: blocking,
    });
    expect(result.verdict).toBe("satisfied");
    if (result.verdict === "satisfied") {
      expect(result.inherited.map((f) => f.name)).toEqual(["dep"]);
    }
  });

  it("grades an advance whose severity improved (e.g. major -> minor) as inherited, never blocking", () => {
    const result = foldCurrencyDelta({
      scope: "introduced",
      statuses: [behind("dep", "1.9.0", "2.0.0", "minor")],
      baseline: [behind("dep", "1.0.0", "2.0.0", "major")],
      blockingSeverities: majorAndMinorBlocking,
    });
    expect(result.verdict).toBe("satisfied");
    if (result.verdict === "satisfied") {
      expect(result.inherited.map((f) => f.name)).toEqual(["dep"]);
    }
  });

  it("grades current-in-baseline, behind-now as introduced -- only this change could have moved it", () => {
    const result = foldCurrencyDelta({
      scope: "introduced",
      statuses: [behind("dep", "1.0.0", "2.0.0", "major")],
      baseline: [current("dep", "1.0.0")],
      blockingSeverities: blocking,
    });
    expect(result.verdict).toBe("violated");
    if (result.verdict === "violated") {
      expect(result.introduced.map((f) => f.name)).toEqual(["dep"]);
    }
  });

  it("does not track a behind severity outside the blocking set as introduced or inherited, in either direction", () => {
    const result = foldCurrencyDelta({
      scope: "introduced",
      statuses: [behind("dep", "1.0.0", "1.0.1", "patch")],
      baseline: [],
      blockingSeverities: blocking, // major only
    });
    expect(result).toEqual({ scope: "introduced", verdict: "satisfied", inherited: [] });
  });

  it("reports both introduced and inherited findings together, never conflated", () => {
    const result = foldCurrencyDelta({
      scope: "introduced",
      statuses: [behind("new-dep", "1.0.0", "2.0.0", "major"), behind("legacy", "1.0.0", "2.0.0", "major")],
      baseline: [behind("legacy", "1.0.0", "2.0.0", "major")],
      blockingSeverities: blocking,
    });
    expect(result.verdict).toBe("violated");
    if (result.verdict === "violated") {
      expect(result.introduced.map((f) => f.name)).toEqual(["new-dep"]);
      expect(result.inherited.map((f) => f.name)).toEqual(["legacy"]);
    }
  });
});

describe("foldCurrencyDelta -- introduced scope: absent-without-reason", () => {
  it("grades a newly-unexplained absence (not present in baseline at all) as introduced", () => {
    const result = foldCurrencyDelta({
      scope: "introduced",
      statuses: [{ state: "absent-without-reason", name: "dep" }],
      baseline: [],
      blockingSeverities: blocking,
    });
    expect(result.verdict).toBe("violated");
    if (result.verdict === "violated") {
      expect(result.introduced).toEqual([{ kind: "absent-without-reason", name: "dep" }]);
    }
  });

  it("grades an unexplained absence that was ALSO unexplained at baseline as inherited, never blocking", () => {
    const result = foldCurrencyDelta({
      scope: "introduced",
      statuses: [{ state: "absent-without-reason", name: "dep" }],
      baseline: [{ state: "absent-without-reason", name: "dep" }],
      blockingSeverities: blocking,
    });
    expect(result).toEqual({
      scope: "introduced",
      verdict: "satisfied",
      inherited: [{ kind: "absent-without-reason", name: "dep" }],
    });
  });

  it("grades a package that was installed (or opted out with a reason) at baseline and is now an unexplained absence as introduced", () => {
    const removedInstall = foldCurrencyDelta({
      scope: "introduced",
      statuses: [{ state: "absent-without-reason", name: "dep" }],
      baseline: [current("dep")],
      blockingSeverities: blocking,
    });
    expect(removedInstall.verdict).toBe("violated");

    const removedOptOut = foldCurrencyDelta({
      scope: "introduced",
      statuses: [{ state: "absent-without-reason", name: "dep" }],
      baseline: [{ state: "absent-with-reason", name: "dep", reason: "not needed" }],
      blockingSeverities: blocking,
    });
    expect(removedOptOut.verdict).toBe("violated");
  });
});

describe("foldCurrencyDelta -- introduced scope: carried-through indeterminate rules", () => {
  it.each([
    ["indeterminate", { state: "indeterminate", name: "a", reason: "version-unparseable" }],
    ["unreachable", { state: "unreachable", name: "a" }],
    ["unauthenticated", { state: "unauthenticated", name: "a" }],
  ] as const)("folds a %s CURRENT-run status to indeterminate, never satisfied and never violated", (_label, status) => {
    const result = foldCurrencyDelta({
      scope: "introduced",
      statuses: [status as PackageCurrency],
      baseline: [],
      blockingSeverities: blocking,
    });
    expect(result.verdict).toBe("indeterminate");
  });

  it.each([
    ["indeterminate", { state: "indeterminate", name: "a", reason: "version-unparseable" }],
    ["unreachable", { state: "unreachable", name: "a" }],
    ["unauthenticated", { state: "unauthenticated", name: "a" }],
  ] as const)("folds a %s BASELINE status for a name this run needs to classify to indeterminate", (_label, baselineStatus) => {
    const result = foldCurrencyDelta({
      scope: "introduced",
      statuses: [behind("a", "1.0.0", "2.0.0", "major")],
      baseline: [baselineStatus as PackageCurrency],
      blockingSeverities: blocking,
    });
    expect(result.verdict).toBe("indeterminate");
  });

  it("does not let a baseline's unreadable status for an UNRELATED package leak into the result", () => {
    // "b" is unreachable in the baseline, but this run never needs to
    // classify "b" against it (nothing named "b" appears in this run's
    // statuses at all), so it must not taint the answer for "a".
    const result = foldCurrencyDelta({
      scope: "introduced",
      statuses: [behind("a", "1.0.0", "2.0.0", "major")],
      baseline: [{ state: "unreachable", name: "b" }],
      blockingSeverities: blocking,
    });
    expect(result.verdict).toBe("violated");
  });

  it("puts indeterminate ahead of violated for the current run, regardless of array order", () => {
    const result = foldCurrencyDelta({
      scope: "introduced",
      statuses: [behind("a", "1.0.0", "2.0.0", "major"), { state: "unreachable", name: "b" }],
      baseline: [],
      blockingSeverities: blocking,
    });
    expect(result.verdict).toBe("indeterminate");
  });
});

describe("foldCurrencyDelta -- introduced scope: exit codes", () => {
  it("maps verdicts onto the fleet's 0/1/2 exit-code ternary", () => {
    expect(currencyFoldResultToExitCode({ scope: "introduced", verdict: "satisfied", inherited: [] })).toBe(0);
    expect(currencyFoldResultToExitCode({ scope: "introduced", verdict: "violated", introduced: [], inherited: [] })).toBe(1);
    expect(currencyFoldResultToExitCode({ scope: "introduced", verdict: "indeterminate", reason: "x" })).toBe(2);
  });
});
