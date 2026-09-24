import { spawn } from "node:child_process";
import { chmodSync, cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ObserverCliInputError, isDirectInvocation, main } from "./unobserved-outcome-cli.js";

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
      presence: { state: "observed", eventCount: 1 },
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
      presence: { state: "unobserved" },
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
  root = mkdtempSync(join(tmpdir(), "observer-check-"));
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

beforeAll(() => {
  const packageRoot = fileURLToPath(new URL("..", import.meta.url));
  // dist/ was built once, before any test file started, by the package's
  // vitest globalSetup (scripts/lib/vitest-build-package.mjs). Never rebuild
  // it here: a sibling test file may be executing or packing it (#1385).

  workDir = mkdtempSync(join(tmpdir(), "observer-check-bin-"));
  const dotBin = join(workDir, "node_modules", ".bin");
  mkdirSync(dotBin, { recursive: true });
  const installedDistDir = join(workDir, "dist");
  mkdirSync(installedDistDir, { recursive: true });
  for (const file of ["unobserved-outcome-cli.js", "unobserved-outcome-rate.js", "unobserved-surface.js"]) {
    cpSync(join(packageRoot, "dist", file), join(installedDistDir, file));
  }
  const installedCliPath = join(installedDistDir, "unobserved-outcome-cli.js");
  chmodSync(installedCliPath, 0o755);
  binPath = join(dotBin, "observer-check");
  symlinkSync(installedCliPath, binPath);
}, 60_000);

afterAll(() => {
  if (workDir) rmSync(workDir, { recursive: true, force: true });
});

/**
 * Runs the installed CLI bin and resolves once its stdout/stderr have fully
 * ended AND the process has exited -- never before.
 *
 * #1333/#1341: the equivalent `spawnSync` call flaked in CI under load with
 * `result.status` set (the child really did exit) but `result.stdout`
 * empty -- a report the exit code says exists but the capture missed.
 * `spawnSync`'s synchronous capture is its own internal poll loop outside
 * Node's normal stream machinery, and that loop is what a heavily loaded CI
 * runner's scheduling can starve. `spawn()`'s stdout/stderr are ordinary
 * `Readable` streams, whose contract guarantees every byte written is
 * delivered via `data` events before `end` fires, and the `close` handler
 * below -- which Node fires only after the process has exited AND both
 * stdio streams have ended -- cannot observe an exit code before the output
 * that produced it has been fully read.
 */
function spawnCapture(
  command: string,
  args: string[],
  options: { timeout: number },
): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, options);
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", rejectPromise);
    child.on("close", (status) => {
      resolvePromise({ status, stdout, stderr });
    });
  });
}

async function runBin(args: string[]) {
  const options = { timeout: 8_000 };
  try {
    return await spawnCapture(binPath, args, options);
  } catch {
    return await spawnCapture(process.execPath, [binPath, ...args], options);
  }
}

describe("observer-check", () => {
  it("maps satisfied, violated, and indeterminate reports to 0, 1, and 2", () => {
    expect(main([write("satisfied.json", satisfied())])).toBe(0);
    expect(main([write("violated.json", violated())])).toBe(1);
    expect(main([write("empty.json", { asOf: "2026-09-18T12:00:00Z", declaredSubjects: [], observations: [] })])).toBe(2);
  });

  it("uses exit-2 input semantics and documents the tri-state contract", () => {
    expect(() => main([])).toThrow(ObserverCliInputError);
    expect(() => main([join(root, "missing.json")])).toThrow(ObserverCliInputError);
    expect(main(["--help"])).toBe(0);
    expect(main(["-h"])).toBe(0);
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("0 = satisfied, 1 = violated, 2 = indeterminate"));
  });

  it("recognizes invocation through an installed-style POSIX bin symlink", () => {
    const sourceUrl = new URL("./unobserved-outcome-cli.ts", import.meta.url);
    const linked = join(root, "observer-check");
    symlinkSync(fileURLToPath(sourceUrl), linked);
    expect(isDirectInvocation(sourceUrl.href, linked)).toBe(true);
  });
});

describe("observer-check, invoked through a node_modules/.bin-shaped symlink", () => {
  it("--help produces non-empty stdout and exits 0", async () => {
    const result = await runBin(["--help"]);
    expect(result.status).toBe(0);
    expect(result.stdout.length).toBeGreaterThan(0);
    expect(result.stdout).toContain("Usage: observer-check");
  });

  it("exits 0 with a satisfied report", async () => {
    const path = write("satisfied.json", satisfied());
    const result = await runBin([path]);
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ state: "satisfied", metric: "unobserved outcome rate", rate: 0 });
  });

  it("exits 1 with a violated report", async () => {
    const path = write("violated.json", violated());
    const result = await runBin([path]);
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({ state: "violated", metric: "unobserved outcome rate" });
  });

  it("exits 2 for a missing file without computing a rate of 0", async () => {
    const result = await runBin([join(root, "missing.json")]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("does not exist");
    expect(result.stdout).not.toMatch(/"rate": 0/);
  });

  it("exits 2 for unreadable JSON without computing a rate of 0", async () => {
    const path = write("broken.json", "{ not json");
    const result = await runBin([path]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("unreadable JSON");
    expect(result.stdout).not.toMatch(/"rate": 0/);
  });
});
