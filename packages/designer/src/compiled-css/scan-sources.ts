/**
 * Class candidates for `styles/compiled.css` — atoms, blocks, and shell.
 * Pre-auth pages mount Hero and shell chrome; limiting the scan to atoms
 * left those classes Tailwind-only and unstyled on the default CSS path.
 */

import { join } from "node:path";
import { scanClassCandidates, type ClassScanResult } from "./class-scan.js";

export const COMPILED_CSS_SOURCE_DIRS = ["atoms", "blocks", "shell"] as const;

export interface CompiledCssScanResult extends ClassScanResult {
  /** Per-directory file counts for reporting. */
  byDir: Record<(typeof COMPILED_CSS_SOURCE_DIRS)[number], number>;
}

/**
 * Directories whose components are exported (`./atoms`, `./blocks`, `./shell`,
 * `./charts`, `./theme`). `styles/utilities.css` lists the classes of all of
 * them; `compiled.css` keeps the narrower scan above.
 */
export const UTILITIES_SOURCE_DIRS = [...COMPILED_CSS_SOURCE_DIRS, "charts", "theme"] as const;

function scanDirs<D extends string>(packageRoot: string, dirs: readonly D[]): ClassScanResult & { byDir: Record<D, number> } {
  const candidates = new Set<string>();
  let filesScanned = 0;
  const skippedByDesign = [...scanClassCandidates(join(packageRoot, "src", "atoms")).skippedByDesign];
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
