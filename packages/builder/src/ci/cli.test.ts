import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { writeObservationBundle } from "../observation-bundle.js";
import type { ObservationBundleGateEntry } from "../observation-bundle.js";
import { CliInputError, main, parseArgs, renderReport } from "./cli.js";
import type { CliPort } from "./cli.js";
import { TOOLCHAIN_VERIFY_INPUTS_VERSION, verifyToolchain } from "./toolchain-cli.js";
import { MINIMUM_SAFE_VERSION } from "./version.js";

const goodInputsJson = JSON.stringify({
  schemaVersion: TOOLCHAIN_VERIFY_INPUTS_VERSION,
  declaration: {
    runtime: { name: "node", version: "20.11.1" },
    packageManager: { name: "npm", version: "10.5.0" },
    buildOrder: { packages: ["policy", "governance", "builder"] },
  },
  observation: {
    runtime: { attempted: true, live: "20.11.1" },
    packageManager: { attempted: true, live: "10.5.0" },
    buildOrder: { attempted: true, live: ["policy", "governance", "builder"] },
  },
});

function createPort(files: Record<string, string>, ownVersion: string | undefined = MINIMUM_SAFE_VERSION): {
  port: CliPort;
  out: string[];
  err: string[];
} {
  const out: string[] = [];
  const err: string[] = [];
  const port: CliPort = {
    readTextFile: (path) => {
      const contents = files[path];
      if (contents === undefined) throw new Error(`ENOENT: ${path}`);
      return contents;
    },
    writeOut: (text) => out.push(text),
    writeErr: (text) => err.push(text),
    resolveOwnVersion: () => ownVersion,
  };
  return { port, out, err };
}

describe("parseArgs", () => {
  it("parses --inputs, --format, --minimum-version, --declared-range", () => {
    const args = parseArgs(["--inputs", "in.json", "--format", "json", "--minimum-version", "0.2.0", "--declared-range", "~0.2.0"]);
    expect(args).toEqual({
      inputsPath: "in.json",
      minimumVersion: "0.2.0",
      declaredRange: "~0.2.0",
      format: "json",
      help: false,
    });
  });

  it("throws CliInputError for an unknown flag", () => {
    expect(() => parseArgs(["--nope"])).toThrow(CliInputError);
  });

  it("throws CliInputError for a bare positional argument", () => {
    expect(() => parseArgs(["stray"])).toThrow(CliInputError);
  });

  it("throws CliInputError for an invalid --format value", () => {
    expect(() => parseArgs(["--format", "xml"])).toThrow(CliInputError);
  });
});

describe("main", () => {
  it("exits 0 and prints VERIFIED for a clean, current run", () => {
    const { port, out } = createPort({ "in.json": goodInputsJson });
    const code = main(["--inputs", "in.json"], port);
    expect(code).toBe(0);
    expect(out.join("")).toContain("Overall: VERIFIED");
  });

  it("--help prints usage and exits 0 without touching the filesystem", () => {
    const { port, out } = createPort({});
    const code = main(["--help"], port);
    expect(code).toBe(0);
    expect(out.join("")).toContain("Usage: builder-verify-toolchain");
  });

  it("exits 2 when --inputs is missing", () => {
    const { port, err } = createPort({});
    const code = main([], port);
    expect(code).toBe(2);
    expect(err.join("")).toContain("--inputs is required");
  });

  it("exits 2 for an unparseable inputs file, never crashing the process", () => {
    const { port } = createPort({ "in.json": "{not json" });
    const code = main(["--inputs", "in.json"], port);
    expect(code).toBe(2);
  });

  it("exits 2 for an unusable flag before ever touching a file", () => {
    const { port, err } = createPort({});
    const code = main(["--format", "xml"], port);
    expect(code).toBe(2);
    expect(err.join("")).toContain("--format must be");
  });

  it("--format json prints machine-readable output with the real exit code embedded", () => {
    const { port, out } = createPort({ "in.json": goodInputsJson });
    const code = main(["--inputs", "in.json", "--format", "json"], port);
    const parsed = JSON.parse(out.join(""));
    expect(parsed.exitCode).toBe(code);
  });

  it("the decision step's return value is never a promise -- main is synchronous", () => {
    const { port } = createPort({ "in.json": goodInputsJson });
    const result = main(["--inputs", "in.json"], port);
    expect(result).not.toBeInstanceOf(Promise);
    expect(typeof result).toBe("number");
  });
});

