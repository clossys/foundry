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

  it("requires record containers while accepting null-prototype records", () => {
    const findings = validateRepositoryProfile({
      ...validProfile,
      commands: new Map([["test", { run: "npm test" }]]),
    });
    expect(findings.map((entry) => [entry.rule, entry.path])).toEqual([["commands-shape", "commands"]]);

    const commands = Object.assign(Object.create(null) as Record<string, { run: string }>, validProfile.commands);
    expect(validateRepositoryProfile({ ...validProfile, commands })).toEqual([]);

    const hiddenCommand = {};
    Object.defineProperty(hiddenCommand, "test", { value: "npm test" });
    expect(validateRepositoryProfile({ ...validProfile, commands: hiddenCommand }).map((entry) => [entry.rule, entry.path])).toEqual([
      ["command-shape", "commands.test"],
    ]);

    const hiddenProfileField = { ...validProfile };
    Object.defineProperty(hiddenProfileField, "provider", { value: "example" });
    expect(validateRepositoryProfile(hiddenProfileField).map((entry) => [entry.rule, entry.path])).toEqual([
      ["unknown-field", "provider"],
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
      protectedPaths: ["/absolute", "src/../private", "{..,src}/secret", "src/**", "src/**"],
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
      ["protected-path", "protectedPaths[2]"],
      ["duplicate-protected-path", "protectedPaths[4]"],
    ]);
    expect(isRepositoryProfile({})).toBe(false);
  });

  it("applies Git branch component rules without invoking Git", () => {
    for (const defaultBranch of ["HEAD", "feature.lock/work", ".hidden/work", "feature//work", "feature@{work", "feature\\work"]) {
      const findings = validateRepositoryProfile({ ...validProfile, defaultBranch });
      expect(findings.map((entry) => entry.rule)).toContain("default-branch");
    }

    expect(validateRepositoryProfile({ ...validProfile, defaultBranch: "feature/repository-contract" })).toEqual([]);
    expect(validateRepositoryProfile({ ...validProfile, defaultBranch: "@" })).toEqual([]);
  });

  it("rejects Windows drive-qualified repository paths", () => {
    const findings = validateRepositoryProfile({
      ...validProfile,
      commands: { test: { run: "npm test", cwd: "C:/outside" } },
      protectedPaths: ["D:outside"],
    });

    expect(findings.map((entry) => [entry.rule, entry.path])).toEqual([
      ["command-cwd", "commands.test.cwd"],
      ["protected-path", "protectedPaths[0]"],
    ]);
  });

  it("validates sparse protected-path arrays by index", () => {
    const protectedPaths = new Array<string>(1);
    const findings = validateRepositoryProfile({ ...validProfile, protectedPaths });

    expect(findings.map((entry) => [entry.rule, entry.path])).toEqual([["protected-path", "protectedPaths[0]"]]);

    const hugeSparsePaths = new Array<string>(0xffffffff);
    expect(validateRepositoryProfile({ ...validProfile, protectedPaths: hugeSparsePaths }).map((entry) => [entry.rule, entry.path])).toEqual([
      ["protected-path", "protectedPaths[0]"],
    ]);
  });

  it("does not throw for non-object input", () => {
    expect(validateRepositoryProfile(null)).toEqual([
      { rule: "profile-shape", severity: "error", path: "$", message: "A repository profile must be an object." },
    ]);

    const unreadable = new Proxy({}, { ownKeys: () => { throw new Error("unreadable"); } });
    expect(validateRepositoryProfile(unreadable)).toEqual([
      { rule: "profile-shape", severity: "error", path: "$", message: "A repository profile must be a safely readable object." },
    ]);
  });
});
