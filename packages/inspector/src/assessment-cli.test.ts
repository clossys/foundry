import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { InspectorCliInputError, isDirectInvocation, main } from "./assessment-cli.js";
import { VERIFY_STANDARDS_INPUTS_VERSION } from "./verify.js";

const packageJson = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "package.json"), "utf8")) as {
  bin?: Record<string, string>;
  foundry?: { assessment?: { bin?: string; invocation?: string } };
};

let root: string;
let binPath: string;

function satisfied(): Record<string, unknown> {
  return {
    schemaVersion: VERIFY_STANDARDS_INPUTS_VERSION,
    selectedChecks: ["secret-scan"],
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
  };
}

function violated(): Record<string, unknown> {
  return {
    ...satisfied(),
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
  };
}

function write(name: string, value: unknown): string {
  const path = join(root, name);
  writeFileSync(path, typeof value === "string" ? value : JSON.stringify(value));
  return path;
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "inspector-check-"));
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

beforeAll(() => {
  const packageRoot = fileURLToPath(new URL("..", import.meta.url));
  const compiler = fileURLToPath(new URL("../../../node_modules/typescript/bin/tsc", import.meta.url));
  const built = spawnSync(process.execPath, [compiler, "-p", "tsconfig.json"], { cwd: packageRoot, encoding: "utf8" });
  if (built.status !== 0) throw new Error(`Inspector build failed: ${built.stderr || built.stdout}`);

  const workDir = mkdtempSync(join(tmpdir(), "inspector-check-bin-"));
  const dotBin = join(workDir, "node_modules", ".bin");
  mkdirSync(dotBin, { recursive: true });
  const installedCliPath = join(packageRoot, "dist", "assessment-cli.js");
  binPath = join(dotBin, "inspector-check");
  symlinkSync(installedCliPath, binPath);
}, 60_000);

function runBin(args: string[]) {
  return spawnSync(process.execPath, [binPath, ...args], { encoding: "utf8", timeout: 8_000 });
}

describe("inspector-check", () => {
  it("maps satisfied, violated, and indeterminate reports to 0, 1, and 2", () => {
    expect(main([write("satisfied.json", satisfied())], "9.9.9")).toBe(0);
    const printed = JSON.parse((console.log as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0] as string) as Record<string, unknown>;
    expect(printed).toMatchObject({ state: "satisfied", proposedPositions: [], exitCode: 0 });
    expect(printed).not.toHaveProperty("metric");
    expect(printed).not.toHaveProperty("rate");
    expect(main([write("violated.json", violated())], "9.9.9")).toBe(1);
    expect(main([write("empty-selection.json", { ...satisfied(), selectedChecks: [] })], "9.9.9")).toBe(2);
  });

  it("uses exit-2 input semantics and documents the tri-state contract", () => {
    expect(() => main([])).toThrow(InspectorCliInputError);
    expect(() => main([join(root, "missing.json")])).toThrow(InspectorCliInputError);
    expect(() => main([write("broken.json", "{ not json")])).toThrow(InspectorCliInputError);
    expect(() => main([write("unknown-check.json", { ...satisfied(), selectedChecks: ["escape-rate"] })])).toThrow(InspectorCliInputError);
    expect(main(["--help"])).toBe(0);
    expect(main(["-h"])).toBe(0);
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("0 = satisfied, 1 = violated, 2 = indeterminate"));
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("does not compute change escape rate"));
  });

  it("never takes installedVersion from the assessment file", () => {
    expect(main([write("forged-version.json", { ...satisfied(), installedVersion: "0.0.1" })], "9.9.9")).toBe(0);
  });

  it("recognizes invocation through an installed-style POSIX bin symlink", () => {
    const sourceUrl = new URL("./assessment-cli.ts", import.meta.url);
    const linked = join(root, "inspector-check");
    symlinkSync(fileURLToPath(sourceUrl), linked);
    expect(isDirectInvocation(sourceUrl.href, linked)).toBe(true);
  });
});

describe("inspector-check, invoked through a node_modules/.bin-shaped symlink", () => {
  it("--help produces non-empty stdout and exits 0", () => {
    const result = runBin(["--help"]);
    expect(result.status).toBe(0);
    expect(result.stdout.length).toBeGreaterThan(0);
    expect(result.stdout).toContain("Usage: inspector-check");
    expect(result.stdout).toContain("does not compute change escape rate");
  });

  it("exits 0 with a satisfied pre-landing report and no escape-rate fields", () => {
    const path = write("satisfied.json", satisfied());
    const result = runBin([path]);
    expect(result.status).toBe(0);
    const report = JSON.parse(result.stdout) as Record<string, unknown>;
    expect(report).toMatchObject({ state: "satisfied", proposedPositions: [], exitCode: 0 });
    expect(report).not.toHaveProperty("metric");
    expect(report).not.toHaveProperty("rate");
  });

  it("exits 1 with a violated report", () => {
    const result = runBin([write("violated.json", violated())]);
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({ state: "violated" });
  });

  it("exits 2 for a missing file without computing a rate", () => {
    const result = runBin([join(root, "missing.json")]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("does not exist");
    expect(result.stdout).not.toMatch(/"rate":/);
  });

  it("declares foundry.assessment against the mapped inspector-check bin, not inspector --inputs", () => {
    expect(packageJson.foundry?.assessment).toEqual({
      bin: "inspector-check",
      invocation: "single-json-input",
    });
    expect(packageJson.bin?.["inspector-check"]).toBe("dist/assessment-cli.js");
    expect(packageJson.bin?.inspector).toBe("dist/bin.js");
  });
});
