import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CliInputError, main } from "./run-cli.js";
import { REPOSITORY_PROFILE_RUN_DECLARATION_SOURCE } from "./run.js";

let directory: string;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "repository-profile-run-cli-"));
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function writeJson(relativePath: string, value: unknown): string {
  const path = join(directory, ...relativePath.split("/"));
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, JSON.stringify(value));
  return path;
}

const validV1Profile = {
  schemaVersion: 1,
  defaultBranch: "main",
  commands: [{ name: "check", run: "npm run check" }],
  protectedPaths: [],
};

const v3ProfileWithRequirements = {
  schemaVersion: 3,
  defaultBranch: "main",
  commands: [],
  protectedPaths: [],
  requirements: [{ id: "runtime.node", scope: "machine", constraint: { kind: "present" } }],
  rootEntries: [{ name: "README.md", classification: "canonical", disposition: "required" }],
};

describe("repository-profile-check: exit code 0 (satisfied)", () => {
  it("returns 0 for a valid canonical declaration with nothing to evaluate", () => {
    writeJson("governance/repository-profile.json", validV1Profile);
    expect(main([directory])).toBe(0);
  });

  it("returns 0 when injected discovery fully satisfies every declared axis", () => {
    writeJson("governance/repository-profile.json", v3ProfileWithRequirements);
    const discovery = writeJson("discovery.json", {
      requirementObservations: [{ id: "runtime.node", scope: "machine", state: "observed", value: "20" }],
      rootObservedEntries: ["README.md"],
    });
    expect(main([directory, "--discovery", discovery])).toBe(0);
  });

  // Custom axes (issue #324): the discovery file's "customAxes" is
  // caller-ALREADY-EVALUATED data, exactly like the two keys above — this
  // CLI still performs no I/O to produce or check the comparison itself.
  it("returns 0 when a satisfied custom axis is included alongside satisfied built-in axes", () => {
    writeJson("governance/repository-profile.json", v3ProfileWithRequirements);
    const discovery = writeJson("discovery.json", {
      requirementObservations: [{ id: "runtime.node", scope: "machine", state: "observed", value: "20" }],
      rootObservedEntries: ["README.md"],
      customAxes: [{ name: "commands-vs-manifest-scripts", result: { verdict: "satisfied", evaluated: 1 } }],
    });
    expect(main([directory, "--discovery", discovery])).toBe(0);
  });
});

describe("repository-profile-check: exit code 1 (violated)", () => {
  it("returns 1 when no declaration exists anywhere", () => {
    expect(main([directory])).toBe(1);
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("declaration-not-found"));
  });

  it("returns 1 for a declaration at a non-canonical location", () => {
    writeJson("config/repository-profile.json", validV1Profile);
    expect(main([directory])).toBe(1);
  });

  it("returns 1 when the injected observation does not satisfy a declared requirement", () => {
    writeJson("governance/repository-profile.json", v3ProfileWithRequirements);
    const discovery = writeJson("discovery.json", {
      requirementObservations: [{ id: "runtime.node", scope: "machine", state: "absent" }],
      rootObservedEntries: ["README.md"],
    });
    expect(main([directory, "--discovery", discovery])).toBe(1);
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("requirement-unsatisfied"));
  });

  it("returns 1 when a custom axis reports violated, even with every built-in axis satisfied", () => {
    writeJson("governance/repository-profile.json", v3ProfileWithRequirements);
    const discovery = writeJson("discovery.json", {
      requirementObservations: [{ id: "runtime.node", scope: "machine", state: "observed", value: "20" }],
      rootObservedEntries: ["README.md"],
      customAxes: [
        {
          name: "commands-vs-manifest-scripts",
          result: {
            verdict: "violated",
            findings: [{ rule: "command-script-missing", severity: "error", path: "$.commands[0].run", message: "no such script" }],
          },
        },
      ],
    });
    expect(main([directory, "--discovery", discovery])).toBe(1);
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("command-script-missing"));
  });
});

