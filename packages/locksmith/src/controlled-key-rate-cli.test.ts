import { spawnSync } from "node:child_process";
import { chmodSync, cpSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { LocksmithCliInputError, isDirectInvocation, main } from "./controlled-key-rate-cli.js";

let root: string;
let binPath: string;

function evidence(id: string) {
  return [{ id, description: "Independent observation evidence." }];
}

function satisfied(): Record<string, unknown> {
  return {
    asOf: "2026-09-18T12:00:00Z",
    declaredKeys: [{ id: "key-one" }],
    observations: [{
      keyId: "key-one",
      independent: true,
      owned: true,
      current: true,
      correctlyDistributed: true,
      revocable: true,
      observerRef: "observer-a",
      evidence: evidence("evidence-one"),
    }],
  };
}

function violated(): Record<string, unknown> {
  return {
    ...satisfied(),
    observations: [{
      ...(satisfied().observations as Record<string, unknown>[])[0],
      revocable: false,
    }],
  };
}

function write(name: string, value: unknown): string {
  const path = join(root, name);
  writeFileSync(path, typeof value === "string" ? value : JSON.stringify(value));
  return path;
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "locksmith-check-"));
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

beforeAll(() => {
  const packageRoot = fileURLToPath(new URL("..", import.meta.url));
  const compiler = fileURLToPath(new URL("../../../node_modules/typescript/bin/tsc", import.meta.url));
  const built = spawnSync(process.execPath, [compiler, "-p", "tsconfig.json"], { cwd: packageRoot, encoding: "utf8" });
  if (built.status !== 0) throw new Error(`Locksmith build failed: ${built.stderr || built.stdout}`);

  const workDir = mkdtempSync(join(tmpdir(), "locksmith-check-bin-"));
  const dotBin = join(workDir, "node_modules", ".bin");
  mkdirSync(dotBin, { recursive: true });
  const installedDistDir = join(workDir, "dist");
  mkdirSync(installedDistDir, { recursive: true });
  for (const file of ["controlled-key-rate-cli.js", "controlled-key-rate.js"]) {
    cpSync(join(packageRoot, "dist", file), join(installedDistDir, file));
  }
  const installedCliPath = join(installedDistDir, "controlled-key-rate-cli.js");
  chmodSync(installedCliPath, 0o755);
  binPath = join(dotBin, "locksmith-check");
  symlinkSync(installedCliPath, binPath);
}, 60_000);

function runBin(args: string[]) {
  const options = { encoding: "utf8" as const, timeout: 8_000 };
  let spawned = spawnSync(binPath, args, options);
  if (spawned.error) spawned = spawnSync(process.execPath, [binPath, ...args], options);
  return spawned;
}

describe("locksmith-check", () => {
  it("maps satisfied, violated, and indeterminate reports to 0, 1, and 2", () => {
    expect(main([write("satisfied.json", satisfied())])).toBe(0);
    expect(main([write("violated.json", violated())])).toBe(1);
    expect(main([write("empty.json", { asOf: "2026-09-18T12:00:00Z", declaredKeys: [], observations: [] })])).toBe(2);
  });

  it("uses exit-2 input semantics and documents the tri-state contract", () => {
    expect(() => main([])).toThrow(LocksmithCliInputError);
    expect(() => main([join(root, "missing.json")])).toThrow(LocksmithCliInputError);
    expect(main(["--help"])).toBe(0);
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("0 = satisfied, 1 = violated, 2 = indeterminate"));
  });

  it("recognizes invocation through an installed-style POSIX bin symlink", () => {
    const sourceUrl = new URL("./controlled-key-rate-cli.ts", import.meta.url);
    const linked = join(root, "locksmith-check");
    symlinkSync(fileURLToPath(sourceUrl), linked);
    expect(isDirectInvocation(sourceUrl.href, linked)).toBe(true);
  });
});

describe("locksmith-check, invoked through a node_modules/.bin-shaped symlink", () => {
  it("exits 0 with a satisfied report", () => {
    const result = runBin([write("satisfied.json", satisfied())]);
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ state: "satisfied", metric: "controlled key rate", rate: 1 });
  });

  it("exits 2 for a missing file without computing a rate of 1", () => {
    const result = runBin([join(root, "missing.json")]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("does not exist");
    expect(result.stdout).not.toMatch(/"rate": 1/);
  });
});
