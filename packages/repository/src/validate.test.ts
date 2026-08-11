import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
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

    const crossRealmProfile = runInNewContext(`({
      schemaVersion: 1,
      defaultBranch: "main",
      commands: { test: { run: "npm test" } },
      protectedPaths: ["src/**"]
    })`) as unknown;
    expect(validateRepositoryProfile(crossRealmProfile)).toEqual([]);

    const inheritedProfile = new Proxy(Object.create(null) as Record<string, unknown>, {
      get: (_target, key) => ({ schemaVersion: 1, defaultBranch: "main", commands: {}, protectedPaths: [] })[key as never],
    });
    expect(validateRepositoryProfile(inheritedProfile).map((entry) => entry.rule)).toEqual([
      "schema-version",
      "default-branch",
      "commands-shape",
      "protected-paths-shape",
    ]);

    const inheritedCommand = new Proxy(Object.create(null) as Record<string, unknown>, {
      get: (_target, key) => ({ run: "npm test", cwd: "packages/example" })[key as never],
      has: (_target, key) => key === "run" || key === "cwd",
    });
    const inheritedCommandFields = {
      ...validProfile,
      commands: Object.assign(Object.create(null) as Record<string, unknown>, { test: inheritedCommand }),
    };
    expect(validateRepositoryProfile(inheritedCommandFields).map((entry) => entry.rule)).toEqual(["command-run", "command-cwd"]);

    const pollutedCommands = runInNewContext(`
      Object.prototype.test = "npm test";
      ({})
    `) as unknown;
    expect(validateRepositoryProfile({ ...validProfile, commands: pollutedCommands }).map((entry) => entry.rule)).toEqual(["commands-shape"]);
  });

  it("rejects prototype pollution present before validator initialization", async () => {
    vi.resetModules();
    Object.defineProperty(Object.prototype, "zzpolluted", { value: "npm test", configurable: true });

    try {
      const { validateRepositoryProfile: validateFreshProfile } = await import("./validate.js");
      const profile = Object.assign(Object.create(null) as Record<string, unknown>, validProfile, { commands: {} });
      expect(validateFreshProfile(profile).map((entry) => entry.rule)).toEqual(["commands-shape"]);
    } finally {
      delete (Object.prototype as Record<string, unknown>).zzpolluted;
      vi.resetModules();
    }
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

  it("accepts one trailing separator on relative directories and patterns", () => {
    expect(validateRepositoryProfile({
      ...validProfile,
      commands: { test: { run: "npm test", cwd: "packages/example/" } },
      protectedPaths: ["src/**/"],
    })).toEqual([]);
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
