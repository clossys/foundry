/**
 * Vitest `globalSetup` shared by every package whose tests execute, copy, or
 * pack that package's own compiled `dist/`.
 *
 * It compiles the package ONCE, in Vitest's main process, before any test
 * file is scheduled onto a worker -- and it is the only place a package's
 * test run is allowed to write that package's `dist/`.
 *
 * Why this exists (#1385): each of these packages used to rebuild its own
 * `dist/` from inside a test file's `beforeAll` (`tsc -p tsconfig.json`).
 * Vitest runs test files in parallel workers, so that rebuild overlapped
 * whatever sibling test file was reading the same `dist/` at that moment.
 * `tsc` rewrites every output file in place (truncate, then write), so the
 * sibling could observe a file that was empty or half-written:
 *
 *   - controller: `repository/installed-bin.test.ts` ran `npm pack` while
 *     `rule-conformance-cli.test.ts` was re-emitting `dist/` -- the tarball
 *     carried a truncated `release/singular-authority-cli.js` ("does not
 *     provide an export named 'run'"), or `npm pack` itself failed;
 *   - influencer: `cli.test.ts` executed the live `dist/cli.js` while
 *     `qualified-response-yield-cli.test.ts` re-emitted it -- an empty
 *     module runs, prints nothing, and exits 0 (empty stdout, status 0);
 *   - giver: `cli.test.ts` executed the live `dist/cli.js` while
 *     `timely-semantic-closure-rate-cli.test.ts` re-emitted its imports --
 *     the import failed and Node's uncaught-error default exited 1, not 2.
 *
 * Which pairs of files overlap depends on Vitest's file order (by file size
 * when there is no results cache, as on CI) and on worker count, so the race
 * surfaced and hid as unrelated edits changed file sizes. Building once, up
 * front, removes the overlap rather than moving it.
 *
 * On CI `npm run build` has already produced an identical `dist/`; this
 * rebuild keeps a bare `vitest run` in one package honest against edited
 * sources, exactly as the per-file `beforeAll` builds did.
 */
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const compiler = resolve(repoRoot, "node_modules", "typescript", "bin", "tsc");

export default function setup(project) {
  const packageRoot = project?.config?.root ?? process.cwd();
  const built = spawnSync(process.execPath, [compiler, "-p", "tsconfig.json"], {
    cwd: packageRoot,
    encoding: "utf8",
  });
  if (built.error) throw built.error;
  if (built.status !== 0) {
    throw new Error(`Build of ${packageRoot} failed before tests ran:\n${built.stderr || built.stdout}`);
  }
}
