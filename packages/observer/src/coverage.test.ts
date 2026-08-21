import { describe, expect, it } from "vitest";
import { COVERAGE_DECLARATION_SCHEMA_VERSION } from "./coverage-declaration.js";
import {
  fleetCoverageVerdictToExitCode,
  gradeFleetCoverage,
  type FleetCoverageInput,
  type FleetRepositoryCoverageInput,
} from "./coverage.js";

const PACKAGES = ["@vespeneventures/observer", "@vespeneventures/controller"] as const;

function repo(overrides: Partial<FleetRepositoryCoverageInput> & { repository: string }): FleetRepositoryCoverageInput {
  return {
    declaration: undefined,
    installed: { packages: [] },
    ...overrides,
  };
}

describe("gradeFleetCoverage — the three-state classification", () => {
  it("classifies a package present in the installed inventory as installed", () => {
    const input: FleetCoverageInput = {
      packages: [...PACKAGES],
      repositories: [
        repo({
          repository: "repo-a",
          installed: { packages: [{ name: "@vespeneventures/observer" }, { name: "@vespeneventures/controller" }] },
        }),
      ],
    };
    const report = gradeFleetCoverage(input);
    expect(report.cells.every((cell) => cell.state === "installed")).toBe(true);
    expect(report.countsByState).toEqual({ installed: 2, declaredAbsent: 0, unclassified: 0 });
    expect(report.result).toEqual({ verdict: "satisfied", evaluated: 2 });
  });

  it("classifies a validly declared-absent package as declared-absent, carrying the stated reason", () => {
    const input: FleetCoverageInput = {
      packages: [...PACKAGES],
      repositories: [
        repo({
          repository: "repo-a",
          declaration: {
            schemaVersion: COVERAGE_DECLARATION_SCHEMA_VERSION,
            repository: "repo-a",
            declaredAbsences: [
              { package: "@vespeneventures/observer", reason: "this repository has no telemetry lane" },
              { package: "@vespeneventures/controller", reason: "no gates run here" },
            ],
          },
        }),
      ],
    };
    const report = gradeFleetCoverage(input);
    expect(report.cells.every((cell) => cell.state === "declared-absent")).toBe(true);
    const observerCell = report.cells.find((cell) => cell.package === "@vespeneventures/observer");
    expect(observerCell).toMatchObject({ state: "declared-absent", reason: "this repository has no telemetry lane" });
    expect(report.countsByState).toEqual({ installed: 0, declaredAbsent: 2, unclassified: 0 });
    expect(report.result.verdict).toBe("satisfied");
  });

  it("classifies a package neither installed nor declared as unclassified: not-installed-and-not-declared", () => {
    const input: FleetCoverageInput = {
      packages: [...PACKAGES],
      repositories: [repo({ repository: "repo-a" })],
    };
    const report = gradeFleetCoverage(input);
    expect(report.cells.every((cell) => cell.state === "unclassified")).toBe(true);
    expect(report.cells.every((cell) => cell.state === "unclassified" && cell.reason === "not-installed-and-not-declared")).toBe(true);
    expect(report.countsByState.unclassified).toBe(2);
  });

  it("classifies as unclassified when the installed inventory itself could not be read", () => {
    const input: FleetCoverageInput = {
      packages: [...PACKAGES],
      repositories: [repo({ repository: "repo-a", installed: undefined })],
    };
    const report = gradeFleetCoverage(input);
    expect(report.cells.every((cell) => cell.state === "unclassified" && cell.reason === "installed-inventory-unreadable")).toBe(
      true,
    );
  });

  it("a valid declared-absence still resolves even when the installed inventory could not be read", () => {
    const input: FleetCoverageInput = {
      packages: [...PACKAGES],
      repositories: [
        repo({
          repository: "repo-a",
          installed: undefined,
          declaration: {
            schemaVersion: COVERAGE_DECLARATION_SCHEMA_VERSION,
            repository: "repo-a",
            declaredAbsences: [{ package: "@vespeneventures/observer", reason: "no lane" }],
          },
        }),
      ],
    };
    const report = gradeFleetCoverage(input);
    const observerCell = report.cells.find((cell) => cell.package === "@vespeneventures/observer");
    const controllerCell = report.cells.find((cell) => cell.package === "@vespeneventures/controller");
    expect(observerCell?.state).toBe("declared-absent");
    expect(controllerCell).toMatchObject({ state: "unclassified", reason: "installed-inventory-unreadable" });
  });

  it("classifies as unclassified — declaration-unreadable — when a declaration was supplied but fails validation", () => {
    const input: FleetCoverageInput = {
      packages: [...PACKAGES],
      repositories: [repo({ repository: "repo-a", declaration: { garbage: true } })],
    };
    const report = gradeFleetCoverage(input);
    expect(report.cells.every((cell) => cell.state === "unclassified" && cell.reason === "declaration-unreadable")).toBe(true);
  });

  it("a package confirmed installed still resolves to installed even when the declaration is unreadable", () => {
    const input: FleetCoverageInput = {
      packages: [...PACKAGES],
      repositories: [
        repo({
          repository: "repo-a",
          declaration: { garbage: true },
          installed: { packages: [{ name: "@vespeneventures/observer" }] },
        }),
      ],
    };
    const report = gradeFleetCoverage(input);
    const observerCell = report.cells.find((cell) => cell.package === "@vespeneventures/observer");
    const controllerCell = report.cells.find((cell) => cell.package === "@vespeneventures/controller");
    expect(observerCell?.state).toBe("installed");
    expect(controllerCell).toMatchObject({ state: "unclassified", reason: "declaration-unreadable" });
  });

  it("a declared absence with an empty reason does not qualify as declared-absent (fails to unclassified)", () => {
    const input: FleetCoverageInput = {
      packages: [...PACKAGES],
      repositories: [
        repo({
          repository: "repo-a",
          declaration: {
            schemaVersion: COVERAGE_DECLARATION_SCHEMA_VERSION,
            repository: "repo-a",
            declaredAbsences: [{ package: "@vespeneventures/observer", reason: "" }],
          },
        }),
      ],
    };
    const report = gradeFleetCoverage(input);
    // The whole declaration is invalid (an empty reason fails shape validation), so every
    // package in this repository is unclassified via declaration-unreadable, not silently
    // treated as "no absence declared".
    expect(report.cells.every((cell) => cell.state === "unclassified" && cell.reason === "declaration-unreadable")).toBe(true);
  });
});

