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

export function scanCompiledCssSources(packageRoot: string): CompiledCssScanResult {
  const candidates = new Set<string>();
  let filesScanned = 0;
  const skippedByDesign = [...scanClassCandidates(join(packageRoot, "src", "atoms")).skippedByDesign];
  const byDir: CompiledCssScanResult["byDir"] = { atoms: 0, blocks: 0, shell: 0 };

  for (const dir of COMPILED_CSS_SOURCE_DIRS) {
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