describe("repository-profile-check: exit code 2 (indeterminate)", () => {
  it("returns 2 for bad arguments", () => {
    expect(() => main(["one", "two"])).toThrow(CliInputError);
    expect(() => main(["--unknown"])).toThrow(CliInputError);
  });

  it("returns 2 for malformed JSON at an explicit path", () => {
    const path = join(directory, "profile.json");
    writeFileSync(path, "{ not JSON");
    expect(main([path])).toBe(2);
  });

  /**
   * THE BUG THIS RUNNER EXISTS TO MAKE STRUCTURALLY IMPOSSIBLE (issue #321):
   * `commands` is a string, not an array. The old shape a hand-written
   * runner would have iterated character by character and reported clean.
   * This command must exit 2, never 0, and print the schema finding rather
   * than any requirement/root finding.
   */
  it("returns 2 — never 0 — for a JSON-valid, schema-invalid declaration, and never reaches evaluation", () => {
    writeJson("governance/repository-profile.json", {
      schemaVersion: 1,
      defaultBranch: "main",
      commands: "npm run check",
      protectedPaths: [],
    });
    const discovery = writeJson("discovery.json", {
      requirementObservations: [{ id: "runtime.node", scope: "machine", state: "observed", value: "20" }],
      rootObservedEntries: ["README.md"],
    });
    expect(main([directory, "--discovery", discovery])).toBe(2);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("declaration-schema-invalid"));
  });

  it("returns 2 when a declared requirement has no injected observation at all", () => {
    writeJson("governance/repository-profile.json", v3ProfileWithRequirements);
    expect(main([directory])).toBe(2);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("requirements-unknown"));
  });

  it("returns 2 when the profile declares root entries but --discovery is never given", () => {
    writeJson("governance/repository-profile.json", v3ProfileWithRequirements);
    const discovery = writeJson("discovery.json", {
      requirementObservations: [{ id: "runtime.node", scope: "machine", state: "observed", value: "20" }],
    });
    expect(main([directory, "--discovery", discovery])).toBe(2);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("root-observations-missing"));
  });

  it("rejects a discovery file that is not a JSON object", () => {
    writeJson("governance/repository-profile.json", validV1Profile);
    const discovery = writeJson("discovery.json", [1, 2, 3]);
    expect(() => main([directory, "--discovery", discovery])).toThrow(CliInputError);
  });

  it("rejects a discovery file with an unknown field", () => {
    writeJson("governance/repository-profile.json", validV1Profile);
    const discovery = writeJson("discovery.json", { rootObservedEntries: [], somethingElse: true });
    expect(() => main([directory, "--discovery", discovery])).toThrow(CliInputError);
  });

  it("rejects a missing --discovery file", () => {
    writeJson("governance/repository-profile.json", validV1Profile);
    expect(() => main([directory, "--discovery", join(directory, "missing.json")])).toThrow(CliInputError);
  });

  it("returns 2, naming the axis, when a custom axis itself reports indeterminate", () => {
    writeJson("governance/repository-profile.json", validV1Profile);
    const discovery = writeJson("discovery.json", {
      customAxes: [{ name: "protected-paths-vs-workflow-predicate", result: { verdict: "indeterminate", reason: "workflow-file-unreadable" } }],
    });
    expect(main([directory, "--discovery", discovery])).toBe(2);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("custom-axis-indeterminate"));
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("protected-paths-vs-workflow-predicate"));
  });

  it("returns 2, never 0, when a custom axis is not a well-formed GateResult", () => {
    writeJson("governance/repository-profile.json", validV1Profile);
    const discovery = writeJson("discovery.json", {
      customAxes: [{ name: "commands-vs-manifest-scripts", result: { verdict: "satisfied" } }], // missing "evaluated"
    });
    expect(main([directory, "--discovery", discovery])).toBe(2);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("custom-axis-invalid"));
  });

  it("rejects a customAxes value that is not an array", () => {
    writeJson("governance/repository-profile.json", validV1Profile);
    const discovery = writeJson("discovery.json", { customAxes: { name: "x", result: { verdict: "satisfied", evaluated: 1 } } });
    expect(() => main([directory, "--discovery", discovery])).toThrow(CliInputError);
  });
});

describe("repository-profile-check: source constant for repository-scoped observations", () => {
  it("matches a repository-scoped observation against REPOSITORY_PROFILE_RUN_DECLARATION_SOURCE, not the file path", () => {
    writeJson("governance/repository-profile.json", {
      schemaVersion: 3,
      defaultBranch: "main",
      commands: [],
      protectedPaths: [],
      requirements: [{ id: "tool.package-manager", scope: "repository", constraint: { kind: "one-of", values: ["npm"] } }],
      rootEntries: [],
    });
    const discovery = writeJson("discovery.json", {
      requirementObservations: [
        { id: "tool.package-manager", scope: "repository", source: REPOSITORY_PROFILE_RUN_DECLARATION_SOURCE, state: "observed", value: "npm" },
      ],
    });
    expect(main([directory, "--discovery", discovery])).toBe(0);
  });
});

describe("repository-profile-check: --help", () => {
  it("prints usage and returns 0 without requiring a path", () => {
    expect(main(["--help"])).toBe(0);
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("Usage: repository-profile-check"));
  });
});
