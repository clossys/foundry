/**
 * NO SHEBANG, deliberately, unlike this package's real installed `bin`
 * CLIs (`cli.ts`, `tokens/contrast-cli.ts`, `environment-conformance-cli.ts`):
 * this file is never installed as a `bin` and never executed directly by
 * a shell — `environment-conformance.ts` always spawns it explicitly as
 * `execFileSync(process.execPath, [...])`, naming `node` itself, so a
 * shebang here would serve no function. (It also breaks a direct-import
 * unit test of this module under `vitest`'s jsdom environment — Vite's
 * HMR-client injection collides with a leading `#!` line during SSR
 * transform.)
 *
 * `environment-conformance-worker` — a one-job subprocess helper for
 * `environment-conformance.ts`: load `RENDER_ENVIRONMENT` from a compiled
 * `render-environment.js`, as real, plain `node`.
 *
 * WHY A SUBPROCESS AT ALL, for something this small. `environment-
 * conformance.ts` also runs as `vitest`'s own Vite-transformed TS source
 * (Vite transforms it on the fly and never touches this package's
 * compiled `dist/`). Vite's SSR module runner intercepts every `import()`
 * call there — even one whose specifier is a fully-resolved `file://` URL
 * computed at runtime — routing it through Vite's own loader instead of
 * the platform's, which does not resolve an arbitrary absolute filesystem
 * path outside Vite's project root the way plain Node `import()` does (a
 * special inline comment Vite recognizes to skip analyzing one dynamic
 * import does not reliably survive esbuild's TS transform to reach Vite's
 * analysis step either — tried first, confirmed unreliable, before
 * reaching for this). This subprocess is real, plain `node` — no Vite
 * anywhere in the loop — so the same `import()` here behaves identically
 * whether the caller is a `vitest` run against source or a real,
 * compiled, installed CLI checking a real package or a hermetic fixture.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO, per issue #358's routing: no module
 * resolution, no graph walk, no export-condition handling. Issue #358
 * places that shared capability in `builder`, serving two declaration
 * shapes (export-condition safety and layering-seam conformance) from
 * ONE resolver — building a second resolver here, even a narrow one,
 * would be exactly the "same resolver in two places" failure #358 exists
 * to prevent. This file only reads one file's one named export.
 */

import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export interface DeclarationOutput {
  ok: true;
  /** Whatever `RENDER_ENVIRONMENT` actually was, unvalidated — shape-checking is `environment-conformance.ts`'s job, not this worker's. */
  renderEnvironment: unknown;
}
export interface WorkerFailure {
  ok: false;
  error: string;
}

/**
 * Real-Node-only load of `RENDER_ENVIRONMENT` from a compiled
 * `render-environment.js` — exported so a direct unit test can exercise
 * it without spawning a subprocess (loading a LOCAL fixture file needs no
 * `vitest`/Vite workaround; only `environment-conformance.ts`'s own
 * caller-side usage, which may run under `vitest`, needs the subprocess
 * boundary this file provides via `run()` below).
 */
export async function loadDeclaration(declarationPath: string): Promise<unknown> {
  const mod = (await import(pathToFileURL(declarationPath).href)) as { RENDER_ENVIRONMENT?: unknown };
  return mod.RENDER_ENVIRONMENT;
}

async function run(): Promise<void> {
  const declarationPath = process.argv[2];
  try {
    if (declarationPath === undefined) throw new Error("usage: environment-conformance-worker.js <declaration-path>");
    const renderEnvironment = await loadDeclaration(declarationPath);
    const output: DeclarationOutput = { ok: true, renderEnvironment };
    process.stdout.write(JSON.stringify(output));
    process.exitCode = 0;
  } catch (error) {
    const output: WorkerFailure = { ok: false, error: error instanceof Error ? (error.stack ?? error.message) : String(error) };
    process.stdout.write(JSON.stringify(output));
    process.exitCode = 1;
  }
}

/**
 * Same real-path guard every installable CLI in this package uses (see
 * `cli.ts`/`contrast-cli.ts`) — required here for a different reason than
 * theirs: this file has no installed `bin` entry at all (it is a spawn
 * target only `environment-conformance.ts` invokes, by compiled path),
 * but `environment-conformance-worker.test.ts` imports `loadDeclaration`
 * directly, and without this guard that import alone would execute
 * `run()` against the TEST RUNNER's own `process.argv`.
 */
function detectMainModule(): boolean {
  const argvPath = process.argv[1];
  if (argvPath === undefined) return false;
  const modulePath = fileURLToPath(import.meta.url);
  try {
    return realpathSync(resolve(argvPath)) === realpathSync(modulePath);
  } catch {
    return resolve(argvPath) === modulePath;
  }
}

if (detectMainModule()) {
  void run();
}
