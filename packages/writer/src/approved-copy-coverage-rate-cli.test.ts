import { spawnSync } from "node:child_process";
import { chmodSync, cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { WriterRateCliInputError, isDirectInvocation, main } from "./approved-copy-coverage-rate-cli.js";

let root: string;
let binPath: string;
let workDir: string;

function evidence(id: string) {
  return [{ id, description: "Independent observation evidence." }];
}

function satisfied(): Record<string, unknown> {
  return {
    asOf: "2026-09-18T12:00:00Z",
    declaredCopy: [{ id: "copy-one" }],
    observations: [{
      copyId: "copy-one",
      independent: true,
      approved: true,
      traceable: true,
      resolvedFromRegistry: true,
      observerRef: "observer-a",
      evidence: evidence("evidence-one"),
    }],
  };
}

function violated(): Record<string, unknown> {
  return {
    ...satisfied(),
    observations: [{
      copyId: "copy-one",
      independent: true,
      approved: true,
      traceable: true,
      resolvedFromRegistry: false,
      observerRef: "observer-a",
      evidence: evidence("evidence-one"),
    }],
  };
}

function write(name: string, value: unknown): string {
  const path = join(root, name);
  writeFileSync(path, typeof value === "string" ? value : JSON.stringify(value));
  return path;
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "writer-rate-check-"));
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

beforeAll(() => {
  const packageRoot = fileURLToPath(new URL("..", import.meta.url));
  const compiler = fileURLToPath(new URL("../../../node_modules/typescript/bin/tsc", import.meta.url));
  const built = spawnSync(process.execPath, [compiler, "-p", "tsconfig.json"], { cwd: packageRoot, encoding: "utf8" });
  if (built.status !== 0) throw new Error(`Writer build failed: ${built.stderr || built.stdout}`);

  workDir = mkdtempSync(join(tmpdir(), "writer-rate-check-bin-"));
  const dotBin = join(workDir, "node_modules", ".bin");
  mkdirSync(dotBin, { recursive: true });
  const installedDistDir = join(workDir, "dist");
  mkdirSync(installedDistDir, { recursive: true });
  for (const file of ["approved-copy-coverage-rate-cli.js", "approved-copy-coverage-rate.js"]) {
    cpSync(join(packageRoot, "dist", file), join(installedDistDir, file));
  }
  const installedCliPath = join(installedDistDir, "approved-copy-coverage-rate-cli.js");
  chmodSync(installedCliPath, 0o755);
  binPath = join(dotBin, "writer-rate-check");
  symlinkSync(installedCliPath, binPath);
}, 60_000);

afterAll(() => {
  if (workDir) rmSync(workDir, { recursive: true, force: true });
});

function runBin(args: string[]) {
  const options = { encoding: "utf8" as const, timeout: 8_000 };
  let spawned = spawnSync(binPath, args, options);
  if (spawned.error) spawned = spawnSync(process.execPath, [binPath, ...args], options);
  return spawned;
}

describe("writer-rate-check", () => {
  it("maps satisfied, violated, and indeterminate reports to 0, 1, and 2", () => {
    expect(main([write("satisfied.json", satisfied())])).toBe(0);
    expect(main([write("violated.json", violated())])).toBe(1);
    expect(main([write("empty.json", { asOf: "2026-09-18T12:00:00Z", declaredCopy: [], observations: [] })])).toBe(2);
  });

  it("uses exit-2 input semantics and documents the tri-state contract", () => {
    expect(() => main([])).toThrow(WriterRateCliInputError);
    expect(() => main([join(root, "missing.json")])).toThrow(WriterRateCliInputError);
    expect(main(["--help"])).toBe(0);
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("0 = satisfied, 1 = violated, 2 = indeterminate"));
  });

  it("recognizes invocation through an installed-style POSIX bin symlink", () => {
    const sourceUrl = new URL("./approved-copy-coverage-rate-cli.ts", import.meta.url);
    const linked = join(root, "writer-rate-check");
    symlinkSync(fileURLToPath(sourceUrl), linked);
    expect(isDirectInvocation(sourceUrl.href, linked)).toBe(true);
  });
});

describe("writer-rate-check, invoked through a node_modules/.bin-shaped symlink", () => {
  it("exits 0 with a satisfied report", () => {
    const result = runBin([write("satisfied.json", satisfied())]);
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ state: "satisfied", metric: "approved copy coverage rate", rate: 1 });
  });

  it("exits 2 for a missing file without computing a rate of 1", () => {
    const result = runBin([join(root, "missing.json")]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("does not exist");
    expect(result.stdout).not.toMatch(/"rate": 1/);
  });
});
