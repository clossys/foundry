/**
 * `environment-conformance` — closes issue #405, NARROWED per issue
 * #358's routing decision (see that issue's own reasoning, and the
 * correction comment on #405 that applies it). `render-environment.ts`
 * exports `RENDER_ENVIRONMENT`, a literal a human wrote by hand, and
 * nothing ever verified it stays in step with the manifest it describes.
 * This checker is that verification — and ONLY that verification.
 *
 * WHAT THIS CHECKS, PRECISELY: that `RENDER_ENVIRONMENT`'s own key set
 * and `package.json#exports`' own subpath set are the SAME SET, in both
 * directions. A subpath present in `package.json#exports` with no entry
 * in `RENDER_ENVIRONMENT` is undeclared — nobody has ever said whether it
 * is safe. A subpath present in `RENDER_ENVIRONMENT` with no matching
 * entry in `package.json#exports` is a stale declaration — it describes a
 * subpath that no longer (or never did) exist. These are two different
 * defects with two different fixes, so this checker never collapses them
 * into one "mismatch" — every violation names its own direction.
 *
 * WHAT THIS DELIBERATELY DOES NOT CHECK, STATED PLAINLY SO A VERDICT HERE
 * IS NEVER MISTAKEN FOR MORE THAN IT IS: whether a subpath declared
 * `"server-safe"` actually RESOLVES safely under a real export condition.
 * This checker performs no module resolution and walks no module graph —
 * it never imports, requires, or inspects the compiled entry a subpath
 * points to, only the two DECLARATIONS (the manifest's `exports` map and
 * `RENDER_ENVIRONMENT`) against each other. `"satisfied"` here means the
 * declaration is internally consistent with the manifest; it says
 * NOTHING about whether the declaration is TRUE about the real compiled
 * output. That verification is a genuinely different capability — real
 * module-graph resolution under a declared export condition — and issue
 * #358 places it in `builder`, shared with a second declaration shape
 * (layering-seam conformance) specifically so the SAME resolver serves
 * both rather than being built twice. Building even a narrow resolver
 * here, in a consuming package, would be exactly the failure #358 names:
 * "the same resolver in two places." Once builder ships that capability,
 * a consumer of this package gets the REAL check; this file is not a
 * placeholder for it and does not pretend to be a smaller version of it.
 *
 * THE ADVERSARIAL PROOF THIS IS BUILT TO PASS (per issue #358's own
 * framing, applied to this narrower declaration-consistency check): the
 * weaker tool is a bare COUNT comparison — "the declaration has N
 * entries, the manifest has N subpaths, so they must agree." A fixture
 * where one subpath is RENAMED (never added or removed) keeps the counts
 * identical on both sides while the actual sets diverge — the renamed-to
 * name is undeclared, and the renamed-from name is now a stale
 * declaration. `environment-conformance.adversarial.test.ts` asserts, in
 * one test over one fixture, that this checker exits 1 on that fixture
 * while a bare count comparison exits 0 on the identical fixture.
 *
 * THE TERNARY:
 *
 *   "satisfied" — the two sets are identical, over at least one subpath
 *     (never "no error was thrown" — `agreedSubpaths` names every
 *     subpath both sides agree exists).
 *
 *   "violated" — every `undeclared-subpath` (real export, no declaration)
 *     and every `stale-declaration` (declared, no matching real export)
 *     is reported, not just the first.
 *
 *   "indeterminate", always with a machine-readable reason: the manifest
 *     is missing/unparseable, the manifest declares no `exports` map (or
 *     an empty one — nothing to compare against), `RENDER_ENVIRONMENT` is
 *     missing (`dist/render-environment.js` does not exist) or does not
 *     parse into a plain string-keyed object, or the declaration-loading
 *     subprocess itself failed.
 */

import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { DeclarationOutput, WorkerFailure } from "./environment-conformance-worker.js";

export type ConformanceVerdict = "satisfied" | "violated" | "indeterminate";

export type ConformanceViolationReason = "undeclared-subpath" | "stale-declaration";

export interface ConformanceViolation {
  subpath: string;
  reason: ConformanceViolationReason;
  detail: string;
}

export type ConformanceIndeterminateCode =
  | "manifest-missing"
  | "manifest-unparseable"
  | "manifest-no-exports-map"
  | "declaration-missing"
  | "declaration-unparseable"
  | "worker-failure";

export interface ConformanceIndeterminateReason {
  code: ConformanceIndeterminateCode;
  detail: string;
}

export interface ConformanceResult {
  verdict: ConformanceVerdict;
  /** Populated only when verdict === "satisfied": every subpath both the manifest and the declaration agree exists. */
  agreedSubpaths: string[];
  /** Populated only when verdict === "violated". */
  violations: ConformanceViolation[];
  /** Populated only when verdict === "indeterminate". Every applicable reason, not just the first found. */
  indeterminateReasons: ConformanceIndeterminateReason[];
}

function indeterminate(reasons: ConformanceIndeterminateReason[]): ConformanceResult {
  return { verdict: "indeterminate", agreedSubpaths: [], violations: [], indeterminateReasons: reasons };
}

/**
 * Finds THIS module's own package root by walking up from `startDir`
 * until a `package.json` is found — deliberately NOT a fixed single `..`
 * jump, because that assumes this file always runs exactly one directory
 * below its package root, which is only true when it runs as compiled
 * `dist/environment-conformance.js`. Under `vitest`, this file runs as
 * `src/environment-conformance.ts` (Vite transforms it on the fly and
 * never touches `dist/`) — a DIFFERENT one directory below the same
 * root. This walks up instead, so it is correct regardless of how many
 * directories deep this module's OWN location is at runtime.
 * `findOwnPackageRoot` locates this package's own worker script — never
 * `packageRoot` (the directory being CHECKED, an entirely separate
 * parameter that may be a fixture with no relation to this package).
 */
