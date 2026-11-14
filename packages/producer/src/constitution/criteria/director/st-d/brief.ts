/**
 * Director brief criteria (ST-D, slot-constitution.md section 5a): the mechanical half of the four
 * Director standards. Every brief has the three sections in order, answers its contract's keys,
 * derives only from Director pins and findings, cites each reason, and ends on a measurable watch;
 * each answer shape (statement, list, measure, profile) adds its own check. Pure.
 */
import { excerpt, num, sentences, strings, words } from "../../core/lib.js";
import type { Criterion } from "../../core/types.js";
import { EVIDENCE_REF, SLOT_ID, briefSections, keyed, lineValue, sectionLines, sourceOf } from "./lib.js";

const ORDER = ["Direction", "Because", "Watch"] as const;

/** brief.sections: exactly `## Direction`, `## Because`, `## Watch`, in that order, each with at least one `- ` line and no loose text. */
export const sections: Criterion = subject => {
  const found = briefSections(subject.text);
  const failures: string[] = [];
  const headings = found.map(section => section.heading).filter(Boolean);
  if (headings.join("|") !== ORDER.join("|")) failures.push(`sections are ${headings.length ? headings.map(item => `"## ${item}"`).join(", ") : "none"}; a brief has "## Direction", "## Because" and "## Watch", in that order`);
  for (const section of found) {
    if (section.heading && !section.lines.length) failures.push(`"## ${section.heading}" has no "- " line`);
    for (const line of section.stray) failures.push(`${section.heading ? `"## ${section.heading}"` : "the body before the first section"} has loose text "${excerpt(line)}"; every line is a "- " item`);
  }
  return failures;
};

/** brief.keys: every `params.keys` entry (the contract's mustContain keys) is exactly one `- Key: value` Direction line with a value. */
export const keys: Criterion = (subject, params) => {
  const wanted = strings(params.keys);
  if (!wanted.length) return ["params.keys must list the contract's mustContain keys"];
  const lines = sectionLines(subject.text, "Direction") ?? [];
  const failures: string[] = [];
  for (const key of wanted) {
    const hits = lines.filter(line => line.startsWith(`${key}:`));
    if (!hits.length) failures.push(`Direction has no "- ${key}: ..." line`);
    else if (hits.length > 1) failures.push(`Direction answers "${key}" ${hits.length} times; once`);
    else if (!words(hits[0]!.slice(key.length + 1)).length) failures.push(`Direction "${key}" has no value`);
  }
  return failures;
};

/** brief.derived-upstream: the source is derived from at least one ref, and every ref is a Director slot (bare or `director:`) or a finding; never another agent, a URL or an owner note. */
export const derivedUpstream: Criterion = subject => {
  const source = sourceOf(subject);
  if (typeof source === "string") return [source];
  const failures: string[] = [];
  if (source.kind !== "derived") failures.push(`source kind is ${JSON.stringify(source.kind)}; a brief is derived`);
  if (!source.ref.length) failures.push("source cites nothing; a brief derives from Director pins or findings");
  for (const ref of source.ref) {
    const bare = ref.startsWith("director:") ? ref.slice("director:".length) : ref;
    if (EVIDENCE_REF.test(ref) || (SLOT_ID.test(bare) && !bare.includes(":"))) continue;
    failures.push(`source ref "${ref}" is not a Director slot or a finding; record outside evidence with clossys evidence and cite the finding`);
  }
  return failures;
};

/** The refs a Because line cites: its final parenthesis, split on commas and semicolons. */
function cited(line: string): string[] | undefined {
  const match = /\(([^()]+)\)\.?$/.exec(line.trim());
  return match ? match[1]!.split(/[;,]\s*/).map(item => item.trim()).filter(Boolean) : undefined;
}

/** brief.because-cited: every Because line ends with `(<ref>)` naming a source ref, and every source ref is cited by some Because line. */
export const becauseCited: Criterion = subject => {
  const source = sourceOf(subject);
  if (typeof source === "string") return [source];
  const lines = sectionLines(subject.text, "Because") ?? [];
  const refs = new Set(source.ref);
  const used = new Set<string>();
  const failures: string[] = [];
  for (const line of lines) {
    const list = cited(line);
    if (!list) { failures.push(`Because line "${excerpt(line)}" cites no source; end it with (<ref>)`); continue; }
    for (const ref of list) {
      if (refs.has(ref)) used.add(ref);
      else failures.push(`Because line cites "${ref}", which the source does not list`);
    }
  }
  for (const ref of refs) if (!used.has(ref)) failures.push(`source ref "${ref}" backs no Because line`);
  return failures;
};

