/**
 * The contract scan: which theme and component variables the pinned shadcn@aria source actually reads.
 * Pure over source text so the shipped module carries no file access; tests feed it the pinned fixtures
 * (component sources plus the vendored nova style sheet).
 */
const UTILITY = /(?:^|[\s"'`:!(])(?:bg|text|border(?:-[trblxyse])?|ring(?:-offset)?|inset-ring|outline|fill|stroke|divide|placeholder|caret|accent|decoration|from|via|to|shadow)-([a-z][a-z0-9]*(?:-[a-z][a-z0-9]*)*)(?=[\s"'`/\])]|$)/g;
const VARIABLE = /(?:var\(|\()?--([a-z][a-z0-9]*(?:-[a-z0-9]+)*)/g;

/**
 * Returns every candidate variable (`--name`) the texts read, either as a colour utility (`bg-primary`,
 * `text-sidebar-foreground/70`) or as a direct variable (`var(--sidebar-width)`, `w-(--sidebar-width)`).
 * Only names in `candidates` count, so Tailwind namespace keys and private variables stay out.
 */
export function scanContractVars(texts: readonly string[], candidates: Iterable<string>): readonly string[] {
  const wanted = new Set(candidates);
  const found = new Set<string>();
  for (const text of texts) {
    for (const match of text.matchAll(UTILITY)) if (wanted.has(`--${match[1]}`)) found.add(`--${match[1]}`);
    for (const match of text.matchAll(VARIABLE)) if (wanted.has(`--${match[1]}`)) found.add(`--${match[1]}`);
  }
  return [...found].sort();
}
