/** Lexicon criteria (section 5b, copy row): avoid-patterns and filler, and the house spelling of terms. */
import { pattern, strings } from "./lib.js";
import type { Criterion } from "./types.js";

/** The filler list every copy standard inherits (`params.allow` lifts an entry). */
export const FILLER = Object.freeze([
  "very", "really", "just", "actually", "basically", "simply", "literally", "truly", "quite",
  "leverage", "utilize", "seamless", "seamlessly", "cutting-edge", "best-in-class", "game-changing",
  "revolutionary", "synergy", "robust", "world-class", "next-generation", "in order to",
]);

/** lexicon.clean: none of `params.avoid` (phrases or `/regex/`) and none of the filler list. */
export const clean: Criterion = (subject, params) => {
  const allow = new Set(strings(params.allow).map(item => item.toLowerCase()));
  const sources = [...strings(params.avoid), ...(params.filler === false ? [] : FILLER.filter(item => !allow.has(item)))];
  const found = new Set<string>();
  for (const source of sources) for (const match of subject.text.match(pattern(source)) ?? []) found.add(match.toLowerCase());
  return [...found].map(item => `avoid "${item}"`);
};

/** lexicon.terms: every `params.terms` entry appears only in its house spelling (case and form). */
export const terms: Criterion = (subject, params) => {
  const failures: string[] = [];
  for (const term of strings(params.terms)) {
    for (const match of subject.text.match(pattern(term)) ?? []) if (match !== term) failures.push(`write "${term}", not "${match}"`);
  }
  return [...new Set(failures)];
};
