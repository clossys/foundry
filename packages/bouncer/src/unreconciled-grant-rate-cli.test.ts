import { spawn, spawnSync } from "node:child_process";
import { chmodSync, cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { BouncerRateCliInputError, isDirectInvocation, main } from "./unreconciled-grant-rate-cli.js";

let root: string;
let binPath: string;
let workDir: string;

function evidence(id: string) {
  return [{ id, description: "Independent observation evidence." }];
}

function satisfied(): Record<string, unknown> {
  return {
    asOf: "2026-09-18T12:00:00Z",
    declaredGrants: [{ id: "grant-one" }],
    observations: [{
      grantId: "grant-one",
      independent: true,
      backed: true,
      observerRef: "observer-a",
      evidence: evidence("evidence-one"),
    }],
  };
}

function violated(): Record<string, unknown> {
  return {
    ...satisfied(),
    observations: [{
      grantId: "grant-one",
      independent: true,
      backed: false,
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
  root = mkdtempSync(join(tmpdir(), "bouncer-rate-check-"));
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
  if (built.status !== 0) throw new Error(`Bouncer build failed: ${built.stderr || built.stdout}`);

  workDir = mkdtempSync(join(tmpdir(), "bouncer-rate-check-bin-"));
  const dotBin = join(workDir, "node_modules", ".bin");
  mkdirSync(dotBin, { recursive: true });
  const installedDistDir = join(workDir, "dist");
  mkdirSync(installedDistDir, { recursive: true });
  for (const file of ["unreconciled-grant-rate-cli.js", "unreconciled-grant-rate.js"]) {
    cpSync(join(packageRoot, "dist", file), join(installedDistDir, file));
  }
  const installedCliPath = join(installedDistDir, "unreconciled-grant-rate-cli.js");
  chmodSync(installedCliPath, 0o755);
  binPath = join(dotBin, "bouncer-rate-check");
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

describe("bouncer-rate-check", () => {
  it("maps satisfied, violated, and indeterminate reports to 0, 1, and 2", () => {
    expect(main([write("satisfied.json", satisfied())])).toBe(0);
    expect(main([write("violated.json", violated())])).toBe(1);
    expect(main([write("empty.json", { asOf: "2026-09-18T12:00:00Z", declaredGrants: [], observations: [] })])).toBe(2);
  });

  it("uses exit-2 input semantics and documents the tri-state contract", () => {
    expect(() => main([])).toThrow(BouncerRateCliInputError);
    expect(() => main([join(root, "missing.json")])).toThrow(BouncerRateCliInputError);
    expect(main(["--help"])).toBe(0);
    expect(main(["-h"])).toBe(0);
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("0 = satisfied, 1 = violated, 2 = indeterminate"));
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("bouncer-check remains the three-gate CLI"));
  });

  it("recognizes invocation through an installed-style POSIX bin symlink", () => {
    const sourceUrl = new URL("./unreconciled-grant-rate-cli.ts", import.meta.url);
    const linked = join(root, "bouncer-rate-check");
    symlinkSync(fileURLToPath(sourceUrl), linked);
    expect(isDirectInvocation(sourceUrl.href, linked)).toBe(true);
  });
});

describe("bouncer-rate-check, invoked through a node_modules/.bin-shaped symlink", () => {
  it("--help produces non-empty stdout and exits 0", async () => {
    const result = await runBin(["--help"]);
    expect(result.status).toBe(0);
    expect(result.stdout.length).toBeGreaterThan(0);
    expect(result.stdout).toContain("Usage: bouncer-rate-check");
  });

  it("exits 0 with a satisfied report", async () => {
    const result = await runBin([write("satisfied.json", satisfied())]);
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ state: "satisfied", metric: "unreconciled grant rate", rate: 0 });
  });

  it("exits 1 with a violated report", async () => {
    const result = await runBin([write("violated.json", violated())]);
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({ state: "violated", metric: "unreconciled grant rate" });
  });

  it("exits 2 for a missing file without computing a rate of 0", async () => {
    const result = await runBin([join(root, "missing.json")]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("does not exist");
    expect(result.stdout).not.toMatch(/"rate": 0/);
  });

  it("exits 2 for unreadable JSON without computing a rate of 0", async () => {
    const result = await runBin([write("broken.json", "{ not json")]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("unreadable JSON");
    expect(result.stdout).not.toMatch(/"rate": 0/);
  });
});
