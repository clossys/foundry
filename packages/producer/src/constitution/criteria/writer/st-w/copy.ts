/**
 * Writer copy criteria (ST-W1, ST-W2, slot-constitution.md section 5a): the mechanical half of the
 * nine Writer standards. All copy derives from the pinned voice (`director:identity.verbal.voice`)
 * and other upstream pins only, is well-formed per locale and key, and holds plain, finished values
 * within the contract's limits; headlines are sentence case; lexicon records, claims, narratives and
 * pattern parts each have their own shape. Pure.
 */
import { excerpt, isRecord, pattern, strings, words } from "../../core/lib.js";
import { icuIssues } from "../../core/markup.js";
import type { Criterion, Params } from "../../core/types.js";
import { COPY_REF, UPSTREAM_REF, localesOf, parseCopy, sourceOf, type CopyEntry } from "./lib.js";

export const VOICE = "director:identity.verbal.voice";

/** copy.voice-derived: the source cites the pinned voice, `director:identity.verbal.voice` (Writer copy derives from it). */
export const voiceDerived: Criterion = subject => {
  const source = sourceOf(subject);
  if (typeof source === "string") return [source];
  return source.ref.includes(VOICE) ? [] : [`source does not cite ${VOICE}; Writer copy derives from the pinned voice`];
};

/** copy.derived-upstream: the source is derived, and every ref is a Director or Writer slot (`<agent>:<slot>[#key]`) or a finding; never a bare id, another agent or a URL. */
export const derivedUpstream: Criterion = subject => {
  const source = sourceOf(subject);
  if (typeof source === "string") return [source];
  const failures: string[] = [];
  if (source.kind !== "derived") failures.push(`source kind is ${JSON.stringify(source.kind)}; Writer copy is derived from upstream pins`);
  if (!source.ref.length) failures.push("source cites nothing");
  for (const ref of source.ref) if (!UPSTREAM_REF.test(ref)) failures.push(`source ref "${ref}" is not director:<slot>, writer:<slot> or a finding`);
  return failures;
};

/** copy.entries: one `## <locale>` per frontmatter locale; each `### <key>` opens with a meta comment whose id is the key, holds a value, and appears once per locale; nothing loose. */
export const entries: Criterion = subject => {
  const body = parseCopy(subject.text);
  const failures: string[] = [];
  const declared = localesOf(subject);
  if (!declared?.length) failures.push("the frontmatter names no locales");
  else if ([...body.locales].sort().join("|") !== [...declared].sort().join("|")) failures.push(`locale sections are ${body.locales.join(", ") || "none"}; the frontmatter names ${declared.join(", ")}`);
  if (!body.entries.length) failures.push("the body holds no ### entries");
  for (const line of body.stray) failures.push(`loose text "${excerpt(line)}" outside an entry`);
  const seen = new Set<string>();
  for (const entry of body.entries) {
    const at = `${entry.locale} ${entry.key}`;
    if (seen.has(at)) failures.push(`${at} appears twice`);
    seen.add(at);
    if (typeof entry.meta === "string") failures.push(`${at} ${entry.meta}`);
    else if (entry.meta.id !== entry.key) failures.push(`${at} meta id is ${JSON.stringify(entry.meta.id)}, not the key`);
    if (!entry.value.trim()) failures.push(`${at} has no value`);
    if (entry.fenced && typeof entry.json === "string") failures.push(`${at} ${entry.json}`);
  }
  return failures;
};

