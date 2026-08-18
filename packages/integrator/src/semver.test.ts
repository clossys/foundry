import { describe, expect, it } from "vitest";
import { compareVersions, parseVersion } from "./semver.js";
import { IntegratorValidationError } from "./errors.js";

describe("parseVersion", () => {
  it("parses a plain triple", () => {
    expect(parseVersion("1.2.3")).toEqual({ major: 1, minor: 2, patch: 3, prerelease: [] });
  });

  it("parses a prerelease with mixed numeric and alphanumeric identifiers", () => {
    expect(parseVersion("1.2.3-beta.1")).toEqual({ major: 1, minor: 2, patch: 3, prerelease: ["beta", 1] });
  });

  it("ignores build metadata", () => {
    expect(parseVersion("1.2.3+build.7")).toEqual({ major: 1, minor: 2, patch: 3, prerelease: [] });
  });

  it("rejects a malformed version", () => {
    expect(() => parseVersion("not-a-version")).toThrow(IntegratorValidationError);
    expect(() => parseVersion("1.2")).toThrow(IntegratorValidationError);
    expect(() => parseVersion("1.2.3.4")).toThrow(IntegratorValidationError);
  });
});

describe("compareVersions", () => {
  it("orders by major, then minor, then patch", () => {
    expect(compareVersions("2.0.0", "1.9.9")).toBeGreaterThan(0);
    expect(compareVersions("1.3.0", "1.2.9")).toBeGreaterThan(0);
    expect(compareVersions("1.2.4", "1.2.3")).toBeGreaterThan(0);
    expect(compareVersions("1.2.3", "1.2.3")).toBe(0);
  });

  it("ranks a release above any prerelease of the same triple", () => {
    expect(compareVersions("1.0.0", "1.0.0-rc.1")).toBeGreaterThan(0);
    expect(compareVersions("1.0.0-rc.1", "1.0.0")).toBeLessThan(0);
  });

  it("compares prerelease identifiers left to right, numeric before alphanumeric", () => {
    expect(compareVersions("1.0.0-alpha.1", "1.0.0-alpha.2")).toBeLessThan(0);
    expect(compareVersions("1.0.0-alpha", "1.0.0-alpha.1")).toBeLessThan(0);
    expect(compareVersions("1.0.0-1", "1.0.0-alpha")).toBeLessThan(0);
  });

  it("throws on an unparseable operand", () => {
    expect(() => compareVersions("1.2.3", "nope")).toThrow(IntegratorValidationError);
  });
});