describe("gradeFleetCoverage — contradictions", () => {
  it("resolves a package both installed and declared-absent as installed, and records a contradiction", () => {
    const input: FleetCoverageInput = {
      packages: ["@vespeneventures/observer"],
      repositories: [
        repo({
          repository: "repo-a",
          installed: { packages: [{ name: "@vespeneventures/observer" }] },
          declaration: {
            schemaVersion: COVERAGE_DECLARATION_SCHEMA_VERSION,
            repository: "repo-a",
            declaredAbsences: [{ package: "@vespeneventures/observer", reason: "believed unused" }],
          },
        }),
      ],
    };
    const report = gradeFleetCoverage(input);
    expect(report.cells[0]).toMatchObject({ state: "installed" });
    expect(report.contradictions).toEqual([
      { package: "@vespeneventures/observer", repository: "repo-a", declaredReason: "believed unused" },
    ]);
    expect(report.result).toEqual({ verdict: "violated", findings: report.contradictions });
  });

  it("indeterminate (unclassified cells) takes precedence over violated (contradictions) when both are present", () => {
    const input: FleetCoverageInput = {
      packages: [...PACKAGES],
      repositories: [
        repo({
          repository: "repo-a",
          installed: { packages: [{ name: "@vespeneventures/observer" }] },
          declaration: {
            schemaVersion: COVERAGE_DECLARATION_SCHEMA_VERSION,
            repository: "repo-a",
            declaredAbsences: [{ package: "@vespeneventures/observer", reason: "believed unused" }],
          },
        }),
        // repo-b has an unrelated unclassified cell (no inventory).
        repo({ repository: "repo-b", installed: undefined }),
      ],
    };
    const report = gradeFleetCoverage(input);
    expect(report.contradictions).toHaveLength(1);
    expect(report.countsByState.unclassified).toBeGreaterThan(0);
    expect(report.result.verdict).toBe("indeterminate");
  });
});

describe("gradeFleetCoverage — the #338 guard: an empty matrix is never satisfied", () => {
  it("returns indeterminate, never satisfied, for zero packages", () => {
    const report = gradeFleetCoverage({ packages: [], repositories: [repo({ repository: "repo-a" })] });
    expect(report.result.verdict).toBe("indeterminate");
    expect(report.cells).toEqual([]);
  });

  it("returns indeterminate, never satisfied, for zero repositories", () => {
    const report = gradeFleetCoverage({ packages: [...PACKAGES], repositories: [] });
    expect(report.result.verdict).toBe("indeterminate");
    expect(report.cells).toEqual([]);
  });

  it("returns indeterminate, never satisfied, for zero packages AND zero repositories", () => {
    const report = gradeFleetCoverage({ packages: [], repositories: [] });
    expect(report.result.verdict).toBe("indeterminate");
  });
});

describe("gradeFleetCoverage — caller preconditions", () => {
  it("throws on a duplicate package identifier", () => {
    expect(() =>
      gradeFleetCoverage({
        packages: ["@vespeneventures/observer", "@vespeneventures/observer"],
        repositories: [repo({ repository: "repo-a" })],
      }),
    ).toThrow(/duplicate/);
  });

  it("throws on a duplicate repository identifier", () => {
    expect(() =>
      gradeFleetCoverage({
        packages: [...PACKAGES],
        repositories: [repo({ repository: "repo-a" }), repo({ repository: "repo-a" })],
      }),
    ).toThrow(/duplicate/);
  });

  it("throws on an empty package identifier", () => {
    expect(() => gradeFleetCoverage({ packages: [""], repositories: [repo({ repository: "repo-a" })] })).toThrow(/empty string/);
  });

  it("throws on an empty repository identifier", () => {
    expect(() => gradeFleetCoverage({ packages: [...PACKAGES], repositories: [repo({ repository: "" })] })).toThrow(/empty string/);
  });
});

describe("gradeFleetCoverage — matrix shape", () => {
  it("produces exactly packages.length * repositories.length cells, dropping none", () => {
    const input: FleetCoverageInput = {
      packages: [...PACKAGES],
      repositories: [repo({ repository: "repo-a" }), repo({ repository: "repo-b" }), repo({ repository: "repo-c" })],
    };
    const report = gradeFleetCoverage(input);
    expect(report.cells).toHaveLength(PACKAGES.length * 3);
    expect(report.countsByState.installed + report.countsByState.declaredAbsent + report.countsByState.unclassified).toBe(
      report.cells.length,
    );
  });
});

describe("fleetCoverageVerdictToExitCode", () => {
  it("maps satisfied to 0, violated to 1, indeterminate to 2", () => {
    expect(fleetCoverageVerdictToExitCode({ verdict: "satisfied", evaluated: 1 })).toBe(0);
    expect(fleetCoverageVerdictToExitCode({ verdict: "violated", findings: [] })).toBe(1);
    expect(fleetCoverageVerdictToExitCode({ verdict: "indeterminate", reason: "x", detail: "y" })).toBe(2);
  });
});