const PLACEHOLDER = /\b(?:TODO|TBD|FIXME|lorem ipsum|placeholder)\b|\?\?\?|\{\{\s*[\w.]+\s*\}\}|\bxxx\b/i;
const MARKUP = /\*\*|__|`|^#|\[[^\]]+\]\([^)]+\)|<\/?[a-z][^>]*>/m;
/** copy.plain-values: every plain value is finished: no placeholder, Markdown or HTML, no doubled or edge spaces, and valid ICU when `params.icu` is true. */
export const plainValues: Criterion = (subject, params) => {
  const failures: string[] = [];
  for (const entry of parseCopy(subject.text).entries) {
    if (entry.fenced) continue;
    const at = `${entry.locale} ${entry.key}`;
    if (PLACEHOLDER.test(entry.value)) failures.push(`${at} holds placeholder text "${excerpt(entry.value, 40)}"`);
    if (MARKUP.test(entry.value)) failures.push(`${at} holds markup; values are plain text`);
    if (/ {2,}|\t/.test(entry.value)) failures.push(`${at} has doubled spaces or tabs`);
    if (params.icu === true) for (const issue of icuIssues(entry.value)) failures.push(`${at} ${issue}`);
  }
  return failures;
};

interface Limit { readonly suffix?: string; readonly maxChars?: number; readonly maxWords?: number }
const limitsOf = (params: Params): Limit[] => Array.isArray(params.limits) ? params.limits.filter(isRecord).map(item => ({
  ...(typeof item.suffix === "string" ? { suffix: item.suffix } : {}),
  ...(typeof item.maxChars === "number" ? { maxChars: item.maxChars } : {}),
  ...(typeof item.maxWords === "number" ? { maxWords: item.maxWords } : {}),
})) : [];
const endsWithKey = (key: string, suffix: string) => key === suffix || key.endsWith(`.${suffix}`);

/**
 * copy.within-limits: every plain value is within its limit: the `params.limits` row whose `suffix`
 * ends the key (longest suffix wins), else the default `params.maxChars` / `params.maxWords`. At
 * least one limit is required.
 */
export const withinLimits: Criterion = (subject, params) => {
  const limits = limitsOf(params);
  const fallback: Limit = { ...(typeof params.maxChars === "number" ? { maxChars: params.maxChars } : {}), ...(typeof params.maxWords === "number" ? { maxWords: params.maxWords } : {}) };
  if (!limits.length && fallback.maxChars === undefined && fallback.maxWords === undefined) return ["params need maxChars, maxWords or limits[]"];
  const failures: string[] = [];
  for (const entry of parseCopy(subject.text).entries) {
    if (entry.fenced) continue;
    const row = limits.filter(item => item.suffix && endsWithKey(entry.key, item.suffix)).sort((a, b) => b.suffix!.length - a.suffix!.length)[0] ?? fallback;
    const at = `${entry.locale} ${entry.key}`;
    const chars = [...entry.value].length, count = words(entry.value).length;
    if (row.maxChars !== undefined && chars > row.maxChars) failures.push(`${at} has ${chars} characters; at most ${row.maxChars}`);
    if (row.maxWords !== undefined && count > row.maxWords) failures.push(`${at} has ${count} words; at most ${row.maxWords}`);
  }
  return failures;
};

const HEADING_KEY = "(?:^|\\.)(?:heading|headline|title|eyebrow|tagline|label|primary|secondary)$";
/**
 * copy.sentence-case: every plain value whose key matches `params.match` (a regex, default heading,
 * headline, title, eyebrow, tagline, label, primary, secondary) is sentence case: after the first
 * word, a capitalised word is a `params.proper` name or an acronym; and it never ends in `!`.
 */
export const sentenceCase: Criterion = (subject, params) => {
  const match = new RegExp(typeof params.match === "string" ? params.match : HEADING_KEY);
  const proper = new Set(strings(params.proper));
  const failures: string[] = [];
  for (const entry of parseCopy(subject.text).entries) {
    if (entry.fenced || !match.test(entry.key)) continue;
    const at = `${entry.locale} ${entry.key}`;
    const list = words(entry.value.replace(/\{[^{}]*\}/g, " "));
    const capped = list.slice(1).filter(word => /^\p{Lu}/u.test(word) && !/^[\p{Lu}\d-]+$/u.test(word) && !proper.has(word));
    if (capped.length) failures.push(`${at} "${excerpt(entry.value, 40)}" is not sentence case (${capped.join(", ")})`);
    if (/!\s*$/.test(entry.value)) failures.push(`${at} ends with "!"`);
  }
  return failures;
};

const RECORD_FIELDS: Readonly<Record<string, (record: Record<string, unknown>) => string[]>> = {
  "voice-rule": record => [
    ...(typeof record.rule === "string" && record.rule ? [] : ["rule"]),
    ...(record.value !== undefined && record.value !== "" ? [] : ["value"]),
  ],
  format: record => [
    ...(typeof record.format === "string" && record.format ? [] : ["format"]),
    ...(record.value !== undefined && record.value !== "" ? [] : ["value"]),
  ],
  term: record => [
    ...(typeof record.term === "string" && record.term ? [] : ["term"]),
    ...(strings(record.forms).length ? [] : ["forms"]),
    ...(["preferred", "avoid", "brand", "allowed", "deprecated"].includes(record.termStatus as string) ? [] : ["termStatus"]),
    ...(typeof record.reason === "string" && words(record.reason).length >= 3 ? [] : ["reason"]),
  ],
  claim: record => [
    ...(typeof record.strategy === "string" && /^director:[a-z][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*){1,3}$/.test(record.strategy) ? [] : ["strategy"]),
    ...(strings(record.phrasings).length ? [] : ["phrasings"]),
    ...(typeof record.requiresCitation === "boolean" ? [] : ["requiresCitation"]),
  ],
  "pattern-rule": record => {
    const source = isRecord(record.pattern) ? record.pattern.source : undefined;
    let valid = typeof source === "string" && source.length > 0;
    if (valid) { try { new RegExp(source as string); } catch { valid = false; } }
    return [
      ...(valid ? [] : ["pattern.source"]),
      ...(["error", "warning", "info"].includes(record.severity as string) ? [] : ["severity"]),
      ...(typeof record.reason === "string" && words(record.reason).length >= 3 ? [] : ["reason"]),
    ];
  },
};

/** lexicon.record: every entry is one json record whose id and context are the key, whose kind is one of `params.kinds` (required), and which carries that kind's fields. */
export const lexiconRecord: Criterion = (subject, params) => {
  const kinds = strings(params.kinds);
  if (!kinds.length) return ["params.kinds must list the record kinds"];
  const failures: string[] = [];
  const list = parseCopy(subject.text).entries;
  if (!list.length) failures.push("the body holds no records");
  for (const entry of list) {
    const at = `${entry.locale} ${entry.key}`;
    if (!entry.fenced || !isRecord(entry.json)) { failures.push(`${at} is not one json record`); continue; }
    const record = entry.json;
    if (record.id !== entry.key) failures.push(`${at} record id is ${JSON.stringify(record.id)}, not the key`);
    if (record.context !== entry.key) failures.push(`${at} record context is ${JSON.stringify(record.context)}, not the key`);
    const kind = typeof record.kind === "string" ? record.kind : "";
    if (!kinds.includes(kind)) { failures.push(`${at} record kind is ${JSON.stringify(record.kind)}; this list holds ${kinds.join(" or ")}`); continue; }
    const missing = RECORD_FIELDS[kind]?.(record) ?? [];
    if (missing.length) failures.push(`${at} ${kind} record lacks a valid ${missing.join(", ")}`);
  }
  return failures;
};

const SUPERLATIVE = ["best", "fastest", "leading", "#1", "number one", "unmatched", "unrivalled", "unrivaled", "guaranteed", "always", "never fails", "100%"];
/** lexicon.claim-sourced: every claim record cites a Director strategy, requires a citation, and phrases it without unprovable superlatives (`params.banned` adds more). */
export const claimSourced: Criterion = (subject, params) => {
  const banned = [...SUPERLATIVE, ...strings(params.banned)];
  const failures: string[] = [];
  for (const entry of parseCopy(subject.text).entries) {
    if (!isRecord(entry.json) || entry.json.kind !== "claim") continue;
    const at = `${entry.locale} ${entry.key}`;
    if (typeof entry.json.strategy !== "string" || !entry.json.strategy.startsWith("director:")) failures.push(`${at} claim cites no Director strategy`);
    if (entry.json.requiresCitation !== true) failures.push(`${at} claim does not require a citation`);
    for (const phrasing of strings(entry.json.phrasings)) {
      for (const word of banned) if (pattern(word).test(phrasing)) failures.push(`${at} phrasing "${excerpt(phrasing, 40)}" claims "${word}"`);
    }
  }
  return failures;
};

const FRAME = /^frames\.[a-z0-9][a-z0-9.-]*$/;
const BLOCK_TYPES = new Set(["heading", "paragraph", "list", "quote", "callout", "code", "step", "item", "scene", "line"]);
/** Every `{ref, id}` reference or `passages[]` entry of a narrative record. */
function narrativeRefs(value: unknown, out: string[] = []): string[] {
  if (Array.isArray(value)) for (const item of value) narrativeRefs(item, out);
  else if (isRecord(value)) {
    if (typeof value.ref === "string" && typeof value.id === "string") out.push(value.id);
    for (const [key, item] of Object.entries(value)) {
      if (key === "passages") out.push(...strings(item));
      else if (key !== "frame") narrativeRefs(item, out);
    }
  }
  return out;
}

/**
 * narrative.sequence: every entry is one json record (id and context the key) set in a frame
 * (`frame.frameId` a `frames.*` id) that tells its story as passage references (`passages[]` or
 * `{ref, id}` regions, each `<slot>#<key>`) or as typed blocks with text; at least one of the two.
 */