describe("renderReport", () => {
  it("names a could-not-verify row's reason and states that a green result elsewhere is not evidence", () => {
    const report = verifyToolchain(undefined, { installedVersion: MINIMUM_SAFE_VERSION });
    const text = renderReport(report);
    expect(text).toContain("could-not-verify");
    expect(text).toContain("is not evidence");
  });
});

// ---------------------------------------------------------------------
// aggregate-observations, check-observation-freshness, deployment-health --
// the three subcommands added for #377 (aggregateObservations,
// checkObservationAggregateFreshness, evaluateDeploymentHealth previously
// had no CLI path anywhere in this package).
// ---------------------------------------------------------------------

const NOW = "2026-08-18T12:00:00.000Z";
const ONE_HOUR_MS = 60 * 60 * 1000;
const ONE_DAY_MS = 24 * ONE_HOUR_MS;

function satisfiedGate(gateId: string): ObservationBundleGateEntry {
  return { gateId, result: { verdict: "satisfied", evaluated: 1 } };
}

function violatedGate(gateId: string): ObservationBundleGateEntry {
  return { gateId, result: { verdict: "violated", findings: [{ rule: "example/rule", severity: "high", message: "broke" }] } };
}

function bundleFor(repositoryId: string, gates: ObservationBundleGateEntry[], producedAt = NOW): unknown {
  return JSON.parse(writeObservationBundle({ repository: { id: repositoryId }, producedAt, gates }));
}

describe("main — aggregate-observations", () => {
  it("exits 0 and reports SATISFIED when every expected repository was observed and clean", () => {
    const inputs = JSON.stringify({
      expectedRepositories: ["repo-a", "repo-b"],
      bundles: [bundleFor("repo-a", [satisfiedGate("secret-scan")]), bundleFor("repo-b", [satisfiedGate("secret-scan")])],
      now: NOW,
      staleAfterMs: ONE_HOUR_MS,
      maxResultAgeMs: ONE_DAY_MS,
    });
    const { port, out } = createPort({ "in.json": inputs });
    const code = main(["aggregate-observations", "--inputs", "in.json"], port);
    expect(code).toBe(0);
    expect(out.join("")).toContain("Overall: SATISFIED");
  });

  it("exits 1 when a repository's own bundle reports a real violation", () => {
    const inputs = JSON.stringify({
      expectedRepositories: ["repo-a"],
      bundles: [bundleFor("repo-a", [violatedGate("secret-scan")])],
      now: NOW,
      staleAfterMs: ONE_HOUR_MS,
      maxResultAgeMs: ONE_DAY_MS,
    });
    const { port, out } = createPort({ "in.json": inputs });
    const code = main(["aggregate-observations", "--inputs", "in.json"], port);
    expect(code).toBe(1);
    expect(out.join("")).toContain("Overall: VIOLATED");
  });

  it("exits 2 (indeterminate) when an expected repository was never observed", () => {
    const inputs = JSON.stringify({ expectedRepositories: ["repo-a", "repo-b"], bundles: [], now: NOW, staleAfterMs: ONE_HOUR_MS, maxResultAgeMs: ONE_DAY_MS });
    const { port, out } = createPort({ "in.json": inputs });
    const code = main(["aggregate-observations", "--inputs", "in.json"], port);
    expect(code).toBe(2);
    expect(out.join("")).toContain("unobserved-repository");
  });

  it("exits 2 for an inputs document that does not match AggregateObservationsInput", () => {
    const { port, err } = createPort({ "in.json": JSON.stringify({ bundles: "not-an-array" }) });
    const code = main(["aggregate-observations", "--inputs", "in.json"], port);
    expect(code).toBe(2);
    expect(err.join("")).toContain("does not match AggregateObservationsInput");
  });

  it("exits 2 when --inputs is missing", () => {
    const { port, err } = createPort({});
    const code = main(["aggregate-observations"], port);
    expect(code).toBe(2);
    expect(err.join("")).toContain("--inputs is required");
  });

  it("--help prints its own usage and exits 0 without touching the filesystem", () => {
    const { port, out } = createPort({});
    const code = main(["aggregate-observations", "--help"], port);
    expect(code).toBe(0);
    expect(out.join("")).toContain("Usage: builder-verify-toolchain aggregate-observations");
  });

  it("--format json embeds the real exit code and never throws out of the process", () => {
    const inputs = JSON.stringify({ expectedRepositories: ["repo-a"], bundles: [bundleFor("repo-a", [satisfiedGate("g")])], now: NOW, staleAfterMs: ONE_HOUR_MS, maxResultAgeMs: ONE_DAY_MS });
    const { port, out } = createPort({ "in.json": inputs });
    const code = main(["aggregate-observations", "--inputs", "in.json", "--format", "json"], port);
    const parsed = JSON.parse(out.join(""));
    expect(parsed.overall.verdict).toBe("satisfied");
    expect(code).toBe(0);
  });
});

