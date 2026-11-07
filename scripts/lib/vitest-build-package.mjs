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
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const compiler = resolve(repoRoot, "node_modules", "typescript", "bin", "tsc");

/**
 * The test-import closure a package declares in `test-dist-closure.json`
 * beside its vitest config (R2F-23): built output that other workspaces
 * produce and that the package's manifest cannot declare because those
 * workspaces depend on it (a cycle). Only the root topological build
 * (`npm run build` at the repository root) produces them in order.
 *
 * Every declared file must exist before any test file loads. A missing one
 * refuses the whole run with its name and its producing workspace: the run
 * never skips the importing suites, and never falls back to source. A
 * package with no declaration has no closure to check.
 */
export const DIST_CLOSURE_FILE = "test-dist-closure.json";

export function missingDistClosure(packageRoot, root = repoRoot) {
  const declaration = resolve(packageRoot, DIST_CLOSURE_FILE);
  if (!existsSync(declaration)) return [];
  const { requires } = JSON.parse(readFileSync(declaration, "utf8"));
  if (!Array.isArray(requires) || requires.length === 0) {
    throw new Error(`${declaration} declares no "requires" entries; delete it or name the closure`);
  }
  return requires.filter((entry) => {
    if (typeof entry?.path !== "string" || typeof entry?.builtBy !== "string") {
      throw new Error(`${declaration}: every "requires" entry needs a string "path" and "builtBy"`);
    }
    return !existsSync(resolve(root, entry.path));
  });
}

export function assertDistClosure(packageRoot, root = repoRoot) {
  const missing = missingDistClosure(packageRoot, root);
  if (missing.length === 0) return;
  const lines = missing.map((entry) => `  - missing ${entry.path} (built by ${entry.builtBy}${entry.importedAs ? `; imported as ${entry.importedAs}` : ""})`);
  throw new Error(
    [
      `Test-import closure of ${packageRoot} is not built; refusing to start the tests (${missing.length} missing):`,
      ...lines,
      "Run the root topological build first, from the repository root: `wt run --kind build -- npm run build` (= node scripts/build-workspaces.mjs).",
    ].join("\n"),
  );
}

export default function setup(project) {
  const packageRoot = project?.config?.root ?? process.cwd();
  assertDistClosure(packageRoot);
  const built = spawnSync(process.execPath, [compiler, "-p", "tsconfig.json"], {
    cwd: packageRoot,
    encoding: "utf8",
  });
  if (built.error) throw built.error;
  if (built.status !== 0) {
    throw new Error(`Build of ${packageRoot} failed before tests ran:\n${built.stderr || built.stdout}`);
  }
}

// `node scripts/lib/vitest-build-package.mjs --check-closure [packageRoot]`: the
// same refusal as the globalSetup, for a package's `pretest` entry.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [flag, packageRoot = process.cwd()] = process.argv.slice(2);
  if (flag !== "--check-closure") {
    console.error("usage: node scripts/lib/vitest-build-package.mjs --check-closure [packageRoot]");
    process.exit(2);
  }
  try {
    assertDistClosure(resolve(packageRoot));
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
