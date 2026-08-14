/**
 * `checkCompiledCssFreshness` — this repository's "prove-don't-declare"
 * re-derive-and-diff convention (see this repository's own CONTRIBUTING
 * guide, and `scripts/set-scope.mjs --check`'s own precedent), applied to
 * `styles/compiled.css`.
 * Regenerates the file FROM SOURCE (real class scan + real Tailwind
 * compile — see `class-scan.ts`/`generate.ts`) and diffs it against what is
 * actually committed, so a hand-edit or a forgotten regeneration after an
 * atom's classes change is caught rather than silently trusted.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { scanClassCandidates } from "./class-scan.js";
import { generateCompiledCss } from "./generate.js";

export interface CheckCompiledCssOptions {
  /** This package's own root directory (holds `styles/` and `src/atoms/`). */
  packageRoot: string;
}

export interface CompiledCssCheckResult {
  /** `true` only when the on-disk `styles/compiled.css` is byte-identical to a fresh re-derivation from source. */
  inSync: boolean;
  /** Set when `inSync` is `false` — a short, human-readable summary of the first point of divergence, never the full diff (which can be large). */
  diffSummary?: string;
  classCount: number;
  filesScanned: number;
}

function firstDivergence(a: string, b: string): { line: number; expected: string; actual: string } {
  const aLines = a.split("\n");
  const bLines = b.split("\n");
  const max = Math.max(aLines.length, bLines.length);
  for (let i = 0; i < max; i++) {
    if (aLines[i] !== bLines[i]) {
      return { line: i + 1, expected: aLines[i] ?? "<end of file>", actual: bLines[i] ?? "<end of file>" };
    }
  }
  return { line: -1, expected: "", actual: "" };
}

/**
 * Never throws on drift itself (drift is an expected, reportable outcome,
 * not an exceptional one) — but propagates a thrown error from scanning or
 * generation (an unreadable directory, a missing `tailwindcss`, ...)
 * unchanged, matching `scanClassCandidates`/`generateCompiledCss`'s own
 * fail-closed contract. `cli.ts` is what turns that into exit code 2.
 */
export async function checkCompiledCssFreshness(options: CheckCompiledCssOptions): Promise<CompiledCssCheckResult> {
  const stylesDir = join(options.packageRoot, "styles");
  const atomsDir = join(options.packageRoot, "src", "atoms");
  const compiledCssPath = join(stylesDir, "compiled.css");

  const scan = scanClassCandidates(atomsDir);
  const generated = await generateCompiledCss({ stylesDir, candidates: scan.candidates });

  let onDisk: string;
  try {
    onDisk = readFileSync(compiledCssPath, "utf8");
  } catch (error) {
    return {
      inSync: false,
      diffSummary: `"${compiledCssPath}" does not exist or is unreadable (${error instanceof Error ? error.message : String(error)}) — run \`npm run generate:compiled-css\`.`,
      classCount: generated.classCount,
      filesScanned: scan.filesScanned,
    };
  }

  if (onDisk === generated.css) {
    return { inSync: true, classCount: generated.classCount, filesScanned: scan.filesScanned };
  }

  const div = firstDivergence(generated.css, onDisk);
  return {
    inSync: false,
    diffSummary:
      div.line === -1
        ? `"${compiledCssPath}" differs from a fresh re-derivation (byte length ${onDisk.length} vs ${generated.css.length}), but no differing line was found — likely a trailing-whitespace/newline difference.`
        : `"${compiledCssPath}" is stale: first divergence at line ${div.line}\n  expected: ${div.expected}\n  on disk:  ${div.actual}\nRun \`npm run generate:compiled-css\` to refresh it.`,
    classCount: generated.classCount,
    filesScanned: scan.filesScanned,
  };
}