describe("main — check-observation-freshness", () => {
  it("exits 0 and reports CURRENT when the stored result is within its declared age", () => {
    const inputs = JSON.stringify({ computedAt: NOW, maxResultAgeMs: ONE_HOUR_MS, now: NOW });
    const { port, out } = createPort({ "in.json": inputs });
    const code = main(["check-observation-freshness", "--inputs", "in.json"], port);
    expect(code).toBe(0);
    expect(out.join("")).toContain("CURRENT");
  });

  it("exits 2 (indeterminate) once the stored result exceeds its own declared maxResultAgeMs", () => {
    const later = new Date(new Date(NOW).getTime() + 2 * ONE_HOUR_MS).toISOString();
    const inputs = JSON.stringify({ computedAt: NOW, maxResultAgeMs: ONE_HOUR_MS, now: later });
    const { port, out } = createPort({ "in.json": inputs });
    const code = main(["check-observation-freshness", "--inputs", "in.json", "--format", "json"], port);
    expect(code).toBe(2);
    const parsed = JSON.parse(out.join(""));
    expect(parsed).toEqual({ verdict: "indeterminate", reason: "stale-aggregate-result", detail: expect.any(String) });
  });

  it("exits 2 for an inputs document that does not match CheckObservationAggregateFreshnessInput", () => {
    const { port, err } = createPort({ "in.json": JSON.stringify({ computedAt: NOW }) });
    const code = main(["check-observation-freshness", "--inputs", "in.json"], port);
    expect(code).toBe(2);
    expect(err.join("")).toContain("does not match CheckObservationAggregateFreshnessInput");
  });

  it("--help prints its own usage and exits 0", () => {
    const { port, out } = createPort({});
    const code = main(["check-observation-freshness", "--help"], port);
    expect(code).toBe(0);
    expect(out.join("")).toContain("Usage: builder-verify-toolchain check-observation-freshness");
  });
});

describe("main — deployment-health", () => {
  it("exits 0 and reports HEALTHY when every observation is healthy", () => {
    const inputs = JSON.stringify({ observations: [{ surfaceId: "web", status: "healthy" }] });
    const { port, out } = createPort({ "in.json": inputs });
    const code = main(["deployment-health", "--inputs", "in.json"], port);
    expect(code).toBe(0);
    expect(out.join("")).toContain("Overall: HEALTHY");
  });

  it("exits 1 when a surface is unhealthy -- a real finding", () => {
    const inputs = JSON.stringify({ observations: [{ surfaceId: "web", status: "healthy" }, { surfaceId: "api", status: "unhealthy" }] });
    const { port, out } = createPort({ "in.json": inputs });
    const code = main(["deployment-health", "--inputs", "in.json"], port);
    expect(code).toBe(1);
    expect(out.join("")).toContain("Overall: UNHEALTHY");
  });

  it("exits 2 (indeterminate) when no observation was recognized at all, including zero observations", () => {
    const { port, out } = createPort({ "in.json": JSON.stringify({ observations: [] }) });
    const code = main(["deployment-health", "--inputs", "in.json"], port);
    expect(code).toBe(2);
    expect(out.join("")).toContain("Overall: UNKNOWN");
  });

  it("exits 2 for an inputs document with an unrecognized status value", () => {
    const { port, err } = createPort({ "in.json": JSON.stringify({ observations: [{ surfaceId: "web", status: "on-fire" }] }) });
    const code = main(["deployment-health", "--inputs", "in.json"], port);
    expect(code).toBe(2);
    expect(err.join("")).toContain("does not match");
  });

  it("--help prints its own usage and exits 0", () => {
    const { port, out } = createPort({});
    const code = main(["deployment-health", "--help"], port);
    expect(code).toBe(0);
    expect(out.join("")).toContain("Usage: builder-verify-toolchain deployment-health");
  });
});

