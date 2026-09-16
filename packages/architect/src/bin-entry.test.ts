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
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

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
  const realCliPath = join(packageRoot, "dist", "cli.js");
  // `npm` sets the executable bit on a declared `bin` target when it packs
  // and installs a package; a bare `tsc` build does not, so this
  // reproduces that step explicitly rather than relying on it having
  // happened to already be true.
  chmodSync(realCliPath, 0o755);

  workDir = mkdtempSync(join(tmpdir(), "architect-bin-entry-"));
  const dotBin = join(workDir, "node_modules", ".bin");
  mkdirSync(dotBin, { recursive: true });
  binPath = join(dotBin, "architect-check");
  symlinkSync(realCliPath, binPath);
});

function runBin(args: string[]) {
  return spawnSync(binPath, args, { encoding: "utf8" });
}

describe("architect-check, invoked through a node_modules/.bin-shaped symlink", () => {
  it("--help produces non-empty stdout and exits 0", () => {
    const result = runBin(["--help"]);
    expect(result.status).toBe(0);
    expect(result.stdout.length).toBeGreaterThan(0);
  });

  it("exits 1 with a violated report for an invalid topology", () => {
    const invalidPath = join(workDir, "invalid-topology.json");
    writeFileSync(invalidPath, JSON.stringify({ ...validTopology, authorities: [] }));

    const result = runBin(["topology", invalidPath]);

    expect(result.status).toBe(1);
    expect(result.stdout.length).toBeGreaterThan(0);
    const report = JSON.parse(result.stdout);
    expect(report.state).toBe("violated");
    expect(report.findings.length).toBeGreaterThan(0);
  });

  it("exits 0 with a satisfied report for a valid topology", () => {
    const validPath = join(workDir, "valid-topology.json");
    writeFileSync(validPath, JSON.stringify(validTopology));

    const result = runBin(["topology", validPath]);

    expect(result.status).toBe(0);
    expect(result.stdout.length).toBeGreaterThan(0);
    const report = JSON.parse(result.stdout);
    expect(report.state).toBe("satisfied");
    expect(report.findings).toEqual([]);
  });
});
