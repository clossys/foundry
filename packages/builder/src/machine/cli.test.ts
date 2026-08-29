import { describe, expect, it } from "vitest";
import { applyComposedInstallation } from "../composition.js";
import { createMemoryFileSystem } from "../memory-fs.test-helper.js";
import { createRuntimeContext, planInstallation } from "../runtime.js";
import { CliInputError, main, parseArgs, renderReport } from "./cli.js";
import type { CliPort } from "./cli.js";
import { createMemoryDiscoveryFileSystem } from "./memory-discovery.test-helper.js";
import { MACHINE_VERIFY_INPUTS_VERSION } from "./report.js";
import { buildSkillsManifest } from "./skills-manifest.js";
import { WORKSPACE_MARKER_FILENAME } from "./types.js";
import type { MemoryDiscoveryFileSystem } from "./memory-discovery.test-helper.js";
import type { MemoryFileSystem } from "../memory-fs.test-helper.js";

const home = "/home/op";
const accountsRoot = "/code/accounts";
const composedSkillsRoot = `${home}/.agents/skills`;

function workspaceMarker(account: string, skillsPath = "skills"): string {
  return JSON.stringify({ schemaVersion: 1, account, skillsPath });
}

function goodInputsJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    schemaVersion: MACHINE_VERIFY_INPUTS_VERSION,
    home,
    composedSkillsRoot,
    accountWorkspacesRoot: accountsRoot,
    ...overrides,
  });
}

function createPort(
  files: Record<string, string>,
  discovery: MemoryDiscoveryFileSystem,
  filesystem: MemoryFileSystem,
): { port: CliPort; out: string[]; err: string[] } {
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
    discovery,
    filesystem,
    env: {},
  };
  return { port, out, err };
}

