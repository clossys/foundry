import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { validateRepositoryProfile } from "./index.js";

const validProfile = {
  schemaVersion: 1,
  defaultBranch: "main",
  commands: [
    { name: "setup", run: "npm ci" },
    { name: "check:package", run: "npm test", cwd: "packages/example" },
  ],
  protectedPaths: [".github/workflows/**", "packages/core/src/**"],
};

describe("validateRepositoryProfile", () => {
  it("accepts a provider-neutral consumer profile", () => {
    expect(validateRepositoryProfile(validProfile)).toEqual([]);
  });

  it("reports all independently checkable top-level problems", () => {
    const findings = validateRepositoryProfile({
      schemaVersion: 2,
      defaultBranch: "bad branch",
      commands: {},
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

  it("requires command arrays and record entries while accepting null-prototype records", () => {
    const findings = validateRepositoryProfile({
      ...validProfile,
      commands: new Map([["test", { run: "npm test" }]]),
    });
    expect(findings.map((entry) => [entry.rule, entry.path])).toEqual([["commands-shape", "commands"]]);

    const command = Object.assign(Object.create(null) as Record<string, string>, { name: "test", run: "npm test" });
    expect(validateRepositoryProfile({ ...validProfile, commands: [command] })).toEqual([]);

    const hiddenCommands: unknown[] = [];
    Object.defineProperty(hiddenCommands, "0", { value: "npm test" });
    expect(validateRepositoryProfile({ ...validProfile, commands: hiddenCommands }).map((entry) => [entry.rule, entry.path])).toEqual([
      ["command-shape", "commands[0]"],
    ]);

    const hiddenProfileField = { ...validProfile };
    Object.defineProperty(hiddenProfileField, "provider", { value: "example" });
    expect(validateRepositoryProfile(hiddenProfileField).map((entry) => [entry.rule, entry.path])).toEqual([
      ["unknown-field", "provider"],
    ]);
  });

  it("accepts plain and frozen records from another realm", () => {
    const crossRealmProfile = runInNewContext(`({
      schemaVersion: 1,
      defaultBranch: "main",
      commands: [{ name: "test", run: "npm test" }],
      protectedPaths: ["src/**"]
    })`) as unknown;
    expect(validateRepositoryProfile(crossRealmProfile)).toEqual([]);

    const frozenPrototypeProfile = runInNewContext(`
      Object.freeze(Array.prototype);
      delete Object.prototype.__proto__;
      Object.freeze(Object.prototype);
      ({
        schemaVersion: 1,
        defaultBranch: "main",
        commands: [{ name: "test", run: "npm test" }],
        protectedPaths: ["src/**"]
      })
    `) as unknown;
    expect(validateRepositoryProfile(frozenPrototypeProfile)).toEqual([]);
  });

  it("requires fields to be own and rejects polluted record prototypes", () => {
    const inheritedProfile = new Proxy(Object.create(null) as Record<string, unknown>, {
      get: (_target, key) => ({ schemaVersion: 1, defaultBranch: "main", commands: [], protectedPaths: [] })[key as never],
    });
    expect(validateRepositoryProfile(inheritedProfile).map((entry) => entry.rule)).toEqual([
      "schema-version",
      "default-branch",
      "commands-shape",
      "protected-paths-shape",
    ]);

    const inheritedCommand = new Proxy(Object.create(null) as Record<string, unknown>, {
      get: (_target, key) => ({ name: "test", run: "npm test", cwd: "packages/example" })[key as never],
      has: (_target, key) => key === "name" || key === "run" || key === "cwd",
    });
    expect(validateRepositoryProfile({ ...validProfile, commands: [inheritedCommand] }).map((entry) => entry.rule)).toEqual([
      "command-name",
      "command-run",
      "command-cwd",
    ]);

    const pollutedCommand = runInNewContext(`
      Object.prototype.test = "npm test";
      ({ name: "test", run: "npm test" })
    `) as unknown;
    expect(validateRepositoryProfile({ ...validProfile, commands: [pollutedCommand] }).map((entry) => entry.rule)).toEqual(["command-shape"]);
  });

  it("rejects accessor-backed fields and entries without invoking them", () => {
    let reads = 0;
    const accessorProfile = { ...validProfile };
    Object.defineProperty(accessorProfile, "commands", { get: () => { reads += 1; return []; } });
    expect(validateRepositoryProfile(accessorProfile).map((entry) => entry.rule)).toEqual(["commands-shape"]);

    const accessorCommand = { run: "npm test" };
    Object.defineProperty(accessorCommand, "name", { get: () => { reads += 1; return "test"; } });
    expect(validateRepositoryProfile({ ...validProfile, commands: [accessorCommand] }).map((entry) => entry.rule)).toEqual(["command-name"]);

    const accessorPaths: string[] = [];
    Object.defineProperty(accessorPaths, "0", { get: () => { reads += 1; return "src/**"; } });
    expect(validateRepositoryProfile({ ...validProfile, protectedPaths: accessorPaths }).map((entry) => entry.rule)).toEqual(["protected-path"]);
    expect(reads).toBe(0);
  });

  it("rejects structural indexed objects because profile collections are arrays", () => {
    const indexedCommands = { 0: { name: "test", run: "npm test" }, length: 1 };
    expect(validateRepositoryProfile({ ...validProfile, commands: indexedCommands }).map((entry) => entry.rule)).toEqual(["commands-shape"]);
  });

  it("rejects prototype pollution present before validator initialization", async () => {
    vi.resetModules();
    Object.defineProperty(Object.prototype, "zzpolluted", { value: "npm test", configurable: true });

    try {
      const { validateRepositoryProfile: validateFreshProfile } = await import("./validate.js");
      expect(validateFreshProfile({ ...validProfile, commands: [] }).map((entry) => entry.rule)).toEqual(["profile-shape"]);
    } finally {
      delete (Object.prototype as Record<string, unknown>).zzpolluted;
      vi.resetModules();
    }
  });

  it("rejects unsafe branches, commands, directories, and protected paths", () => {
    const findings = validateRepositoryProfile({
      schemaVersion: 1,
      defaultBranch: "feature..branch",
      commands: [
        { name: "Build All", run: " ", cwd: "../outside", extra: true },
        "npm test",
      ],
      protectedPaths: ["/absolute", "src/../private", "{..,src}/secret", "src/**", "src/**"],
    });

    expect(findings.map((entry) => [entry.rule, entry.path])).toEqual([
      ["default-branch", "defaultBranch"],
      ["unknown-field", "commands[0].extra"],
      ["command-name", "commands[0].name"],
      ["command-run", "commands[0].run"],
      ["command-cwd", "commands[0].cwd"],
      ["command-shape", "commands[1]"],
      ["protected-path", "protectedPaths[0]"],
      ["protected-path", "protectedPaths[1]"],
      ["protected-path", "protectedPaths[2]"],
      ["duplicate-protected-path", "protectedPaths[4]"],
    ]);
    expect(validateRepositoryProfile({}).length).toBeGreaterThan(0);
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
      commands: [{ name: "test", run: "npm test", cwd: "C:/outside" }],
      protectedPaths: ["D:outside"],
    });

    expect(findings.map((entry) => [entry.rule, entry.path])).toEqual([
      ["command-cwd", "commands[0].cwd"],
      ["protected-path", "protectedPaths[0]"],
    ]);
  });

  it("accepts one trailing separator on relative directories and patterns", () => {
    expect(validateRepositoryProfile({
      ...validProfile,
      commands: [{ name: "test", run: "npm test", cwd: "packages/example/" }],
      protectedPaths: ["src/**/"],
    })).toEqual([]);
  });

  it("validates command arrays without inherited name lookups or sparse-array stalls", () => {
    expect(validateRepositoryProfile({ ...validProfile, commands: [{ name: "constructor", run: "npm test" }] })).toEqual([]);

    const duplicateCommands = [{ name: "test", run: "npm test" }, { name: "test", run: "npm run test:again" }];
    expect(validateRepositoryProfile({ ...validProfile, commands: duplicateCommands }).map((entry) => [entry.rule, entry.path])).toEqual([
      ["duplicate-command-name", "commands[1].name"],
    ]);

    const sparseCommands = new Array(1);
    expect(validateRepositoryProfile({ ...validProfile, commands: sparseCommands }).map((entry) => [entry.rule, entry.path])).toEqual([
      ["command-shape", "commands[0]"],
    ]);

    const hugeSparseCommands = new Array(0xffffffff);
    expect(validateRepositoryProfile({ ...validProfile, commands: hugeSparseCommands }).map((entry) => [entry.rule, entry.path])).toEqual([
      ["command-shape", "commands[0]"],
    ]);
  });

  it("rejects own array behavior shadows without trusting prototype methods", () => {
    const commands = Object.assign([{ name: "test", run: "npm test" }], { map: null });
    expect(validateRepositoryProfile({ ...validProfile, commands }).map((entry) => entry.rule)).toEqual(["commands-shape"]);

    const protectedPaths = ["src/**"];
    Object.defineProperty(protectedPaths, Symbol.iterator, { value: function* () { yield "../outside"; } });
    expect(validateRepositoryProfile({ ...validProfile, protectedPaths }).map((entry) => entry.rule)).toEqual(["protected-paths-shape"]);

    const customPrototypeCommands = [{ name: "test", run: "npm test" }];
    Object.setPrototypeOf(customPrototypeCommands, { map: null });
    expect(validateRepositoryProfile({ ...validProfile, commands: customPrototypeCommands })).toEqual([]);
  });

  it("validates sparse protected-path arrays by own index", () => {
    const protectedPaths = new Array<string>(1);
    expect(validateRepositoryProfile({ ...validProfile, protectedPaths }).map((entry) => [entry.rule, entry.path])).toEqual([
      ["protected-path", "protectedPaths[0]"],
    ]);

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
