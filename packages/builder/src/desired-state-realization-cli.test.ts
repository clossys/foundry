import { spawnSync } from "node:child_process";
import { chmodSync, cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { BuilderCliInputError, isDirectInvocation, main } from "./desired-state-realization-cli.js";

let root: string;
let binPath: string;
let workDir: string;

function evidence(id: string) {
  return [{ id, description: "Independent observation evidence." }];
}

function satisfied(): Record<string, unknown> {
  return {
    asOf: "2026-09-18T12:00:00Z",
    declaredSubjects: [{ id: "subject-one" }],
    observations: [{
      subjectId: "subject-one",
      independent: true,
      verified: true,
      observerRef: "observer-a",
      evidence: evidence("evidence-one"),
    }],
  };
}

function violated(): Record<string, unknown> {
  return {
    ...satisfied(),
    observations: [{
      subjectId: "subject-one",
      independent: true,
      verified: false,
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
  root = mkdtempSync(join(tmpdir(), "builder-check-"));
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
  if (built.status !== 0) throw new Error(`Builder build failed: ${built.stderr || built.stdout}`);

  workDir = mkdtempSync(join(tmpdir(), "builder-check-bin-"));
  const dotBin = join(workDir, "node_modules", ".bin");
  mkdirSync(dotBin, { recursive: true });
  const installedDistDir = join(workDir, "dist");
  mkdirSync(installedDistDir, { recursive: true });
  for (const file of ["desired-state-realization-cli.js", "desired-state-realization.js"]) {
    cpSync(join(packageRoot, "dist", file), join(installedDistDir, file));
  }
  const installedCliPath = join(installedDistDir, "desired-state-realization-cli.js");
  chmodSync(installedCliPath, 0o755);
  binPath = join(dotBin, "builder-check");
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

describe("builder-check", () => {
  it("maps satisfied, violated, and indeterminate reports to 0, 1, and 2", () => {
    expect(main([write("satisfied.json", satisfied())])).toBe(0);
    expect(main([write("violated.json", violated())])).toBe(1);
    expect(main([write("empty.json", { asOf: "2026-09-18T12:00:00Z", declaredSubjects: [], observations: [] })])).toBe(2);
  });

  it("uses exit-2 input semantics and documents the tri-state contract", () => {
    expect(() => main([])).toThrow(BuilderCliInputError);
    expect(() => main([join(root, "missing.json")])).toThrow(BuilderCliInputError);
    expect(main(["--help"])).toBe(0);
    expect(main(["-h"])).toBe(0);
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("0 = satisfied, 1 = violated, 2 = indeterminate"));
  });

  it("recognizes invocation through an installed-style POSIX bin symlink", () => {
    const sourceUrl = new URL("./desired-state-realization-cli.ts", import.meta.url);
    const linked = join(root, "builder-check");
    symlinkSync(fileURLToPath(sourceUrl), linked);
    expect(isDirectInvocation(sourceUrl.href, linked)).toBe(true);
  });
});

describe("builder-check, invoked through a node_modules/.bin-shaped symlink", () => {
  it("--help produces non-empty stdout and exits 0", () => {
    const result = runBin(["--help"]);
    expect(result.status).toBe(0);
    expect(result.stdout.length).toBeGreaterThan(0);
    expect(result.stdout).toContain("Usage: builder-check");
  });

  it("exits 0 with a satisfied report", () => {
    const path = write("satisfied.json", satisfied());
    const result = runBin([path]);
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ state: "satisfied", metric: "desired-state realization rate", rate: 1 });
  });

  it("exits 1 with a violated report", () => {
    const path = write("violated.json", violated());
    const result = runBin([path]);
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({ state: "violated", metric: "desired-state realization rate" });
  });

  it("exits 2 for a missing file without computing a rate of 1", () => {
    const result = runBin([join(root, "missing.json")]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("does not exist");
    expect(result.stdout).not.toMatch(/"rate": 1/);
  });

  it("exits 2 for unreadable JSON without computing a rate of 1", () => {
    const path = write("broken.json", "{ not json");
    const result = runBin([path]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("unreadable JSON");
    expect(result.stdout).not.toMatch(/"rate": 1/);
  });
});
