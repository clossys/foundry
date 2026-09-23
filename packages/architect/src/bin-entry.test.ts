/**
 * #909: `architect-check` shipped dead. Every existing test in
 * `cli.test.ts` calls the exported `main(argv)` directly, which proves the
 * argv-to-exit-code contract but never touches `process.argv[1]` — so it
 * passed whether or not the real entry-point guard in `cli.ts` actually
 * worked. The guard compared `import.meta.url` (which Node always resolves
 * through symlinks) against `process.argv[1]` (which, for a consumer
 * running an installed CLI, is the `node_modules/.bin` symlink itself, not
 * the real file) — so they were never equal, `run()` never fired, and the
 * published binary produced exit 0 and zero bytes on every input,
 * including invalid input the documented contract says is a violation.
 *
 * This file reproduces the one topology that actually exercises the guard:
 * a real `node_modules/.bin`-shaped symlink, built fresh in a temp
 * directory (never the repository's own `node_modules/.bin`, which would
 * only prove this repository's own layout works), pointing at the real
 * compiled `dist/cli.js`, invoked directly so the OS reads the shebang and
 * launches Node with `process.argv[1]` set to the symlink path — exactly
 * what happens when a consumer runs `npx architect-check` or wires it into
 * CI.
 */
import { spawn, spawnSync } from "node:child_process";
import { chmodSync, cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let binPath: string;
let workDir: string;

const validTopology = {
  id: "example",
  schemaVersion: "0.1.0",
  scope: { id: "example-business", kind: "business" },
  systems: [
    { id: "workspace", kind: "workspace", responsibilities: ["control-plane"] },
    { id: "product", kind: "repository", responsibilities: ["product"] },
  ],
  authorities: [
    { responsibility: "control-plane", owner: "owner", systemOfRecord: "workspace" },
    { responsibility: "product", owner: "owner", systemOfRecord: "product" },
  ],
  interfaces: [{ id: "workspace-product", from: "workspace", to: "product", responsibilities: ["product"] }],
};

beforeAll(() => {
  const packageRoot = fileURLToPath(new URL("..", import.meta.url));
  const compiler = fileURLToPath(new URL("../../../node_modules/typescript/bin/tsc", import.meta.url));
  const built = spawnSync(process.execPath, [compiler, "-p", "tsconfig.json"], { cwd: packageRoot, encoding: "utf8" });
  if (built.status !== 0) throw new Error(`Architect build failed: ${built.stderr || built.stdout}`);

  workDir = mkdtempSync(join(tmpdir(), "architect-bin-entry-"));
  const dotBin = join(workDir, "node_modules", ".bin");
  mkdirSync(dotBin, { recursive: true });
  // Copy the whole built `dist/` into the temp install root instead of
  // pointing the `.bin` symlink at the repository's own `dist/cli.js`.
  // `cli.js` imports sibling compiled modules (`./assessment.js`,
  // `./topology.js`, ...) by relative path, so only the entry file cannot
  // be relocated on its own -- the copy has to keep the whole directory's
  // relative layout intact for those imports to resolve.
  //
  // This test execs the symlink directly (not via `node <path>`), so the OS
  // needs the target to be executable -- but a bare `tsc` build does not
  // set that bit, and (measured directly, comparing tarball contents at
  // mode 644 vs 755 for this same file) `npm pack` does not force it
  // either; it preserves whatever mode is already on disk. So chmod'ing the
  // real `dist/cli.js` would leave it at a different mode than a clean
  // build produces -- the exact file `npm pack` reads moments later in CI
  // -- and desynchronize this package's tarball from its already-recorded
  // qualification hash. Copying the directory first and chmod'ing only the
  // copy's `cli.js` reproduces the installed-bin topology (a
  // `node_modules/.bin` symlink to an executable file) without mutating
  // the packed artifact. The guard in `cli.ts` resolves `import.meta.url`
  // against `process.argv[1]` via `realpathSync`, and both of those follow
  // the symlink to this copy, so relocating the file moves both sides of
  // that comparison together -- the test still proves exactly what it
  // proved before.
  const installedDistDir = join(workDir, "dist");
  cpSync(join(packageRoot, "dist"), installedDistDir, { recursive: true });
  const installedCliPath = join(installedDistDir, "cli.js");
  chmodSync(installedCliPath, 0o755);
  binPath = join(dotBin, "architect-check");
  symlinkSync(installedCliPath, binPath);
});

afterAll(() => {
  if (workDir) rmSync(workDir, { recursive: true, force: true });
});

// #1333/#1341: spawnSync's synchronous capture is its own internal poll
// loop outside Node's normal stream machinery, and that loop is what a
// heavily loaded CI runner's scheduling can starve -- the exit status lands
// but stdout comes back empty. spawn()'s stdout/stderr are ordinary
// Readable streams whose contract guarantees every byte written is
// delivered via `data` events before `end` fires, and the `close` handler
// below fires only after the process has exited AND both stdio streams have
// ended, so it cannot observe an exit code before the output that produced
// it has been fully read.
function runBin(args: string[]): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(binPath, args);
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

describe("architect-check, invoked through a node_modules/.bin-shaped symlink", () => {
  it("--help produces non-empty stdout and exits 0", async () => {
    const result = await runBin(["--help"]);
    expect(result.status).toBe(0);
    expect(result.stdout.length).toBeGreaterThan(0);
  });

  it("exits 1 with a violated report for an invalid topology", async () => {
    const invalidPath = join(workDir, "invalid-topology.json");
    writeFileSync(invalidPath, JSON.stringify({ ...validTopology, authorities: [] }));

    const result = await runBin(["topology", invalidPath]);

    expect(result.status).toBe(1);
    expect(result.stdout.length).toBeGreaterThan(0);
    const report = JSON.parse(result.stdout);
    expect(report.state).toBe("violated");
    expect(report.findings.length).toBeGreaterThan(0);
  });

  it("exits 0 with a satisfied report for a valid topology", async () => {
    const validPath = join(workDir, "valid-topology.json");
    writeFileSync(validPath, JSON.stringify(validTopology));

    const result = await runBin(["topology", validPath]);

    expect(result.status).toBe(0);
    expect(result.stdout.length).toBeGreaterThan(0);
    const report = JSON.parse(result.stdout);
    expect(report.state).toBe("satisfied");
    expect(report.findings).toEqual([]);
  });

  it("exits 0 with a satisfied architecture-exception report from one assessment.json", async () => {
    const path = join(workDir, "assessment.json");
    writeFileSync(path, JSON.stringify({
      topology: validTopology,
      observations: [{
        id: "one",
        observedAt: "2026-08-23T12:00:00Z",
        material: true,
        crossings: [{ from: "workspace", to: "product", responsibility: "product" }],
      }],
      maximumExceptionRate: 0,
    }));

    const result = await runBin([path]);

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      state: "satisfied",
      exceptionRate: 0,
      proposedPositions: [],
    });
  });

  it("exits 2 for a missing assessment file without computing a zero exception rate", async () => {
    const result = await runBin([join(workDir, "missing.json")]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("does not exist");
    expect(result.stdout).not.toMatch(/"exceptionRate": 0/);
  });
});
