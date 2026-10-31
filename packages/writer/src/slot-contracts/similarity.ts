/**
 * Originality check against reference exemplars. Deterministic: text is
 * normalized (case, punctuation, ICU placeholders), then compared by
 * containment and by word-trigram Jaccard similarity.
 */
export const MIN_EXEMPLAR_WORDS = 4;
export const JACCARD_THRESHOLD = 0.6;

export function stripIcu(text: string): string {
  let out = text; let previous = "";
  while (out !== previous) { previous = out; out = out.replace(/\{[^{}]*\}/g, " "); }
  return out;
}
export function normalizeText(text: string): string {
  return stripIcu(text).normalize("NFKD").replace(/\p{M}+/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}
function trigrams(words: string[]): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i + 3 <= words.length; i++) out.add(words.slice(i, i + 3).join(" "));
  return out;
}
export function trigramJaccard(a: string, b: string): number {
  const x = trigrams(normalizeText(a).split(" ").filter(Boolean)); const y = trigrams(normalizeText(b).split(" ").filter(Boolean));
  if (x.size === 0 || y.size === 0) return 0;
  let shared = 0; for (const t of x) if (y.has(t)) shared++;
  return shared / (x.size + y.size - shared);
}

export interface SimilarityMatch { slot: string; exemplar: string; mode: "contains" | "jaccard"; score: number }

/** The first exemplar that `text` copies, or undefined. Short exemplars are common phrasing and exempt. */
export function copiedExemplar(text: string, exemplars: ReadonlyArray<{ slot: string; text: string }>): SimilarityMatch | undefined {
  const norm = ` ${normalizeText(text)} `;
  if (norm.trim().split(" ").length < MIN_EXEMPLAR_WORDS) return undefined;
  for (const ex of exemplars) {
    const e = normalizeText(ex.text);
    if (e.split(" ").filter(Boolean).length < MIN_EXEMPLAR_WORDS) continue;
    if (norm.includes(` ${e} `)) return { slot: ex.slot, exemplar: ex.text, mode: "contains", score: 1 };
    const score = trigramJaccard(text, ex.text);
    if (score >= JACCARD_THRESHOLD) return { slot: ex.slot, exemplar: ex.text, mode: "jaccard", score };
  }
  return undefined;
}
