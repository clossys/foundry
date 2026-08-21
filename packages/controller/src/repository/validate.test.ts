import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { repositoryProfileValidationCoverage, validateRepositoryProfile } from "./index.js";

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
      schemaVersion: 4,
      defaultBranch: "bad branch",
      commands: {},
      protectedPaths: "src/**",
      requirements: [],
      rootEntries: [],
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

  it("accepts strict v2 requirements while preserving v1 profiles", () => {
    expect(validateRepositoryProfile(validProfile)).toEqual([]);
    expect(validateRepositoryProfile({
      ...validProfile,
      schemaVersion: 2,
      requirements: [
        { id: "runtime.node", scope: "machine", constraint: { kind: "one-of", values: ["current", "next"] } },
        { id: "tool.formatter", scope: "repository", constraint: { kind: "present" } },
      ],
    })).toEqual([]);
  });

  it("accepts a minimum-version requirement constraint (issue #318) alongside the pre-existing forms unchanged", () => {
    expect(validateRepositoryProfile({
      ...validProfile,
      schemaVersion: 2,
      requirements: [
        { id: "runtime.node", scope: "machine", constraint: { kind: "minimum-version", floor: "20" } },
        { id: "tool.package-manager-version", scope: "repository", constraint: { kind: "minimum-version", floor: "10.33.0" } },
        { id: "runtime.javascript", scope: "machine", constraint: { kind: "one-of", values: ["current", "next"] } },
        { id: "tool.formatter", scope: "repository", constraint: { kind: "present" } },
      ],
    })).toEqual([]);
  });

  it("rejects a minimum-version constraint with a missing, non-string, or unparseable floor, and rejects unknown fields on every constraint kind", () => {
    const findings = validateRepositoryProfile({
      ...validProfile,
      schemaVersion: 2,
      requirements: [
        { id: "runtime.node", scope: "machine", constraint: { kind: "minimum-version" } },
        { id: "runtime.pnpm", scope: "machine", constraint: { kind: "minimum-version", floor: 20 } },
        { id: "runtime.python", scope: "machine", constraint: { kind: "minimum-version", floor: ">=20" } },
        { id: "runtime.ruby", scope: "machine", constraint: { kind: "minimum-version", floor: "20", values: ["20"] } },
        { id: "runtime.go", scope: "machine", constraint: { kind: "present", floor: "20" } },
        { id: "runtime.rust", scope: "machine", constraint: { kind: "one-of", floor: "20", values: ["20"] } },
      ],
    });

    expect(findings.map((entry) => [entry.rule, entry.path])).toEqual([
      ["constraint-floor", "requirements[0].constraint.floor"],
      ["constraint-floor", "requirements[1].constraint.floor"],
      ["constraint-floor", "requirements[2].constraint.floor"],
      ["unknown-field", "requirements[3].constraint.values"],
      ["unknown-field", "requirements[4].constraint.floor"],
      ["unknown-field", "requirements[5].constraint.floor"],
    ]);
  });

  it("accepts a strict v3 caller-owned root vocabulary while preserving v1 and v2", () => {
    expect(validateRepositoryProfile({
      ...validProfile,
      schemaVersion: 3,
      requirements: [],
      rootEntries: [
        { name: "source", classification: "canonical", disposition: "required" },
        { name: ".tooling", classification: "extension", disposition: "allowed" },
        { name: "old-link", classification: "compatibility-alias", disposition: "prohibited" },
        { name: "archive", classification: "legacy-artifact", disposition: "allowed" },
      ],
    })).toEqual([]);

    expect(validateRepositoryProfile({
      ...validProfile,
      schemaVersion: 2,
      requirements: [],
      rootEntries: [],
    }).map((entry) => [entry.rule, entry.path])).toEqual([["unknown-field", "rootEntries"]]);
  });

  it("requires explicit classifications and dispositions for every v3 root entry", () => {
    const findings = validateRepositoryProfile({
      ...validProfile,
      schemaVersion: 3,
      requirements: [],
      rootEntries: [
        { name: "nested/path", classification: "standard", disposition: "keep", extra: true },
        { name: "source", classification: "canonical" },
        { name: "source", classification: "exception", disposition: "allowed" },
      ],
    });

    expect(findings.map((entry) => [entry.rule, entry.path])).toEqual([
      ["unknown-field", "rootEntries[0].extra"],
      ["root-entry-name", "rootEntries[0].name"],
      ["root-entry-classification", "rootEntries[0].classification"],
      ["root-entry-disposition", "rootEntries[0].disposition"],
      ["root-entry-disposition", "rootEntries[1].disposition"],
      ["duplicate-root-entry", "rootEntries[2].name"],
    ]);
  });

  it("keeps v1 closed and validates every v2 requirement field", () => {
    expect(validateRepositoryProfile({ ...validProfile, requirements: [] }).map((entry) => [entry.rule, entry.path])).toEqual([
      ["unknown-field", "requirements"],
    ]);

    const findings = validateRepositoryProfile({
      ...validProfile,
      schemaVersion: 2,
      requirements: [
        { id: "Bad Id", scope: "host", constraint: { kind: "range", value: "latest" }, extra: true },
        { id: "runtime.node", scope: "machine", constraint: { kind: "one-of", values: ["current", "current", " bad"] } },
        { id: "runtime.node", scope: "machine", constraint: { kind: "present" } },
      ],
    });

    expect(findings.map((entry) => [entry.rule, entry.path])).toEqual([
      ["unknown-field", "requirements[0].extra"],
      ["requirement-id", "requirements[0].id"],
      ["requirement-scope", "requirements[0].scope"],
      ["unknown-field", "requirements[0].constraint.value"],
      ["constraint-kind", "requirements[0].constraint.kind"],
      ["duplicate-constraint-value", "requirements[1].constraint.values[1]"],
      ["constraint-value", "requirements[1].constraint.values[2]"],
      ["duplicate-requirement", "requirements[2]"],
    ]);
  });

  it("rejects a requirement id that embeds its own value instead of naming only the slot (issue #316)", () => {
    const findings = validateRepositoryProfile({
      ...validProfile,
      schemaVersion: 2,
      requirements: [
        { id: "runtime.node.major", scope: "machine", constraint: { kind: "present" } },
        { id: "package-manager.npm", scope: "repository", constraint: { kind: "present" } },
        { id: "tool.package-manager", scope: "repository", constraint: { kind: "present" } },
      ],
    });

    expect(findings.map((entry) => [entry.rule, entry.path])).toEqual([
      ["requirement-id-value-embedded", "requirements[0].id"],
      ["requirement-id-value-embedded", "requirements[1].id"],
    ]);
    expect(findings[0]?.message).toContain("3 dot-separated segments");
    expect(findings[1]?.message).toContain('category "package-manager"');
  });

  it("rejects missing, sparse, empty one-of, and accessor-backed v2 requirements", () => {
    expect(validateRepositoryProfile({ ...validProfile, schemaVersion: 2 }).map((entry) => entry.rule)).toEqual(["requirements-shape"]);

    const sparse = new Array(1);
    expect(validateRepositoryProfile({ ...validProfile, schemaVersion: 2, requirements: sparse }).map((entry) => entry.rule)).toEqual(["requirement-shape"]);

    expect(validateRepositoryProfile({
      ...validProfile,
      schemaVersion: 2,
      requirements: [{ id: "runtime.node", scope: "machine", constraint: { kind: "one-of", values: [] } }],
    }).map((entry) => entry.rule)).toEqual(["constraint-values-shape"]);

    let reads = 0;
    const requirement = { id: "runtime.node", scope: "machine" };
    Object.defineProperty(requirement, "constraint", { get: () => { reads += 1; return { kind: "present" }; } });
    expect(validateRepositoryProfile({ ...validProfile, schemaVersion: 2, requirements: [requirement] }).map((entry) => entry.rule)).toEqual(["constraint-shape"]);
    expect(reads).toBe(0);
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
      "requirements-shape",
      "root-entries-shape",
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
      ["commands-shape", "commands"],
    ]);

    const tooManyCommands = Array.from({ length: 10_001 }, (_, index) => ({ name: `check-${index}`, run: "npm test" }));
    expect(validateRepositoryProfile({ ...validProfile, commands: tooManyCommands }).map((entry) => [entry.rule, entry.path])).toEqual([
      ["commands-shape", "commands"],
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
      ["protected-paths-shape", "protectedPaths"],
    ]);

    const tooManyPaths = Array.from({ length: 10_001 }, (_, index) => `src/${index}/**`);
    expect(validateRepositoryProfile({ ...validProfile, protectedPaths: tooManyPaths }).map((entry) => [entry.rule, entry.path])).toEqual([
      ["protected-paths-shape", "protectedPaths"],
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

// issue #309 — a clean `validateRepositoryProfile` result does not say how
// much of the profile it actually checked. `requirements` and `rootEntries`
// are skipped entirely for schema versions that predate them, and a version
// that skips them returns an empty `findings` array indistinguishable from
// one that genuinely evaluated both and found them correct.
describe("repositoryProfileValidationCoverage", () => {
  const v1Profile = {
    schemaVersion: 1,
    defaultBranch: "main",
    commands: [{ name: "test", run: "npm test" }],
    protectedPaths: ["src/**"],
  };
  const v2Profile = {
    ...v1Profile,
    schemaVersion: 2,
    requirements: [{ id: "runtime.node", scope: "machine", constraint: { kind: "present" } }],
  };
  const v3Profile = {
    ...v2Profile,
    schemaVersion: 3,
    rootEntries: [{ name: "src", classification: "canonical", disposition: "required" }],
  };

  // The reproduction of the defect itself: a legacy (v1) profile that never
  // declares `requirements`/`rootEntries` at all, and a fully-populated v3
  // profile whose `requirements` and `rootEntries` were both genuinely
  // checked, validate to the exact same empty array. Before this fix,
  // nothing distinguished them — this is that "before" state, still true
  // today, plus the "after": the two are only distinguishable through
  // `repositoryProfileValidationCoverage`, which is the whole point of it
  // existing.
  it("a v1 pass and a v3 pass are indistinguishable via findings alone, but not via coverage", () => {
    expect(validateRepositoryProfile(v1Profile)).toEqual([]);
    expect(validateRepositoryProfile(v3Profile)).toEqual([]);

    expect(repositoryProfileValidationCoverage(v1Profile)).toEqual({
      requirementsChecked: false,
      rootEntriesChecked: false,
    });
    expect(repositoryProfileValidationCoverage(v3Profile)).toEqual({
      requirementsChecked: true,
      rootEntriesChecked: true,
    });
  });

  it("reports v2 coverage as requirements-checked but not rootEntries-checked", () => {
    expect(repositoryProfileValidationCoverage(v2Profile)).toEqual({
      requirementsChecked: true,
      rootEntriesChecked: false,
    });
  });

  it("treats an unrecognized or missing schemaVersion as full coverage, matching the validator's own fail-closed default", () => {
    expect(repositoryProfileValidationCoverage({ ...v1Profile, schemaVersion: 99 })).toEqual({
      requirementsChecked: true,
      rootEntriesChecked: true,
    });
    expect(repositoryProfileValidationCoverage({ defaultBranch: "main" })).toEqual({
      requirementsChecked: true,
      rootEntriesChecked: true,
    });
  });

  it("reports full coverage (rather than throwing) for non-object input, matching validateRepositoryProfile's own fail-closed handling", () => {
    expect(repositoryProfileValidationCoverage(null)).toEqual({
      requirementsChecked: true,
      rootEntriesChecked: true,
    });
    expect(repositoryProfileValidationCoverage("not a profile")).toEqual({
      requirementsChecked: true,
      rootEntriesChecked: true,
    });
  });

  it("reads schemaVersion as an own data descriptor only, exactly like validateRepositoryProfile", () => {
    let reads = 0;
    const accessorVersion = { ...v1Profile };
    Object.defineProperty(accessorVersion, "schemaVersion", { get: () => { reads += 1; return 1; } });
    expect(repositoryProfileValidationCoverage(accessorVersion)).toEqual({
      requirementsChecked: true,
      rootEntriesChecked: true,
    });
    expect(reads).toBe(0);

    // A null-prototype object whose "schemaVersion" is only reachable via a
    // `get` trap, never as an actual own property — the same shape the
    // "requires fields to be own and rejects polluted record prototypes"
    // case above uses for `validateRepositoryProfile` itself.
    const inheritedVersion = new Proxy(Object.create(null) as Record<string, unknown>, {
      get: (_target, key) => (key === "schemaVersion" ? 1 : undefined),
    });
    expect(repositoryProfileValidationCoverage(inheritedVersion)).toEqual({
      requirementsChecked: true,
      rootEntriesChecked: true,
    });
  });

  // A revoked Proxy throws on essentially every reflective operation,
  // including the `Array.isArray` call inside `isRecord` — a real, spec-
  // mandated behavior, not a contrived mock. `validateRepositoryProfile`
  // already guards against this with its own try/catch; before this test
  // was added, `repositoryProfileValidationCoverage` had no equivalent
  // guard and threw instead of returning the fail-closed fallback every
  // other unreadable input already gets.
  it("reports full coverage (rather than throwing) for a revoked Proxy", () => {
    const { proxy, revoke } = Proxy.revocable(v1Profile, {});
    revoke();
    expect(() => repositoryProfileValidationCoverage(proxy)).not.toThrow();
    expect(repositoryProfileValidationCoverage(proxy)).toEqual({
      requirementsChecked: true,
      rootEntriesChecked: true,
    });
  });

  // Same fail-closed outcome when the throw comes from
  // `Object.getOwnPropertyDescriptor` itself (inside `ownDataValue`) rather
  // than from `isRecord`'s own `Array.isArray` check.
  it("reports full coverage (rather than throwing) when getOwnPropertyDescriptor itself throws", () => {
    const throwing = new Proxy(
      { ...v1Profile },
      {
        getOwnPropertyDescriptor: () => {
          throw new Error("hostile trap");
        },
      },
    );
    expect(() => repositoryProfileValidationCoverage(throwing)).not.toThrow();
    expect(repositoryProfileValidationCoverage(throwing)).toEqual({
      requirementsChecked: true,
      rootEntriesChecked: true,
    });
  });
});
