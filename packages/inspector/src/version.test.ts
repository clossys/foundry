import { describe, expect, it } from "vitest";
import { gateResultToExitCode } from "@vespeneventures/controller/gates";
import {
  MINIMUM_SAFE_VERSION,
  checkVersionFloor,
  compareVersions,
  lowestSatisfyingVersion,
  parseVersion,
  versionFloorFindings,
} from "./version.js";

describe("parseVersion", () => {
  it("parses an ordinary release", () => {
    expect(parseVersion("1.2.3")).toEqual({ major: 1, minor: 2, patch: 3, prerelease: undefined });
  });

  it("keeps a prerelease tag and discards build metadata", () => {
    expect(parseVersion("1.2.3-rc.1+build.5")).toEqual({ major: 1, minor: 2, patch: 3, prerelease: "rc.1" });
  });

  it.each(["", "1.2", "v1.2.3", "latest", "1.2.3.4", "^1.2.3", undefined])(
    "refuses %s rather than guessing",
    (value) => {
      expect(parseVersion(value)).toBeUndefined();
    },
  );
});

describe("compareVersions", () => {
  const version = (value: string) => parseVersion(value)!;

  it("orders by major, then minor, then patch", () => {
    expect(compareVersions(version("1.0.0"), version("2.0.0"))).toBe(-1);
    expect(compareVersions(version("1.3.0"), version("1.2.9"))).toBe(1);
    expect(compareVersions(version("0.1.1"), version("0.1.1"))).toBe(0);
  });

  it("sorts a prerelease below the release it precedes", () => {
    expect(compareVersions(version("1.0.0-rc.1"), version("1.0.0"))).toBe(-1);
    expect(compareVersions(version("1.0.0"), version("1.0.0-rc.1"))).toBe(1);
  });
});

describe("lowestSatisfyingVersion", () => {
  it.each([
    ["^0.3.1", { major: 0, minor: 3, patch: 1 }],
    ["~0.3.1", { major: 0, minor: 3, patch: 1 }],
    [">=2.0.0", { major: 2, minor: 0, patch: 0 }],
    ["0.1.0", { major: 0, minor: 1, patch: 0 }],
  ])("reads %s as a floor", (range, expected) => {
    expect(lowestSatisfyingVersion(range)).toMatchObject(expected);
  });

  it.each(["*", "x", "0.1 || 0.2", "latest", "https://example.invalid/pkg.tgz", ""])(
    "refuses %s rather than guessing what it permits",
    (range) => {
      expect(lowestSatisfyingVersion(range)).toBeUndefined();
    },
  );

  it("treats > as >=, which can only over-report permissiveness", () => {
    // The true floor of ">1.2.3" is the next published version above it,
    // which needs a registry to know. Reporting 1.2.3 can make a range look
    // more permissive than it is, never less — the safe direction.
    expect(lowestSatisfyingVersion(">1.2.3")).toMatchObject({ major: 1, minor: 2, patch: 3 });
  });
});

describe("checkVersionFloor", () => {
  it("is satisfied for a current build with no declared range", () => {
    const report = checkVersionFloor({ installedVersion: "9.9.9" });
    expect(report.result.verdict).toBe("satisfied");
    expect(gateResultToExitCode(report.result)).toBe(0);
  });

  it("is indeterminate — not satisfied — when the build cannot name itself", () => {
    const report = checkVersionFloor({ installedVersion: undefined });
    expect(report.result).toMatchObject({ verdict: "indeterminate", reason: "unknown-installed-version" });
    expect(gateResultToExitCode(report.result)).toBe(2);
  });

  it("fails with exit 2, never a warning, when the build is below a caller-raised floor", () => {
    const report = checkVersionFloor({ installedVersion: "0.1.0", minimumVersion: "0.4.0" });
    expect(report.result).toMatchObject({ verdict: "indeterminate", reason: "stale-installed-version" });
    expect(gateResultToExitCode(report.result)).toBe(2);
    expect(report.effectiveMinimumVersion).toBe("0.4.0");
    expect(versionFloorFindings(report)[0]?.message).toContain("0.4.0");
  });

  it("never returns violated: being out of date is not a finding about the repository", () => {
    for (const input of [
      { installedVersion: undefined },
      { installedVersion: "0.0.1", minimumVersion: "5.0.0" },
      { installedVersion: "9.9.9", declaredRange: "nonsense" },
    ]) {
      expect(checkVersionFloor(input).result.verdict).not.toBe("violated");
    }
  });

  it("ignores a caller floor lower than the compiled one, and says it did", () => {
    const report = checkVersionFloor({ installedVersion: "9.9.9", minimumVersion: "0.0.1" });
    expect(report.effectiveMinimumVersion).toBe(MINIMUM_SAFE_VERSION);
    expect(report.callerFloorIgnored).toBe(true);
    expect(report.result.verdict).toBe("satisfied");
  });

  it("refuses an unparseable caller floor instead of falling back to the compiled one", () => {
    const report = checkVersionFloor({ installedVersion: "9.9.9", minimumVersion: "newest" });
    expect(report.result).toMatchObject({ verdict: "indeterminate", reason: "unknown-minimum-version" });
  });

  it("catches a current build whose caller still declares a pre-floor range", () => {
    // The case the compiled floor alone can never see: this build is fine,
    // and the caller's own manifest still permits resolving one that is not.
    const report = checkVersionFloor({
      installedVersion: "5.0.0",
      minimumVersion: "4.0.0",
      declaredRange: "^1.0.0",
    });
    expect(report.result).toMatchObject({
      verdict: "indeterminate",
      reason: "declared-range-permits-stale-version",
    });
    expect(gateResultToExitCode(report.result)).toBe(2);
  });

  it("is satisfied when the declared range's floor is at or above the minimum", () => {
    const report = checkVersionFloor({
      installedVersion: "5.0.0",
      minimumVersion: "4.0.0",
      declaredRange: "^4.0.0",
    });
    expect(report.result).toMatchObject({ verdict: "satisfied", evaluated: 2 });
  });

  it("refuses a declared range it cannot interpret rather than passing it", () => {
    const report = checkVersionFloor({ installedVersion: "5.0.0", declaredRange: "*" });
    expect(report.result).toMatchObject({ verdict: "indeterminate", reason: "unparseable-declared-range" });
  });

  it("ships a compiled floor that is itself a parseable version", () => {
    expect(parseVersion(MINIMUM_SAFE_VERSION)).toBeDefined();
  });
});