// ---------------------------------------------------------------------
// REGRESSION (defect of exactly this kind shipped once already, per #377's
// own text): dispatch must key off the literal `argv[0]`, never off the
// invoked binary's path or filename (`basename(process.argv[1])`). This
// repository always invokes a gate by its compiled path (e.g. `node
// packages/builder/dist/ci/bin.js`), so a basename-keyed dispatch would
// always see `bin.js` -- the SAME value for every subcommand and the
// no-subcommand path alike -- and could never actually tell them apart;
// every other
// test in this file calls `main(argv, port)` in-process and would never
// have caught that, since it never exercises `process.argv[1]` at all.
// This is the suite that spawns the REAL compiled `dist/ci/bin.js` as a
// real subprocess and asserts its real exit code, for all four commands.
// ---------------------------------------------------------------------

describe("dist/ci/bin.js — direct-path subprocess reachability", () => {
  // The compiled entry this repository (and `package.json`'s own `bin` map)
  // actually invokes is `bin.js`, not `cli.js` -- `cli.js` only exports
  // `main`, it never calls it. Spawning `cli.js` directly would silently
  // print nothing and exit 0 (module loaded, `main` never invoked), which
  // is precisely the kind of "looks reachable, is not" defect #377 warns
  // about -- so this suite spawns the same file `builder-verify-toolchain`
  // resolves to.
  const cliPath = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "dist", "ci", "bin.js");
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "builder-ci-cli-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function writeInputs(name: string, value: unknown): string {
    const path = join(dir, name);
    writeFileSync(path, JSON.stringify(value), "utf8");
    return path;
  }

  function runRealCli(args: string[]): { status: number; stdout: string; stderr: string } {
    try {
      const stdout = execFileSync("node", [cliPath, ...args], { encoding: "utf8" });
      return { status: 0, stdout, stderr: "" };
    } catch (error) {
      const err = error as { status?: number | null; stdout?: string; stderr?: string };
      return { status: typeof err.status === "number" ? err.status : Number.NaN, stdout: err.stdout ?? "", stderr: err.stderr ?? "" };
    }
  }

  it("`node dist/ci/bin.js aggregate-observations --inputs <file>` exits 0 on a clean, fully observed run", () => {
    const inputsPath = writeInputs("aggregate.json", {
      expectedRepositories: ["repo-a"],
      bundles: [bundleFor("repo-a", [satisfiedGate("secret-scan")])],
      now: NOW,
      staleAfterMs: ONE_HOUR_MS,
      maxResultAgeMs: ONE_DAY_MS,
    });
    const result = runRealCli(["aggregate-observations", "--inputs", inputsPath]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Overall: SATISFIED");
  });

  it("`node dist/ci/bin.js check-observation-freshness --inputs <file>` exits 0 on a current stored result", () => {
    const inputsPath = writeInputs("freshness.json", { computedAt: NOW, maxResultAgeMs: ONE_HOUR_MS, now: NOW });
    const result = runRealCli(["check-observation-freshness", "--inputs", inputsPath]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("CURRENT");
  });

  it("`node dist/ci/bin.js deployment-health --inputs <file>` exits 1 on a real unhealthy finding", () => {
    const inputsPath = writeInputs("health.json", { observations: [{ surfaceId: "api", status: "unhealthy" }] });
    const result = runRealCli(["deployment-health", "--inputs", inputsPath]);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("Overall: UNHEALTHY");
  });

  it("`node dist/ci/bin.js --inputs <file>` with NO subcommand still runs the pre-existing toolchain check, unchanged", () => {
    const inputsPath = writeInputs("toolchain.json", JSON.parse(goodInputsJson));
    const result = runRealCli(["--inputs", inputsPath]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Overall: VERIFIED");
  });
});
