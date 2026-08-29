import { describe, expect, it } from "vitest";
import { isConservativeSemverRange, isExactSemver, MAX_SEMVER_TEXT_LENGTH, parseExactSemver } from "./semver.js";

describe("bounded SemVer parsing", () => {
  it("accepts exact core, prerelease, and build identifiers", () => {
    expect(parseExactSemver("1.2.3-alpha.1-x+build.001.sha")).toEqual({
      major: "1", minor: "2", patch: "3", prerelease: "alpha.1-x", build: "build.001.sha",
    });
    for (const value of ["0.0.0", "1.2.3-0", "1.2.3-alpha.7", "1.2.3+001", "1.2.3-rc.1+build.9"]) {
      expect(isExactSemver(value), value).toBe(true);
    }
    for (const value of ["01.2.3", "1.02.3", "1.2.03", "1.2.3-01", "1.2.3-", "1.2.3+", "1.2.3-alpha..1", "1.2.3+build..1"]) {
      expect(isExactSemver(value), value).toBe(false);
    }
  });

  it("accepts only the lifecycle comparator grammar", () => {
    for (const value of ["1.2.3", "^1.2.3", "~ 1.2.3", ">=1.2.3 <2.0.0", "1.2.3 - 2.0.0", "1.2.3 || 2.0.0", ">=1.2.3-rc.1+build.7"]) {
      expect(isConservativeSemverRange(value), value).toBe(true);
    }
    for (const value of ["latest", "1.x", "|| 1.2.3", "1.2.3 ||", "1.2.3 garbage", "1.2.3-01"]) {
      expect(isConservativeSemverRange(value), value).toBe(false);
    }
  });

  it("rejects oversized adversarial exact versions and ranges before backtracking can exist", () => {
    const repeated = "-".repeat(MAX_SEMVER_TEXT_LENGTH + 1);
    expect(isExactSemver(`0.0.0${repeated}`)).toBe(false);
    expect(isConservativeSemverRange(`0.0.0 ${repeated}`)).toBe(false);
  });
});
