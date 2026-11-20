/**
 * Class candidates for `styles/compiled.css` — components, blocks, shell, canonical Frames, public Studio,
 * the specimen renderers moved out of the Studio (foundry-build-0007),
 * and the surface runtime Studio renders sections and frames through.
 * Pre-auth pages mount Hero and shell chrome; limiting the scan to components
 * left those classes Tailwind-only and unstyled on the default CSS path. The
 * list matches the source roots the rendered-class-rules gate (PROC-3) measures.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { scanClassCandidates, type ClassScanResult } from "./class-scan.js";

/** The adopted backdrop registry (foundry-build-0048 U23), relative to the package root. */
export const BACKDROP_REGISTRY_PATH = join("src", "catalog", "rules", "backdrop-components.json");

/**
 * The fixed classes the adopted backdrop registry hands its source components: every record's
 * `props.className` and `reducedMotion.props.className`. They are data in JSON, which the text scan
 * (`.ts`/`.tsx` only) never reads, so they are read here from exactly those fields, never by scanning
 * JSON blindly. Fails closed: an unreadable registry, or a className that is not a string, throws.
 */
export function backdropRegistryClasses(packageRoot: string): string[] {
  const registry = JSON.parse(readFileSync(join(packageRoot, BACKDROP_REGISTRY_PATH), "utf8")) as { components?: unknown };
  if (!Array.isArray(registry.components)) throw new Error(`${BACKDROP_REGISTRY_PATH}: components is not a list`);
  const classes = new Set<string>();
  for (const entry of registry.components as Record<string, unknown>[]) {
    const reduced = entry?.reducedMotion as { props?: Record<string, unknown> } | undefined;
    for (const props of [entry?.props as Record<string, unknown> | undefined, reduced?.props]) {
      if (props === undefined || !Object.hasOwn(props, "className")) continue;
      if (typeof props.className !== "string") throw new Error(`${BACKDROP_REGISTRY_PATH}: ${String(entry?.id)} className is not a string`);
      for (const token of props.className.split(/\s+/)) if (token) classes.add(token);
    }
  }
  return [...classes].sort();
}

export const COMPILED_CSS_SOURCE_DIRS = ["components", "blocks", "shell", "frames", "runtime", "studio", "specimen"] as const;

export interface CompiledCssScanResult extends ClassScanResult {
  /** Per-directory file counts for reporting. */
  byDir: Record<(typeof COMPILED_CSS_SOURCE_DIRS)[number], number>;
}

/**
 * Directories whose components are exported (`./components`, `./blocks`, `./shell`,
 * `./frames`, `./studio`, `./specimen`, `./charts`, `./theme`, plus token preview tooling). `styles/utilities.css` lists the classes of all of
 * them; `compiled.css` keeps the narrower scan above.
 */
export const UTILITIES_SOURCE_DIRS = [...COMPILED_CSS_SOURCE_DIRS, "charts", "theme", "tokens/preview"] as const;

function scanDirs<D extends string>(packageRoot: string, dirs: readonly D[]): ClassScanResult & { byDir: Record<D, number> } {
  const candidates = new Set<string>();
  let filesScanned = 0;
  const skippedByDesign = [...scanClassCandidates(join(packageRoot, "src", "components")).skippedByDesign];
  const byDir = {} as Record<D, number>;

  for (const dir of dirs) {
    const scan = scanClassCandidates(join(packageRoot, "src", dir));
    byDir[dir] = scan.filesScanned;
    filesScanned += scan.filesScanned;
    for (const c of scan.candidates) candidates.add(c);
    for (const s of scan.skippedByDesign) {
      if (!skippedByDesign.some((x) => x.file === s.file)) skippedByDesign.push(s);
    }
  }
  // The backdrop registry's fixed classes reach the rendered layer through data, not a source literal.
  for (const c of backdropRegistryClasses(packageRoot)) candidates.add(c);

  return {
    candidates: [...candidates].sort(),
    filesScanned,
    skippedByDesign,
    byDir,
  };
}

export function scanCompiledCssSources(packageRoot: string): CompiledCssScanResult {
  return scanDirs(packageRoot, COMPILED_CSS_SOURCE_DIRS);
}

/** Candidates for `styles/utilities.css`: every exported component directory. */
export function scanUtilitiesSources(packageRoot: string): ClassScanResult {
  return scanDirs(packageRoot, UTILITIES_SOURCE_DIRS);
}