const COMPARATOR = /(?:[<>]=?|[≤≥]|=|\b(?:reach(?:es)?|exceeds?|(?:falls?|drops?) (?:below|under)|rises? (?:above|over)|(?:is |stays )?(?:above|below|over|under)|at (?:least|most))\s)\s*[-+]?\d/;
const WINDOW = /\b(?:by \d{4}-\d{2}(?:-\d{2})?|(?:in|within|per|each|every|any|over) (?:any |a |the |one |\d+ )?(?:day|week|month|quarter|year|release|run|rebuild|review)s?)\b/i;
/** brief.watch-trigger: every Watch line reads `If <metric> <comparator> <number> <window>, then <action>.` */
export const watchTrigger: Criterion = subject => {
  const lines = sectionLines(subject.text, "Watch") ?? [];
  const failures: string[] = [];
  for (const line of lines) {
    const at = `Watch line "${excerpt(line)}"`;
    const match = /^If\s+(.+?),\s+then\s+(.+)$/.exec(line);
    if (!match) { failures.push(`${at} is not "If <metric> <comparator> <number> <window>, then <action>."`); continue; }
    if (!COMPARATOR.test(match[1]!)) failures.push(`${at} has no numeric threshold (>, <, >=, <=, = or reaches, exceeds, falls below ... a number)`);
    if (!WINDOW.test(match[1]!)) failures.push(`${at} has no time window (by <date>, or in any month, quarter, release ...)`);
    if (!/[.!]$/.test(match[2]!.trim()) || words(match[2]!).length < 2) failures.push(`${at} has no action sentence after "then"`);
  }
  return failures;
};

const INTERNAL = [
  { re: /\b(?:finding|evidence|director|designer|writer|publisher|producer):[a-z0-9]/i, what: "a record reference" },
  { re: /(?<![\w@/.-])[a-z][a-z0-9-]*\.[a-z0-9-]+\.[a-z0-9-]+(?![\w-])/, what: "a slot id" },
  { re: /`/, what: "code markup" },
  { re: /(?:^|\s)(?:packages|clossys|src)\/\S+/, what: "a file path" },
  { re: /\b(?:TODO|TBD|FIXME|lorem ipsum)\b|\?\?\?|\{\{/i, what: "a placeholder" },
];
/** brief.plain-direction: Direction reads as plain language: no record references, slot ids, file paths, code markup or placeholders. */
export const plainDirection: Criterion = subject => {
  const failures: string[] = [];
  for (const line of sectionLines(subject.text, "Direction") ?? []) {
    for (const item of INTERNAL) if (item.re.test(line)) failures.push(`Direction line "${excerpt(line)}" holds ${item.what}; Direction is plain language and evidence goes in Because`);
  }
  return failures;
};

/** brief.direction-values: every Direction value is at most `maxWords` words (required) and at most `maxSentences` sentences (default 1). */
export const directionValues: Criterion = (subject, params) => {
  const maxWords = num(params.maxWords, Number.NaN);
  if (!Number.isFinite(maxWords)) return ["params.maxWords must be a number"];
  const maxSentences = num(params.maxSentences, 1);
  const failures: string[] = [];
  for (const line of sectionLines(subject.text, "Direction") ?? []) {
    const value = lineValue(line);
    const count = words(value).length, said = sentences(value).length;
    if (count > maxWords) failures.push(`Direction "${excerpt(line, 40)}" has ${count} words; at most ${maxWords}`);
    if (said > maxSentences) failures.push(`Direction "${excerpt(line, 40)}" has ${said} sentences; at most ${maxSentences}`);
  }
  return failures;
};

const QUANTITY = /\d|\b(?:zero|none|free)\b/i;
/** brief.quantified: a measure brief states its numbers: at least `min` (default 2) Direction values carry a number, a date, or an explicit zero, none or free. */
export const quantified: Criterion = (subject, params) => {
  const min = num(params.min, 2);
  const values = (sectionLines(subject.text, "Direction") ?? []).filter(line => keyed(line)).map(lineValue);
  const count = values.filter(value => QUANTITY.test(value)).length;
  return count < min ? [`Direction states ${count} quantities (a number, a date, or zero, none or free); a measure brief states at least ${min}`] : [];
};

const BOUNDARY = /\b(?:not|never|no|avoid|without|rather than|instead of|in place of|only)\b/i;
/** brief.boundary: a profile says what it is not: a `Not`, `Never` or `Avoid` key, or a Direction line that excludes (not, never, no, avoid, rather than, instead of, only). */
export const boundary: Criterion = subject => {
  const lines = sectionLines(subject.text, "Direction") ?? [];
  const has = lines.some(line => /^(?:Not|Never|Avoid)(?:[- ][A-Za-z-]+)*:/.test(line) || BOUNDARY.test(lineValue(line)));
  return has ? [] : ["Direction draws no boundary; a profile says who or what it is not (a Not, Never or Avoid line, or an exclusion)"];
};
