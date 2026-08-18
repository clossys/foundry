import { describe, expect, it } from "vitest";
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
