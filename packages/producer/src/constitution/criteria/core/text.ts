/**
 * Text and copy criteria (section 5b, copy row): word limits, sentence counts, reading grade, voice
 * rules, plain verbs and placeholders. Each judges the subject's text.
 */
import { excerpt, needNumber, num, pattern, sentences, strings, syllables, words } from "./lib.js";
import type { Criterion } from "./types.js";

/** text.nonempty: the text holds at least `min` (default 1) words. */
export const nonempty: Criterion = (subject, params) => {
  const count = words(subject.text).length;
  const min = num(params.min, 1);
  return count < min ? [`text has ${count} words; at least ${min} required`] : [];
};

/** text.word-limit: the word count is within [min (default 0), max]. */
export const wordLimit: Criterion = (subject, params) => {
  const max = needNumber(params, "max");
  if (typeof max === "string") return [max];
  const count = words(subject.text).length;
  const min = num(params.min, 0);
  if (count > max) return [`text has ${count} words; the limit is ${max}`];
  if (count < min) return [`text has ${count} words; at least ${min} required`];
  return [];
};

/** text.sentence-count: the sentence count is within [min (default 1), max (default unbounded)]. */
export const sentenceCount: Criterion = (subject, params) => {
  const count = sentences(subject.text).length;
  const min = num(params.min, 1), max = num(params.max, Number.POSITIVE_INFINITY);
  if (count < min) return [`text has ${count} sentences; at least ${min} required`];
  if (count > max) return [`text has ${count} sentences; at most ${max} allowed`];
  return [];
};

/** text.reading-grade: the Flesch-Kincaid grade is at most `max` (default 8). */
export const readingGrade: Criterion = (subject, params) => {
  const list = sentences(subject.text);
  const all = words(subject.text);
  if (!list.length || !all.length) return [];
  const grade = 0.39 * (all.length / list.length) + 11.8 * (all.reduce((sum, word) => sum + syllables(word), 0) / all.length) - 15.59;
  const max = num(params.max, 8);
  return grade > max ? [`reading grade ${grade.toFixed(1)} is above ${max}`] : [];
};

const PRONOUNS: Readonly<Record<string, readonly string[]>> = {
  // The pronouns each pinned person forbids.
  first: ["you", "your", "yours"],
  "first-plural": ["i", "me", "my", "mine"],
  second: ["i", "me", "my", "mine"],
  third: ["i", "me", "my", "mine", "we", "us", "our", "ours", "you", "your", "yours"],
};

/**
 * text.voice-rules: the pinned voice, as data: `person` (first, first-plural, second, third)
 * forbids the other persons' pronouns; `maxSentenceWords` caps each sentence; `contractions: false`
 * forbids contractions (formal); `mood: "declarative"` forbids questions and exclamations.
 */
export const voiceRules: Criterion = (subject, params) => {
  const failures: string[] = [];
  const person = typeof params.person === "string" ? params.person : undefined;
  if (person !== undefined) {
    const forbidden = PRONOUNS[person];
    if (!forbidden) failures.push(`params.person must be one of ${Object.keys(PRONOUNS).join(", ")}`);
    else {
      const used = [...new Set(words(subject.text).map(word => word.toLowerCase()).filter(word => forbidden.includes(word)))];
      if (used.length) failures.push(`voice is ${person} person; found ${used.join(", ")}`);
    }
  }
  if (params.maxSentenceWords !== undefined) {
    const max = num(params.maxSentenceWords, Number.POSITIVE_INFINITY);
    for (const sentence of sentences(subject.text)) if (words(sentence).length > max) failures.push(`sentence over ${max} words: "${excerpt(sentence)}"`);
  }
  if (params.contractions === false) {
    const found = (subject.text.match(/\b[\p{L}]+['’](?:t|s|re|ve|ll|d|m)\b/giu) ?? []).filter(word => !/['’]s$/i.test(word) || /^(?:it|that|there|what|who|he|she|here|let)['’]s$/i.test(word));
    if (found.length) failures.push(`formal voice forbids contractions; found ${[...new Set(found)].join(", ")}`);
  }
  if (params.mood === "declarative" && /[?!]/.test(subject.text)) failures.push("declarative mood forbids questions and exclamations");
  return failures;
};

const WEAK_VERB = "(?:make|makes|made|making|provide|provides|provided|providing|perform|performs|performed|performing|conduct|conducts|conducted|conducting|give|gives|gave|given|giving|take|takes|took|taken|taking|reach|reaches|reached|reaching|carry out|carries out|carried out|achieve|achieves|achieved|undertake|undertakes|undertook)";
const NOMINAL = "[\\p{L}]+(?:tion|sion|ment|ance|ence|ity|sis|al)";
/** text.plain-verbs: no weak verb carrying a nominalisation ("make a decision" for "decide"), plus `params.avoid` phrases. */
export const plainVerbs: Criterion = (subject, params) => {
  const found: string[] = [...(subject.text.match(new RegExp(`\\b${WEAK_VERB}\\s+(?:a|an|the|some|any)?\\s*${NOMINAL}\\b`, "giu")) ?? [])];
  for (const phrase of strings(params.avoid)) found.push(...(subject.text.match(pattern(phrase)) ?? []));
  return found.map(phrase => `use the plain verb, not "${phrase}"`);
};

const PLACEHOLDERS = [/lorem ipsum/gi, /\bTODO\b/g, /\bTBD\b/g, /\bFIXME\b/g, /\bXXX\b/g, /\bAcme\b/g, /\{\{[^}]*\}\}/g, /\[(?:insert|placeholder|your)[^\]]*\]/gi];
/** text.no-placeholder: no lorem ipsum, TODO, TBD, demo company or template holes, plus `params.extra` patterns. */
export const noPlaceholder: Criterion = (subject, params) => {
  const found: string[] = [];
  for (const regex of [...PLACEHOLDERS, ...strings(params.extra).map(pattern)]) found.push(...(subject.text.match(regex) ?? []));
  return [...new Set(found)].map(item => `placeholder text "${item}"`);
};