function findOwnPackageRoot(startDir: string): string {
  let dir = startDir;
  for (;;) {
    if (existsSync(join(dir, "package.json"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) throw new Error(`could not locate this package's own root (no package.json found above "${startDir}")`);
    dir = parent;
  }
}

/**
 * The core check. `packageRoot` is a directory containing a
 * `package.json` (with a non-empty `exports` map) and
 * `dist/render-environment.js` exporting `RENDER_ENVIRONMENT` — the same
 * shape this package's own root has once built, and the same shape every
 * fixture under `environment-conformance.adversarial.test.ts` and
 * `environment-conformance.test.ts` builds to exercise this function
 * without touching the real package.
 */
export async function checkEnvironmentConformance(packageRoot: string): Promise<ConformanceResult> {
  const root = resolve(packageRoot);
  const manifestPath = join(root, "package.json");

  if (!existsSync(manifestPath)) {
    return indeterminate([{ code: "manifest-missing", detail: `no package.json at "${manifestPath}"` }]);
  }
  let manifest: Record<string, unknown>;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
  } catch (error) {
    return indeterminate([
      { code: "manifest-unparseable", detail: `"${manifestPath}" is not valid JSON: ${error instanceof Error ? error.message : String(error)}` },
    ]);
  }

  const exportsField = manifest.exports;
  if (typeof exportsField !== "object" || exportsField === null || Array.isArray(exportsField)) {
    return indeterminate([{ code: "manifest-no-exports-map", detail: `"${manifestPath}" declares no "exports" object` }]);
  }
  const realSubpaths = new Set(Object.keys(exportsField as Record<string, unknown>));
  if (realSubpaths.size === 0) {
    return indeterminate([{ code: "manifest-no-exports-map", detail: `"${manifestPath}"'s "exports" object is empty — nothing to compare RENDER_ENVIRONMENT against` }]);
  }

  const declarationPath = join(root, "dist", "render-environment.js");
  if (!existsSync(declarationPath)) {
    return indeterminate([{ code: "declaration-missing", detail: `"${declarationPath}" does not exist` }]);
  }

  let workerPath: string;
  try {
    workerPath = join(findOwnPackageRoot(dirname(fileURLToPath(import.meta.url))), "dist", "environment-conformance-worker.js");
  } catch (error) {
    return indeterminate([{ code: "worker-failure", detail: error instanceof Error ? error.message : String(error) }]);
  }
  if (!existsSync(workerPath)) {
    return indeterminate([{ code: "worker-failure", detail: `this checker's own worker "${workerPath}" does not exist — has @vespeneventures/designer itself been built ("npm run build")?` }]);
  }

  // Loaded by spawning the worker (real `node`, no Vite in the loop) —
  // see `environment-conformance-worker.ts`'s own header for why this
  // file cannot do a plain in-process `import()` of an arbitrary
  // `render-environment.js` and stay correct under both `vitest` and real
  // compiled execution.
  let declarationStdout: string;
  try {
    declarationStdout = execFileSync(process.execPath, [workerPath, declarationPath], { encoding: "utf8" });
  } catch (error) {
    const asExecError = error as { stdout?: string; message?: string };
    declarationStdout = asExecError.stdout ?? "";
    if (!declarationStdout) {
      return indeterminate([{ code: "declaration-unparseable", detail: `loading "${declarationPath}" failed: ${asExecError.message ?? String(error)}` }]);
    }
  }

  let declarationParsed: DeclarationOutput | WorkerFailure;
  try {
    declarationParsed = JSON.parse(declarationStdout) as DeclarationOutput | WorkerFailure;
  } catch (error) {
    return indeterminate([
      { code: "declaration-unparseable", detail: `worker output for "${declarationPath}" was not valid JSON: ${error instanceof Error ? error.message : String(error)}` },
    ]);
  }
  if (!declarationParsed.ok) {
    return indeterminate([{ code: "declaration-unparseable", detail: `importing "${declarationPath}" threw: ${declarationParsed.error}` }]);
  }

  const raw = declarationParsed.renderEnvironment;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return indeterminate([{ code: "declaration-unparseable", detail: `"${declarationPath}" does not export a RENDER_ENVIRONMENT object` }]);
  }
  const declaredSubpaths = new Set(Object.keys(raw as Record<string, unknown>));

  const undeclared = [...realSubpaths].filter((s) => !declaredSubpaths.has(s)).sort();
  const stale = [...declaredSubpaths].filter((s) => !realSubpaths.has(s)).sort();

  if (undeclared.length > 0 || stale.length > 0) {
    const violations: ConformanceViolation[] = [
      ...undeclared.map((subpath) => ({
        subpath,
        reason: "undeclared-subpath" as const,
        detail: `"${subpath}" is a real package.json#exports subpath with no entry in RENDER_ENVIRONMENT`,
      })),
      ...stale.map((subpath) => ({
        subpath,
        reason: "stale-declaration" as const,
        detail: `"${subpath}" is declared in RENDER_ENVIRONMENT but is not a real package.json#exports subpath`,
      })),
    ];
    return { verdict: "violated", agreedSubpaths: [], violations, indeterminateReasons: [] };
  }

  return { verdict: "satisfied", agreedSubpaths: [...realSubpaths].sort(), violations: [], indeterminateReasons: [] };
}