describe("parseArgs", () => {
  it("parses --inputs and --format", () => {
    expect(parseArgs(["--inputs", "in.json", "--format", "json"])).toEqual({
      inputsPath: "in.json",
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

describe("main — exit codes and reporting", () => {
  it("--help prints usage and exits 0 without touching either port", () => {
    const discovery = createMemoryDiscoveryFileSystem();
    const filesystem = createMemoryFileSystem();
    const { port, out } = createPort({}, discovery, filesystem);
    const code = main(["--help"], port);
    expect(code).toBe(0);
    expect(out.join("")).toContain("Usage: builder-verify-machine");
  });

  it("exits 2 when --inputs is missing", () => {
    const discovery = createMemoryDiscoveryFileSystem();
    const filesystem = createMemoryFileSystem();
    const { port, err } = createPort({}, discovery, filesystem);
    const code = main([], port);
    expect(code).toBe(2);
    expect(err.join("")).toContain("--inputs is required");
  });

  it("exits 2 when the inputs document cannot be read", () => {
    const discovery = createMemoryDiscoveryFileSystem();
    const filesystem = createMemoryFileSystem();
    const { port, err } = createPort({}, discovery, filesystem);
    const code = main(["--inputs", "missing.json"], port);
    expect(code).toBe(2);
    expect(err.join("")).toContain("could not read the inputs document");
  });

  it("exits 2, INDETERMINATE, when a declared source cannot be resolved", () => {
    const discovery = createMemoryDiscoveryFileSystem();
    // Declares itself a workspace (marker present) but the marker is malformed --
    // indeterminate, not silently excluded.
    discovery.setFile(`${accountsRoot}/broken/${WORKSPACE_MARKER_FILENAME}`, "not json");
    const filesystem = createMemoryFileSystem();
    const { port, out } = createPort({ "in.json": goodInputsJson() }, discovery, filesystem);

    const code = main(["--inputs", "in.json"], port);
    expect(code).toBe(2);
    const text = out.join("");
    expect(text).toContain("Overall: INDETERMINATE");
    expect(text).toContain("could-not-verify");
  });

  it("exits 1, VIOLATED, and names the destination when a link has not been applied yet", () => {
    const discovery = createMemoryDiscoveryFileSystem();
    discovery.setFile(`${accountsRoot}/alpha/${WORKSPACE_MARKER_FILENAME}`, workspaceMarker("alpha-account"));
    discovery.setDirectory(`${accountsRoot}/alpha/skills/greet`);
    const filesystem = createMemoryFileSystem();
    filesystem.setDirectory(`${accountsRoot}/alpha/skills/greet`);
    const { port, out } = createPort({ "in.json": goodInputsJson() }, discovery, filesystem);

    const code = main(["--inputs", "in.json"], port);
    expect(code).toBe(1);
    const text = out.join("");
    expect(text).toContain("Overall: VIOLATED");
    // The finding names the actual composed destination that disagreed.
    expect(text).toContain(`${composedSkillsRoot}/greet`);
    expect(text).toContain("install/link-missing");
  });

  it("exits 0, SATISFIED, and reports every managed destination as resolved once applied", () => {
    const discovery = createMemoryDiscoveryFileSystem();
    discovery.setFile(`${accountsRoot}/alpha/${WORKSPACE_MARKER_FILENAME}`, workspaceMarker("alpha-account"));
    discovery.setDirectory(`${accountsRoot}/alpha/skills/greet`);
    const filesystem = createMemoryFileSystem();
    filesystem.setDirectory(`${accountsRoot}/alpha/skills/greet`);

    const manifest = buildSkillsManifest(["greet"], { composedSkillsRoot });
    const runtime = createRuntimeContext(manifest, {
      home,
      sourceRoot: `${accountsRoot}/alpha/skills`,
      workspaceRoot: home,
    });
    const plan = planInstallation(manifest, runtime);
    applyComposedInstallation([{ source: "alpha-account", plan }], filesystem, {
      backupRoot: `${home}/.config-backups/run-1`,
    });

    const { port, out } = createPort({ "in.json": goodInputsJson() }, discovery, filesystem);
    const code = main(["--inputs", "in.json"], port);
    expect(code).toBe(0);
    const text = out.join("");
    expect(text).toContain("Overall: SATISFIED");
    expect(text).toContain("resolved");
  });

  it("emits valid JSON carrying the same exit code when --format json is passed", () => {
    const discovery = createMemoryDiscoveryFileSystem();
    discovery.setFile(`${accountsRoot}/alpha/${WORKSPACE_MARKER_FILENAME}`, workspaceMarker("alpha-account"));
    discovery.setDirectory(`${accountsRoot}/alpha/skills/greet`);
    const filesystem = createMemoryFileSystem();
    filesystem.setDirectory(`${accountsRoot}/alpha/skills/greet`);
    const { port, out } = createPort({ "in.json": goodInputsJson() }, discovery, filesystem);

    const code = main(["--inputs", "in.json", "--format", "json"], port);
    const parsed = JSON.parse(out.join("")) as { exitCode: number; overall: { verdict: string } };
    expect(parsed.exitCode).toBe(code);
    expect(parsed.overall.verdict).toBe("violated");
  });
});

describe("renderReport", () => {
  it("explains that an indeterminate result is a failure, not a warning", () => {
    const discovery = createMemoryDiscoveryFileSystem();
    const filesystem = createMemoryFileSystem();
    const { port, out } = createPort({ "in.json": "{}" }, discovery, filesystem);
    main(["--inputs", "in.json"], port);
    expect(out.join("")).toContain("failure, not a warning");
  });

  it("renderReport is directly callable without going through main", () => {
    const report = {
      rows: [],
      overall: { verdict: "indeterminate" as const, reason: "no-inputs-supplied" as const },
      exitCode: 2 as const,
    };
    expect(renderReport(report)).toContain("Overall: INDETERMINATE (exit 2)");
  });

  it("escapes a pre-escaped pipe and flattens CRLF inside a table cell", () => {
    const report = {
      rows: [{ row: "destination\\|name\r\nnext", result: { verdict: "satisfied" as const, evaluated: 1 } }],
      overall: { verdict: "satisfied" as const, evaluated: 1 },
      exitCode: 0 as const,
    };
    expect(renderReport(report)).toContain("destination\\\\\\|name next");
  });
});
