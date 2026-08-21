/**
 * `environment-conformance.adversarial.test.ts` — the adversarial proof
 * `environment-conformance.ts`'s own header promises, per issue #358's
 * framing applied to this narrower declaration-consistency check.
 *
 * THE WEAKER TOOL NAMED: a bare COUNT comparison — "RENDER_ENVIRONMENT has
 * N keys, package.json#exports has N subpaths, so they must agree." A
 * fixture where one subpath is ADDED and one is REMOVED in the same edit
 * (the shape a careless rename actually produces — see `writeRenamedFixture`
 * below) keeps both counts at N on both sides while the real SETS diverge:
 * the new name is undeclared, and the old name is now a stale declaration.
 * A count comparison sees "N and N, satisfied" and is wrong. Only a real
 * set comparison, in both directions, catches it — which is exactly what
 * `checkEnvironmentConformance` (and the CLI wrapping it) does and a count
 * comparison does not.
 *
 * BOTH ASSERTIONS RUN AGAINST THE IDENTICAL FIXTURE, IN THE SAME TEST:
 * asserting only "the real gate exits 1" proves nothing on its own — a
 * gate that always exits 1 would pass that alone. The adversarial claim is
 * comparative: the real gate and the weaker tool must DISAGREE on the same
 * input, with the real gate catching what the weaker tool misses.
 *
 * THE REAL GATE IS EXERCISED THE WAY IT ACTUALLY SHIPS: as the compiled,
 * installed CLI (`designer-environment-check`, `environment-conformance-
 * cli.js`), spawned by its compiled path exactly the way this repository
 * invokes every gate — never a plain function call standing in for the
 * CLI's own argv-to-exit-code contract. Needs `npm run build` to have
 * already produced `dist/`, the same precondition every subprocess-
 * spawning test in this package holds itself to.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = join(packageRoot, "dist", "environment-conformance-cli.js");

if (!existsSync(cliPath)) {
  throw new Error(
    `environment-conformance.adversarial.test.ts requires a built dist/ (run "npm run build" in ${packageRoot} first) — ` +
      "this suite spawns the REAL compiled CLI, by compiled path, the same way this repository invokes every gate.",
  );
}

let dir: string;

beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), "env-conformance-adversarial-")));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/**
 * Writes a fixture where `./b` was RENAMED to `./b-renamed` — never added,
 * never removed. `package.json#exports` reflects the rename (`./b-renamed`
 * is the real subpath now); `RENDER_ENVIRONMENT` was never updated to
 * match (it still says `./b`). Subpath COUNT is 2 on both sides, unchanged
 * by the "edit." The SETS disagree: `./b-renamed` is undeclared, `./b` is
 * a stale declaration.
 */
function writeRenamedFixture(): void {
  mkdirSync(join(dir, "dist"), { recursive: true });
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify(
      {
        name: "@fixture/renamed-subpath",
        version: "0.0.0",
        type: "module",
        exports: {
          "./a": { import: "./dist/a.js" },
          "./b-renamed": { import: "./dist/b.js" },
        },
      },
      null,
      2,
    ),
    "utf8",
  );
  writeFileSync(
    join(dir, "dist", "render-environment.js"),
    `export const RENDER_ENVIRONMENT = {\n  "./a": "server-safe",\n  "./b": "client-only",\n};\n`,
    "utf8",
  );
}

/**
 * THE WEAKER TOOL: exactly what its name says, nothing more. Counts the
 * declaration's keys and the manifest's exports subpaths; exits 0 when the
 * counts match, 1 when they don't. Deliberately does not look at what the
 * names actually ARE — that is the entire point of naming it "weaker."
 */
function countComparisonExitCode(fixtureDir: string): number {
  const manifest = JSON.parse(readFileSync(join(fixtureDir, "package.json"), "utf8")) as { exports: Record<string, unknown> };
  const declarationSource = readFileSync(join(fixtureDir, "dist", "render-environment.js"), "utf8");
  // A count-only tool has no reason to run a real module loader either —
  // it only needs to count object keys, so a minimal literal-object key
  // count over the declaration source stands in for "load and count."
  const keyMatches = declarationSource.match(/^\s*"[^"]+":/gm) ?? [];
  const realCount = Object.keys(manifest.exports).length;
  const declaredCount = keyMatches.length;
  return realCount === declaredCount ? 0 : 1;
}

function runRealCli(fixtureDir: string): number {
  try {
    execFileSync(process.execPath, [cliPath, fixtureDir], { encoding: "utf8" });
    return 0;
  } catch (error) {
    const asExecError = error as { status?: number | null };
    if (typeof asExecError.status === "number") return asExecError.status;
    throw error;
  }
}

describe("adversarial proof: renamed subpath separates the real gate from a count comparison", () => {
  it("the real gate (designer-environment-check, by compiled path) exits 1, while a bare count comparison exits 0, on the identical renamed-subpath fixture, in this one test", () => {
    writeRenamedFixture();

    const realGateExitCode = runRealCli(dir);
    const weakToolExitCode = countComparisonExitCode(dir);

    // The two tools must DISAGREE on the identical input — that
    // disagreement is the entire adversarial claim, not either exit code
    // read in isolation.
    expect(realGateExitCode).toBe(1);
    expect(weakToolExitCode).toBe(0);
    expect(realGateExitCode).not.toBe(weakToolExitCode);
  });

  it("sanity check: the weak tool is not simply broken — it correctly reports 0 when the sets truly do agree", () => {
    mkdirSync(join(dir, "dist"), { recursive: true });
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ name: "@fixture/agrees", version: "0.0.0", type: "module", exports: { "./a": { import: "./dist/a.js" } } }, null, 2),
      "utf8",
    );
    writeFileSync(join(dir, "dist", "render-environment.js"), `export const RENDER_ENVIRONMENT = {\n  "./a": "server-safe",\n};\n`, "utf8");

    expect(countComparisonExitCode(dir)).toBe(0);
    expect(runRealCli(dir)).toBe(0);
  });
});
