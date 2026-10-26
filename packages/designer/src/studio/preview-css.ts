import type { CatalogData, LibraryData } from "../catalog-core/index.js";
import { studioEngine, type StudioEngine } from "./engine.js";
import type { Candidate } from "./model.js";
import { evaluationFor, type StudioEvaluation } from "./evaluation.js";

/**
 * Doubled `:root` puts every live block one step above any generated brand block, and `full` declares every member in all three
 * blocks, so the preview wins whatever order the stylesheets load in.
 */
export const LIVE_SELECTORS = {
  light: ":root:root[data-brand-bound]",
  mediaDark: "@media (prefers-color-scheme: dark) { :root:root[data-brand-bound]:not([data-theme=\"light\"])",
  dark: ":root:root[data-brand-bound][data-theme=\"dark\"]",
} as const;

/** CSS for the whole-document preview. A working selection with a C1 error keeps the last safe CSS and reports `safe: false`. */
export function liveCss(input: { catalog: CatalogData; library: LibraryData; working: LibraryData; previous: string; engine?: StudioEngine; evaluation?: StudioEvaluation }): { css: string; safe: boolean } {
  const { catalog, library, working, previous, engine = studioEngine } = input;
  const { resolved, checked } = evaluationFor(input).evaluate();
  if (checked.findings.some((finding) => finding.code === "C1" && finding.severity === "error")) return { css: previous, safe: false };
  return { css: engine.emit(resolved, ["css-brand"], { full: true, header: false, selectors: LIVE_SELECTORS })[0]?.contents ?? "", safe: true };
}

/** One scoped block set per card. A card with a C1 error contributes nothing, so unsafe text never reaches a style element. */
export function candidatesCss(candidates: readonly Candidate[], engine: StudioEngine = studioEngine): string {
  return candidates
    .filter((candidate) => candidate.previewable)
    .map((candidate) => {
      const scope = `[data-studio-candidate="${candidate.index}"]`;
      return engine.emit(candidate.resolved, ["css-brand"], {
        full: true, extraVars: true, header: false,
        selectors: {
          light: scope,
          mediaDark: `@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) ${scope}`,
          dark: `:root[data-theme="dark"] ${scope}`,
        },
      })[0]?.contents ?? "";
    })
    .join("");
}
