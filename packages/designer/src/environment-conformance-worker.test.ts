import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DeclarationOutput, WorkerFailure } from "./environment-conformance-worker.js";

/**
 * A real subprocess test, the same shape `render-environment.test.ts`'s
 * own `probeUnderReactServer` uses: spawn the REAL compiled worker
 * (never `loadDeclaration` called in-process), because that is the only
 * way this worker is ever actually invoked (`environment-conformance.ts`
 * always spawns it — see that file's own header for why an in-process
 * call under `vitest` cannot stand in for this). Needs `npm run build` to
 * have already produced `dist/`, same precondition every subprocess-
 * spawning test in this package holds itself to.
 */
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workerPath = join(packageRoot, "dist", "environment-conformance-worker.js");

if (!existsSync(workerPath)) {
  throw new Error(`environment-conformance-worker.test.ts requires a built dist/ (run "npm run build" in ${packageRoot} first)`);
}

function runWorker(declarationPath: string | undefined): DeclarationOutput | WorkerFailure {
  const args = declarationPath === undefined ? [] : [declarationPath];
  try {
    const stdout = execFileSync(process.execPath, [workerPath, ...args], { encoding: "utf8" });
    return JSON.parse(stdout) as DeclarationOutput | WorkerFailure;
  } catch (error) {
    const asExecError = error as { stdout?: string };
    if (asExecError.stdout) return JSON.parse(asExecError.stdout) as DeclarationOutput | WorkerFailure;
    throw error;
  }
}

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "env-conformance-worker-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("environment-conformance-worker (real subprocess)", () => {
  it("reports RENDER_ENVIRONMENT from a real compiled module", () => {
    const path = join(dir, "render-environment.js");
    writeFileSync(path, `export const RENDER_ENVIRONMENT = { "./a": "server-safe", "./b": "client-only" };\n`);
    const output = runWorker(path);
    expect(output.ok).toBe(true);
    expect((output as DeclarationOutput).renderEnvironment).toEqual({ "./a": "server-safe", "./b": "client-only" });
  });

  it("reports undefined when the module exports no RENDER_ENVIRONMENT", () => {
    const path = join(dir, "render-environment.js");
    writeFileSync(path, `export const SOMETHING_ELSE = 1;\n`);
    const output = runWorker(path);
    expect(output.ok).toBe(true);
    expect((output as DeclarationOutput).renderEnvironment).toBeUndefined();
  });

  it("reports failure (ok: false) when the module itself throws on import", () => {
    const path = join(dir, "render-environment.js");
    writeFileSync(path, `throw new Error("boom");\n`);
    const output = runWorker(path);
    expect(output.ok).toBe(false);
    expect((output as WorkerFailure).error).toContain("boom");
  });

  it("reports failure (ok: false) when the path does not resolve to a real module", () => {
    const output = runWorker(join(dir, "does-not-exist.js"));
    expect(output.ok).toBe(false);
  });

  it("reports failure (ok: false) when invoked with no declaration-path argument at all", () => {
    const output = runWorker(undefined);
    expect(output.ok).toBe(false);
  });
});