export const narrativeSequence: Criterion = subject => {
  const failures: string[] = [];
  const list = parseCopy(subject.text).entries;
  if (!list.length) failures.push("the body holds no narrative");
  for (const entry of list) {
    const at = `${entry.locale} ${entry.key}`;
    if (!entry.fenced || !isRecord(entry.json)) { failures.push(`${at} is not one json record`); continue; }
    const record = entry.json;
    if (record.id !== entry.key) failures.push(`${at} record id is ${JSON.stringify(record.id)}, not the key`);
    const frame = isRecord(record.frame) ? record.frame.frameId : undefined;
    if (typeof frame !== "string" || !FRAME.test(frame)) failures.push(`${at} names no frame (frame.frameId frames.*)`);
    const refs = narrativeRefs(record);
    for (const ref of refs) if (!COPY_REF.test(ref)) failures.push(`${at} reference "${ref}" is not <slot>#<key>`);
    const blocks = Array.isArray(record.blocks) ? record.blocks : [];
    blocks.forEach((block, index) => {
      if (!isRecord(block) || !BLOCK_TYPES.has(block.type as string)) failures.push(`${at} block ${index} has no known type`);
      else if (!(typeof block.text === "string" && words(block.text).length) && !strings(block.items).length) failures.push(`${at} block ${index} has no text`);
    });
    if (!refs.length && !blocks.length) failures.push(`${at} tells nothing: no passage references and no blocks`);
  }
  return failures;
};

