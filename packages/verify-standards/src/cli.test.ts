import { describe, expect, it } from "vitest";
import { CliInputError, USAGE, main, parseArgs } from "./cli.js";
import type { CliPort } from "./cli.js";
import { VERIFY_STANDARDS_INPUTS_VERSION } from "./verify.js";

/**
 * A port that reads from an in-memory map. Nothing in this file touches a
 * real filesystem, spawns a process, or opens a socket — the CLI's only
 * outside contact is this object, which is the whole reason it is injected.
 */
function testPort(
  files: Record<string, string> = {},
  // `versionUnresolvable` is a separate flag rather than `version: undefined`
  // because a default parameter treats an explicitly-passed `undefined` as
  // absent, which silently turned the "build cannot name itself" case back
  // into an ordinary current build.
  options: { readonly version?: string; readonly versionUnresolvable?: boolean } = {},
): CliPort & { out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    readTextFile(path: string): string {
      const content = files[path];
      if (content === undefined) throw new Error(`no such file: ${path}`);
      return content;
    },
    writeOut: (text) => void out.push(text),
    writeErr: (text) => void err.push(text),
    resolveOwnVersion: () => (options.versionUnresolvable === true ? undefined : (options.version ?? "9.9.9")),
  };
}

const cleanInputs = JSON.stringify({
  schemaVersion: VERIFY_STANDARDS_INPUTS_VERSION,
  secretScan: {
    observation: {
      attempted: true,
      toolName: "example-scanner",
      toolVersion: "8.30.1",
      exitCode: 0,
      scope: "full-history",
      unitsScanned: 5,
      hits: [],
    },
  },
});

describe("parseArgs", () => {
  it("defaults to running every check", () => {
    expect(parseArgs(["--inputs", "in.json"]).checks).toHaveLength(4);
  });

  it("accepts a narrowed selection", () => {
    expect(parseArgs(["--inputs", "in.json", "--checks", "secret-scan, policy-drift"]).checks).toEqual([
      "secret-scan",
      "policy-drift",
    ]);
  });

  it("rejects an unknown check rather than silently running fewer", () => {
    // Dropping a misspelled name would run fewer checks than were asked for
    // and still report success for the rest.
    expect(() => parseArgs(["--checks", "secret-scam"])).toThrow(CliInputError);
  });

  it.each([["--inputs"], ["--checks"], ["--minimum-version"], ["--declared-range"]])(
    "rejects %s with no value",
    (flag) => {
      expect(() => parseArgs([flag])).toThrow(CliInputError);
    },
  );

  it.each([["--nope"], ["a-positional"]])("rejects %s", (arg) => {
    expect(() => parseArgs([arg])).toThrow(CliInputError);
  });

  it("rejects an unsupported format", () => {
    expect(() => parseArgs(["--format", "yaml"])).toThrow(CliInputError);
  });
});

describe("main", () => {
  it("exits 0 and renders a table for a clean run", () => {
    const port = testPort({ "in.json": cleanInputs });
    const code = main(["--inputs", "in.json", "--checks", "secret-scan"], port);
    expect(code).toBe(0);
    expect(port.out.join("")).toContain("| secret-scan | satisfied |");
    expect(port.out.join("")).toContain("Overall: SATISFIED (exit 0)");
  });

  it("exits 2 when --inputs is missing", () => {
    const port = testPort();
    expect(main([], port)).toBe(2);
    expect(port.err.join("")).toContain("--inputs is required");
  });

  it("exits 2 when the inputs file cannot be read", () => {
    const port = testPort();
    expect(main(["--inputs", "absent.json"], port)).toBe(2);
    expect(port.err.join("")).toContain("could not read the inputs document");
  });

  it("exits 2 when the inputs file is not valid JSON", () => {
    const port = testPort({ "in.json": "{ not json" });
    expect(main(["--inputs", "in.json"], port)).toBe(2);
  });

  it("exits 2 for a bad flag, never 1", () => {
    // Bad input is "could not run", not "ran and found a problem".
    const port = testPort();
    expect(main(["--format", "xml"], port)).toBe(2);
  });

  it("exits 0 for --help and prints the exit-code contract", () => {
    const port = testPort();
    expect(main(["--help"], port)).toBe(0);
    expect(port.out.join("")).toBe(USAGE);
    expect(USAGE).toContain("0 = satisfied, 1 = violated, 2 = could not evaluate");
  });

  it("exits 2 when this build cannot determine its own version", () => {
    const port = testPort({ "in.json": cleanInputs }, { versionUnresolvable: true });
    expect(main(["--inputs", "in.json", "--checks", "secret-scan"], port)).toBe(2);
    expect(port.out.join("")).toContain("unknown-installed-version");
  });

  it("exits 2 when the caller's declared range still admits a pre-floor build", () => {
    const port = testPort({ "in.json": cleanInputs });
    const code = main(
      ["--inputs", "in.json", "--checks", "secret-scan", "--minimum-version", "5.0.0", "--declared-range", "^1.0.0"],
      port,
    );
    expect(code).toBe(2);
    expect(port.out.join("")).toContain("declared-range-permits-stale-version");
  });

  it("exits 1 when a check found a real problem", () => {
    const port = testPort({
      "in.json": JSON.stringify({
        schemaVersion: VERIFY_STANDARDS_INPUTS_VERSION,
        secretScan: {
          observation: {
            attempted: true,
            toolName: "example-scanner",
            toolVersion: "8.30.1",
            exitCode: 1,
            scope: "full-history",
            unitsScanned: 5,
            hits: [{ ruleId: "generic-api-key", path: "src/a.ts" }],
          },
        },
      }),
    });
    expect(main(["--inputs", "in.json", "--checks", "secret-scan"], port)).toBe(1);
    expect(port.out.join("")).toContain("Overall: VIOLATED (exit 1)");
  });

  it("offers no flag that turns an indeterminate result into a pass", () => {
    // The absence is the feature: a per-consumer waiver here would launder
    // one repository's exception into every consumer of the package at once.
    expect(USAGE).not.toMatch(/--(allow|accept|ignore|skip|waive)/);
  });

  it("emits machine-readable JSON carrying the reason and exit code", () => {
    const port = testPort({ "in.json": cleanInputs });
    const code = main(["--inputs", "in.json", "--checks", "task-record", "--format", "json"], port);
    expect(code).toBe(2);
    const report = JSON.parse(port.out.join("")) as {
      exitCode: number;
      overall: { verdict: string; reason?: string };
    };
    expect(report.exitCode).toBe(2);
    expect(report.overall).toMatchObject({ verdict: "indeterminate", reason: "no-observation-supplied" });
  });

  it("escapes a pipe in a finding so it cannot break the rendered table", () => {
    const port = testPort({
      "in.json": JSON.stringify({
        schemaVersion: VERIFY_STANDARDS_INPUTS_VERSION,
        secretScan: {
          observation: {
            attempted: true,
            toolName: "example-scanner",
            toolVersion: "1.0.0",
            exitCode: 1,
            scope: "working-tree",
            unitsScanned: 1,
            hits: [{ ruleId: "r", path: "a|b.ts" }],
          },
        },
      }),
    });
    main(["--inputs", "in.json", "--checks", "secret-scan"], port);
    expect(port.out.join("")).toContain("a\\|b.ts");
  });
});
