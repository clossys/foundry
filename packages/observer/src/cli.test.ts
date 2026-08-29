import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { CliInputError, main, parseArgs, renderReport, type CliPort } from "./cli.js";
import { COVERAGE_DECLARATION_SCHEMA_VERSION } from "./coverage-declaration.js";
import { gradeFleetCoverage } from "./coverage.js";

function memoryPort(files: Record<string, string>): CliPort & { out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    readTextFile: (path) => {
      const content = files[path];
      if (content === undefined) throw new Error(`ENOENT: no such file, ${path}`);
      return content;
    },
    writeOut: (text) => out.push(text),
    writeErr: (text) => err.push(text),
  };
}

const satisfiedInput = {
  packages: ["@vespeneventures/observer"],
  repositories: [{ repository: "repo-a", installed: { packages: [{ name: "@vespeneventures/observer" }] } }],
};

const violatedInput = {
  packages: ["@vespeneventures/observer"],
  repositories: [
    {
      repository: "repo-a",
      installed: { packages: [{ name: "@vespeneventures/observer" }] },
      declaration: {
        schemaVersion: COVERAGE_DECLARATION_SCHEMA_VERSION,
        repository: "repo-a",
        declaredAbsences: [{ package: "@vespeneventures/observer", reason: "believed unused" }],
      },
    },
  ],
};

const indeterminateInput = {
  packages: ["@vespeneventures/observer"],
  repositories: [{ repository: "repo-a" }],
};

describe("parseArgs", () => {
  it("parses --input and defaults format to text", () => {
    const args = parseArgs(["--input", "fleet.json"]);
    expect(args).toEqual({ inputPath: "fleet.json", format: "text", help: false });
  });

  it("parses --format", () => {
    expect(parseArgs(["--input", "fleet.json", "--format", "json"]).format).toBe("json");
  });

  it("throws CliInputError on an invalid --format value", () => {
    expect(() => parseArgs(["--format", "xml"])).toThrow(CliInputError);
  });

  it("throws CliInputError when --input has no value", () => {
    expect(() => parseArgs(["--input"])).toThrow(CliInputError);
  });

  it("throws CliInputError on an unknown flag", () => {
    expect(() => parseArgs(["--bogus"])).toThrow(CliInputError);
  });

  it("throws CliInputError on an unexpected positional argument", () => {
    expect(() => parseArgs(["stray"])).toThrow(CliInputError);
  });

  it("recognizes --help", () => {
    expect(parseArgs(["--help"]).help).toBe(true);
    expect(parseArgs(["-h"]).help).toBe(true);
  });
});

describe("main — argument handling", () => {
  it("--help returns 0 and prints usage, without requiring --input", () => {
    const port = memoryPort({});
    expect(main(["--help"], port)).toBe(0);
    expect(port.out.join("")).toMatch(/Usage: observer-coverage-check/);
  });

  it("returns 2 when --input is missing", () => {
    const port = memoryPort({});
    expect(main([], port)).toBe(2);
    expect(port.err.join("")).toMatch(/--input is required/);
  });

  it("returns 2 on an unknown flag", () => {
    const port = memoryPort({});
    expect(main(["--bogus"], port)).toBe(2);
  });
});

describe("main — the third state: could not run", () => {
  it("returns 2 when the input file does not exist", () => {
    const port = memoryPort({});
    expect(main(["--input", "missing.json"], port)).toBe(2);
    expect(port.err.join("")).toMatch(/could not read or parse/);
  });

  it("returns 2 when the input file is not valid JSON", () => {
    const port = memoryPort({ "fleet.json": "{ not json" });
    expect(main(["--input", "fleet.json"], port)).toBe(2);
  });

  it("returns 2 when the input document is not an object", () => {
    const port = memoryPort({ "fleet.json": JSON.stringify(["nope"]) });
    expect(main(["--input", "fleet.json"], port)).toBe(2);
  });

  it("returns 2 when packages is missing", () => {
    const port = memoryPort({ "fleet.json": JSON.stringify({ repositories: [] }) });
    expect(main(["--input", "fleet.json"], port)).toBe(2);
  });

  it("returns 2 when repositories is missing", () => {
    const port = memoryPort({ "fleet.json": JSON.stringify({ packages: [] }) });
    expect(main(["--input", "fleet.json"], port)).toBe(2);
  });

  it("returns 2 when a repository entry has no repository id", () => {
    const port = memoryPort({ "fleet.json": JSON.stringify({ packages: ["p"], repositories: [{}] }) });
    expect(main(["--input", "fleet.json"], port)).toBe(2);
  });

  it("returns 2, never 0, for an empty matrix (packages: [], repositories: []) -- the #338 guard, end to end", () => {
    const port = memoryPort({ "fleet.json": JSON.stringify({ packages: [], repositories: [] }) });
    expect(main(["--input", "fleet.json"], port)).toBe(2);
    expect(port.out.join("")).toMatch(/INDETERMINATE/);
  });

  it("returns 2 when a cell is unclassified", () => {
    const port = memoryPort({ "fleet.json": JSON.stringify(indeterminateInput) });
    expect(main(["--input", "fleet.json"], port)).toBe(2);
    expect(port.out.join("")).toMatch(/INDETERMINATE/);
  });
});