interface Part { readonly id: string; readonly required: boolean }
const partsOf = (params: Params): Part[] => Array.isArray(params.parts) ? params.parts.filter(isRecord).filter(item => typeof item.id === "string").map(item => ({ id: item.id as string, required: item.required !== false })) : [];

/** pattern.parts: every key ends in `.<part>` for one of `params.parts` (required), and every group (the key before its part) holds each required part once. */
export const patternParts: Criterion = (subject, params) => {
  const parts = partsOf(params);
  if (!parts.length) return ["params.parts must list the pattern's parts"];
  const failures: string[] = [];
  const groups = new Map<string, string[]>();
  const list: CopyEntry[] = [...parseCopy(subject.text).entries];
  if (!list.length) failures.push("the body holds no parts");
  for (const entry of list) {
    const part = parts.filter(item => endsWithKey(entry.key, item.id)).sort((a, b) => b.id.length - a.id.length)[0];
    if (!part) { failures.push(`${entry.locale} ${entry.key} is not one of the parts ${parts.map(item => item.id).join(", ")}`); continue; }
    const group = `${entry.locale} ${entry.key === part.id ? "" : entry.key.slice(0, -(part.id.length + 1))}`;
    groups.set(group, [...(groups.get(group) ?? []), part.id]);
  }
  for (const [group, found] of groups) {
    for (const part of parts) {
      const count = found.filter(item => item === part.id).length;
      if (part.required && count === 0) failures.push(`${group.trim()} has no ${part.id} part`);
      if (count > 1) failures.push(`${group.trim()} has ${count} ${part.id} parts`);
    }
  }
  return failures;
};
