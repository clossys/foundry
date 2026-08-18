import { describe, expect, it } from "vitest";
import { MINIMUM_SAFE_VERSION, checkVersionFloor, compareVersions, lowestSatisfyingVersion, parseVersion } from "./version.js";

describe("parseVersion / compareVersions", () => {
  it("parses an exact major.minor.patch", () => {
    expect(parseVersion("0.1.0")).toEqual({ major: 0, minor: 1, patch: 0, prerelease: undefined });
  });

  it("rejects a non-version string", () => {
    expect(parseVersion("not-a-version")).toBeUndefined();
    expect(parseVersion(undefined)).toBeUndefined();
  });

  it("orders by major, then minor, then patch, then prerelease", () => {
    expect(compareVersions(parseVersion("0.1.0")!, parseVersion("0.2.0")!)).toBe(-1);
    expect(compareVersions(parseVersion("1.0.0")!, parseVersion("1.0.0")!)).toBe(0);
    expect(compareVersions(parseVersion("1.0.0-rc.1")!, parseVersion("1.0.0")!)).toBe(-1);
  });
});

describe("lowestSatisfyingVersion", () => {
  it("reads caret, tilde, >=, >, and bare exact versions", () => {
    expect(lowestSatisfyingVersion("^0.1.0")).toEqual(parseVersion("0.1.0"));
    expect(lowestSatisfyingVersion("~0.1.0")).toEqual(parseVersion("0.1.0"));
    expect(lowestSatisfyingVersion(">=0.1.0")).toEqual(parseVersion("0.1.0"));
    expect(lowestSatisfyingVersion("0.1.0")).toEqual(parseVersion("0.1.0"));
  });

  it("refuses to guess at a range shape it does not understand", () => {
    expect(lowestSatisfyingVersion("*")).toBeUndefined();
    expect(lowestSatisfyingVersion("workspace:*")).toBeUndefined();
  });
});

describe("checkVersionFloor", () => {
  it("is satisfied for a current build with no declared range", () => {
    const report = checkVersionFloor({ installedVersion: MINIMUM_SAFE_VERSION });
    expect(report.result.verdict).toBe("satisfied");
  });

  it("is indeterminate, never violated, for an installed version that could not be determined", () => {
    const report = checkVersionFloor({ installedVersion: undefined });
    expect(report.result.verdict).toBe("indeterminate");
    if (report.result.verdict === "indeterminate") expect(report.result.reason).toBe("unknown-installed-version");
  });

  it("is indeterminate for a build below the compiled floor", () => {
    const report = checkVersionFloor({ installedVersion: "0.0.1" });
    expect(report.result.verdict).toBe("indeterminate");
    if (report.result.verdict === "indeterminate") expect(report.result.reason).toBe("stale-installed-version");
  });

  it("a caller-supplied floor only ever raises the effective floor, never lowers it", () => {
    const lowered = checkVersionFloor({ installedVersion: MINIMUM_SAFE_VERSION, minimumVersion: "0.0.1" });
    expect(lowered.effectiveMinimumVersion).toBe(MINIMUM_SAFE_VERSION);

    const raised = checkVersionFloor({ installedVersion: MINIMUM_SAFE_VERSION, minimumVersion: "9.9.9" });
    expect(raised.result.verdict).toBe("indeterminate");
    expect(raised.effectiveMinimumVersion).toBe("9.9.9");
  });

  it("is indeterminate when a current build's declared range still admits a pre-floor version", () => {
    const report = checkVersionFloor({ installedVersion: MINIMUM_SAFE_VERSION, declaredRange: "^0.0.1" });
    expect(report.result.verdict).toBe("indeterminate");
    if (report.result.verdict === "indeterminate") expect(report.result.reason).toBe("declared-range-permits-stale-version");
  });

  it("is satisfied when a current build's declared range floors at or above the minimum", () => {
    const report = checkVersionFloor({ installedVersion: MINIMUM_SAFE_VERSION, declaredRange: `~${MINIMUM_SAFE_VERSION}` });
    expect(report.result.verdict).toBe("satisfied");
  });
});
