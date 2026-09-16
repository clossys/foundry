import { describe, expect, it } from "vitest";
import { COVERAGE_DECLARATION_SCHEMA_VERSION } from "./coverage-declaration.js";
import {
  fleetCoverageVerdictToExitCode,
  gradeFleetCoverage,
  type FleetCoverageInput,
  type FleetRepositoryCoverageInput,
} from "./coverage.js";

const PACKAGES = ["@clossys/observer", "@clossys/controller"] as const;

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
          installed: { packages: [{ name: "@clossys/observer" }, { name: "@clossys/controller" }] },
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
              { package: "@clossys/observer", reason: "this repository has no telemetry lane" },
              { package: "@clossys/controller", reason: "no gates run here" },
            ],
          },
        }),
      ],
    };
    const report = gradeFleetCoverage(input);
    expect(report.cells.every((cell) => cell.state === "declared-absent")).toBe(true);
    const observerCell = report.cells.find((cell) => cell.package === "@clossys/observer");
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
            declaredAbsences: [{ package: "@clossys/observer", reason: "no lane" }],
          },
        }),
      ],
    };
    const report = gradeFleetCoverage(input);
    const observerCell = report.cells.find((cell) => cell.package === "@clossys/observer");
    const controllerCell = report.cells.find((cell) => cell.package === "@clossys/controller");
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
          installed: { packages: [{ name: "@clossys/observer" }] },
        }),
      ],
    };
    const report = gradeFleetCoverage(input);
    const observerCell = report.cells.find((cell) => cell.package === "@clossys/observer");
    const controllerCell = report.cells.find((cell) => cell.package === "@clossys/controller");
    expect(observerCell?.state).toBe("installed");
    expect(controllerCell).toMatchObject({ state: "unclassified", reason: "declaration-unreadable" });
  });

  it("issue #897 audit finding A: an all-installed catalogue with an unreadable declaration must NOT resolve to satisfied", () => {
    // Every package in this repository is genuinely installed (ground
    // truth). Its own coverage declaration was supplied but fails shape
    // validation. Before the fix, the `installedPackage !== undefined`
    // branch returned early without ever consulting `declarationIsInvalid`
    // -- the flag was reachable only on the not-installed path -- so this
    // exact input graded every cell "installed", zero unclassified, zero
    // contradictions, and a confident `satisfied`. A stale
    // `declared-absent` entry hiding inside the same malformed declaration
    // (undecidable, because the whole document failed to parse) would have
    // been silently unreportable. Unlike the pre-existing
    // "declaration is unreadable" test below, this uses a SINGLE-package,
    // all-installed catalogue on purpose: no sibling cell is unclassified,
    // so nothing else can push the aggregate off `satisfied` -- only this
    // fix does.
    const input: FleetCoverageInput = {
      packages: [...PACKAGES],
      repositories: [
        repo({
          repository: "repo-a",
          declaration: { garbage: true },
          installed: { packages: [{ name: "@clossys/observer" }, { name: "@clossys/controller" }] },
        }),
      ],
    };
    const report = gradeFleetCoverage(input);
    // Ground truth still wins for each cell's own state -- see
    // `FleetCoverageContradiction`'s doc comment in coverage.ts -- so both
    // cells stay classified "installed", not "unclassified".
    expect(report.cells.every((cell) => cell.state === "installed")).toBe(true);
    expect(report.countsByState).toEqual({ installed: 2, declaredAbsent: 0, unclassified: 0 });
    // The aggregate verdict is the load-bearing assertion this test exists
    // for: it must never be "satisfied" when a repository's declaration
    // could not be read, regardless of how cleanly every cell classified.
    expect(report.result.verdict).not.toBe("satisfied");
    expect(report.result.verdict).toBe("indeterminate");
    expect(report.unverifiedInstalledCells).toHaveLength(2);
    expect(report.unverifiedInstalledCells).toEqual(
      expect.arrayContaining([
        { package: "@clossys/observer", repository: "repo-a" },
        { package: "@clossys/controller", repository: "repo-a" },
      ]),
    );
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
            declaredAbsences: [{ package: "@clossys/observer", reason: "" }],
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

describe("gradeFleetCoverage — issue #897 audit finding B: the documented input now works", () => {
  it("a declaration passed as the raw JSON string body an HTTP GET actually returns is read correctly, contradiction and all", () => {
    // README.md and the CLI's own --help instruct the caller to pass "the
    // already-fetched body" of a repository's coverage-declaration file --
    // which, fetched with a bare HTTP GET against a raw-content endpoint (as
    // coverage-declaration.ts's own header specifies), is a STRING. Before
    // the fix this always failed validation (not-an-object) and, combined
    // with finding A, silently graded "satisfied". This test follows the
    // documentation literally -- a string, not a pre-parsed object -- end
    // to end through gradeFleetCoverage.
    const input: FleetCoverageInput = {
      packages: ["@clossys/observer"],
      repositories: [
        repo({
          repository: "repo-a",
          installed: { packages: [{ name: "@clossys/observer" }] },
          declaration: JSON.stringify({
            schemaVersion: COVERAGE_DECLARATION_SCHEMA_VERSION,
            repository: "repo-a",
            declaredAbsences: [{ package: "@clossys/observer", reason: "believed unused" }],
          }),
        }),
      ],
    };
    const report = gradeFleetCoverage(input);
    expect(report.cells[0]).toMatchObject({ state: "installed" });
    expect(report.contradictions).toEqual([
      { package: "@clossys/observer", repository: "repo-a", declaredReason: "believed unused" },
    ]);
    expect(report.result.verdict).toBe("violated");
  });
});

describe("gradeFleetCoverage — contradictions", () => {
  it("resolves a package both installed and declared-absent as installed, and records a contradiction", () => {
    const input: FleetCoverageInput = {
      packages: ["@clossys/observer"],
      repositories: [
        repo({
          repository: "repo-a",
          installed: { packages: [{ name: "@clossys/observer" }] },
          declaration: {
            schemaVersion: COVERAGE_DECLARATION_SCHEMA_VERSION,
            repository: "repo-a",
            declaredAbsences: [{ package: "@clossys/observer", reason: "believed unused" }],
          },
        }),
      ],
    };
    const report = gradeFleetCoverage(input);
    expect(report.cells[0]).toMatchObject({ state: "installed" });
    expect(report.contradictions).toEqual([
      { package: "@clossys/observer", repository: "repo-a", declaredReason: "believed unused" },
    ]);
    expect(report.result).toEqual({ verdict: "violated", findings: report.contradictions });
  });

  it("indeterminate (unclassified cells) takes precedence over violated (contradictions) when both are present", () => {
    const input: FleetCoverageInput = {
      packages: [...PACKAGES],
      repositories: [
        repo({
          repository: "repo-a",
          installed: { packages: [{ name: "@clossys/observer" }] },
          declaration: {
            schemaVersion: COVERAGE_DECLARATION_SCHEMA_VERSION,
            repository: "repo-a",
            declaredAbsences: [{ package: "@clossys/observer", reason: "believed unused" }],
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
        packages: ["@clossys/observer", "@clossys/observer"],
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