describe("main — real runs", () => {
  it("returns 0 for a fully installed, clean matrix", () => {
    const port = memoryPort({ "fleet.json": JSON.stringify(satisfiedInput) });
    expect(main(["--input", "fleet.json"], port)).toBe(0);
    expect(port.out.join("")).toMatch(/SATISFIED/);
  });

  it("returns 1 for a matrix with a contradiction (installed AND declared-absent)", () => {
    const port = memoryPort({ "fleet.json": JSON.stringify(violatedInput) });
    expect(main(["--input", "fleet.json"], port)).toBe(1);
    expect(port.out.join("")).toMatch(/VIOLATED/);
  });

  it("emits valid JSON matching gradeFleetCoverage's own report when --format json is passed", () => {
    const port = memoryPort({ "fleet.json": JSON.stringify(satisfiedInput) });
    expect(main(["--input", "fleet.json", "--format", "json"], port)).toBe(0);
    const parsed = JSON.parse(port.out.join(""));
    expect(parsed.result.verdict).toBe("satisfied");
  });
});

describe("renderReport", () => {
  it("renders every cell, the counts, and the overall verdict", () => {
    const report = gradeFleetCoverage({
      packages: satisfiedInput.packages,
      repositories: satisfiedInput.repositories,
    });
    const rendered = renderReport(report);
    expect(rendered).toMatch(/@vespeneventures\/observer/);
    expect(rendered).toMatch(/installed=1/);
    expect(rendered).toMatch(/SATISFIED/);
  });

  it("renders contradictions when present", () => {
    const report = gradeFleetCoverage({
      packages: violatedInput.packages,
      repositories: violatedInput.repositories,
    });
    const rendered = renderReport(report);
    expect(rendered).toMatch(/Contradictions/);
    expect(rendered).toMatch(/believed unused/);
  });

  it("escapes a pre-escaped pipe and flattens CRLF inside a table cell", () => {
    const report = gradeFleetCoverage({
      packages: violatedInput.packages,
      repositories: [{
        ...violatedInput.repositories[0],
        repository: "repo\\|a\r\nnext",
      }],
    });
    expect(renderReport(report)).toContain("repo\\\\\\|a next");
  });
});

// -----------------------------------------------------------------------
// Direct-path reachability: spawn the REAL compiled dist/bin.js, not the
// exported main() this whole file otherwise calls directly.
//
// Every test above calls `main(argv, port)` in-process -- that proves the
// argv-to-exit-code CONTRACT, but it never proves the compiled binary this
// package actually SHIPS (`bin.observer-coverage-check` -> `dist/bin.js`,
// see package.json) reaches the same code path. #377's own header states
// this precisely: a name-dispatch design would be unreachable under this
// repository's own compiled-path invocation convention
// (`node packages/<pkg>/dist/...`, never an installed `bin` name) and would
// silently run the wrong thing rather than error -- this test exists
// specifically to prove the shipped artifact is reachable at all, not
// merely that the function it wraps behaves.
//
// "Did not throw" would prove nothing here: Node's own uncaught-exception
// default also exits 1, the identical code a real violation uses. Every
// assertion below reads the real, captured exit `status` from a real child
// process -- never through a pipe.
// -----------------------------------------------------------------------

describe("main — direct-path reachability (real compiled dist/bin.js)", () => {
  const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  let binPath: string;
  let fixtureDir: string;

  beforeAll(() => {
    execFileSync("npm", ["run", "build"], { cwd: packageDir, stdio: "pipe" });
    binPath = join(packageDir, "dist", "bin.js");
  }, 120_000);

  beforeEach(() => {
    fixtureDir = mkdtempSync(join(tmpdir(), "observer-cli-fixture-"));
  });

  afterEach(() => {
    rmSync(fixtureDir, { recursive: true, force: true });
  });

  function writeFixture(name: string, value: unknown): string {
    const path = join(fixtureDir, name);
    writeFileSync(path, JSON.stringify(value));
    return path;
  }

  function runCompiledCli(args: string[]): { status: number | null; stdout: string; stderr: string } {
    try {
      const stdout = execFileSync("node", [binPath, ...args], { encoding: "utf8" });
      return { status: 0, stdout, stderr: "" };
    } catch (error) {
      const e = error as { status: number | null; stdout?: string; stderr?: string };
      return { status: e.status, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
    }
  }

  it("real exit 0 on a satisfied run", () => {
    const inputPath = writeFixture("satisfied.json", satisfiedInput);
    const result = runCompiledCli(["--input", inputPath]);
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/SATISFIED/);
  });

  it("real exit 1 on a violated run", () => {
    const inputPath = writeFixture("violated.json", violatedInput);
    const result = runCompiledCli(["--input", inputPath]);
    expect(result.status).toBe(1);
    expect(result.stdout).toMatch(/VIOLATED/);
  });

  it("real exit 2 on an indeterminate run (unclassified cell)", () => {
    const inputPath = writeFixture("indeterminate.json", indeterminateInput);
    const result = runCompiledCli(["--input", inputPath]);
    expect(result.status).toBe(2);
    expect(result.stdout).toMatch(/INDETERMINATE/);
  });

  it("real exit 2, never 0, on an empty matrix -- the #338 guard against the real shipped binary", () => {
    const inputPath = writeFixture("empty.json", { packages: [], repositories: [] });
    const result = runCompiledCli(["--input", inputPath]);
    expect(result.status).toBe(2);
  });

  it("real exit 0 on --help", () => {
    const result = runCompiledCli(["--help"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/Usage: observer-coverage-check/);
  });
});
