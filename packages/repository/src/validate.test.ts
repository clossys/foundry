import { describe, expect, it } from "vitest";
import { isRepositoryProfile, validateRepositoryProfile } from "./index.js";

const validProfile = {
  schemaVersion: 1,
  defaultBranch: "main",
  commands: {
    setup: { run: "npm ci" },
    "check:package": { run: "npm test", cwd: "packages/example" },
  },
  protectedPaths: [".github/workflows/**", "packages/core/src/**"],
};

describe("validateRepositoryProfile", () => {
  it("accepts a provider-neutral consumer profile", () => {
    expect(validateRepositoryProfile(validProfile)).toEqual([]);
    expect(isRepositoryProfile(validProfile)).toBe(true);
  });

  it("reports all independently checkable top-level problems", () => {
    const findings = validateRepositoryProfile({
      schemaVersion: 2,
      defaultBranch: "bad branch",
      commands: [],
      protectedPaths: "src/**",
      provider: "example",
    });

    expect(findings.map((entry) => entry.rule)).toEqual([
      "unknown-field",
      "schema-version",
      "default-branch",
      "commands-shape",
      "protected-paths-shape",
    ]);
  });

  it("rejects unsafe branches, command names, command directories, and protected paths", () => {
    const findings = validateRepositoryProfile({
      schemaVersion: 1,
      defaultBranch: "feature..branch",
      commands: {
        "Build All": { run: " ", cwd: "../outside", extra: true },
        test: "npm test",
      },
      protectedPaths: ["/absolute", "src/../private", "src/**", "src/**"],
    });

    expect(findings.map((entry) => [entry.rule, entry.path])).toEqual([
      ["default-branch", "defaultBranch"],
      ["command-name", "commands.Build All"],
      ["unknown-field", "commands.Build All.extra"],
      ["command-run", "commands.Build All.run"],
      ["command-cwd", "commands.Build All.cwd"],
      ["command-shape", "commands.test"],
      ["protected-path", "protectedPaths[0]"],
      ["protected-path", "protectedPaths[1]"],
      ["duplicate-protected-path", "protectedPaths[3]"],
    ]);
    expect(isRepositoryProfile({})).toBe(false);
  });

  it("applies Git branch component rules without invoking Git", () => {
    for (const defaultBranch of ["feature.lock/work", ".hidden/work", "feature//work", "feature@{work", "feature\\work"]) {
      const findings = validateRepositoryProfile({ ...validProfile, defaultBranch });
      expect(findings.map((entry) => entry.rule)).toContain("default-branch");
    }

    expect(validateRepositoryProfile({ ...validProfile, defaultBranch: "feature/repository-contract" })).toEqual([]);
  });

  it("does not throw for non-object input", () => {
    expect(validateRepositoryProfile(null)).toEqual([
      { rule: "profile-shape", severity: "error", path: "$", message: "A repository profile must be an object." },
    ]);
  });
});
