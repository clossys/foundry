import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { importFoundryFrames, importFoundrySections, loadBuildCatalog } from "../catalog-core/index.js";
import { loadCatalogBundles } from "../catalog-bundles.js";
import * as nativeCatalog from "./native-catalog.js";
import { checkDefaultCandidates, type DefaultCandidatesInput } from "./default-candidates-gate.js";

/** A missing native policy is an invalid input, never a guessed candidate preference. */
export function nativeDefaultSources(buildCatalog: ReturnType<typeof loadBuildCatalog>): DefaultCandidatesInput["defaultSources"] {
  const policy = (nativeCatalog as typeof nativeCatalog & { loadNativeDefaultSources?: (build: ReturnType<typeof loadBuildCatalog>) => DefaultCandidatesInput["defaultSources"] }).loadNativeDefaultSources;
  if (!policy) throw new Error("MISSING_POLICY native default source policy is unavailable");
  return policy(buildCatalog);
}

/** Native source inventory; the source-running adapter prevents stale compiled catalog inputs. */
export function runDefaultCandidatesCli(args: readonly string[], sourceRoot = fileURLToPath(new URL("../../../../", import.meta.url))): 0 | 1 | 2 {
  if (args.length) {
    process.stdout.write(JSON.stringify({ schemaVersion: 1, status: "invalid-input", sourceHead: null, missing: [], invalid: ["Usage: check-default-candidates.mjs (no arguments)"] }) + "\n");
    return 2;
  }
  let sourceHead: string | null = null;
  try {
    sourceHead = execFileSync("git", ["rev-parse", "HEAD"], { cwd: sourceRoot, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" }).trim();
    const buildCatalog = loadBuildCatalog(), catalog = nativeCatalog.loadNativeCompositeCatalog(), bundles = loadCatalogBundles();
    const result = checkDefaultCandidates({
      buildCatalog, catalog, defaultSources: nativeDefaultSources(buildCatalog), sourceHead,
      componentBundles: bundles.sourceBundles,
      surfaceCoverage: [...bundles.foundryCoverage, ...importFoundrySections().coverage, ...importFoundryFrames().coverage],
      sourceHash(path) {
        const target = resolve(sourceRoot, path), inside = relative(sourceRoot, target);
        if (isAbsolute(path) || inside === ".." || inside.startsWith("../")) return undefined;
        try { return createHash("sha256").update(readFileSync(target)).digest("hex"); } catch { return undefined; }
      },
    });
    process.stdout.write(JSON.stringify(result.report, null, 2) + "\n");
    return result.exitCode;
  } catch (error) {
    process.stdout.write(JSON.stringify({ schemaVersion: 1, sourceHead, status: "invalid-input", missing: [], invalid: [error instanceof Error ? error.message : String(error)] }, null, 2) + "\n");
    return 2;
  }
}
