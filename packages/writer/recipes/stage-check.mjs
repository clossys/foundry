#!/usr/bin/env node
/**
 * stage-check (Writer): the maker's own check of a craft stage's output, run before the stage is
 * recorded (slot-constitution.md section 5b; foundry-feedback-0015, -0018). Every recipe under
 * packages/writer/recipes/ calls it.
 *
 *   clossys recipe check <recipe-id> brief   <slot> <brief.json>      [--root <dir>]
 *   clossys recipe check <recipe-id> diverge <slot> <directions.json> [--root <dir>]
 *   clossys recipe check <recipe-id> draft   <slot> <draft.md>        [--root <dir>]
 *
 * brief and diverge: the shared rules of stage-core.mjs, plus: all Writer copy derives from the
 * pinned voice, so the brief lists identity.verbal.voice at its pin and every direction cites it;
 * every input is a Director or Writer slot or a recorded finding.
 * draft: the copy candidate meets the mechanical requirements its standard names (the 3S-ND
 * worklist classes): the source cites director:identity.verbal.voice and derives from pinned
 * director:/writer: slots and findings only, one entry per key whose meta id is the key, plain values
 * (no Markdown or HTML, no placeholder, no doubled spaces, valid ICU), within the contract's limits,
 * sentence case for headlines, and each lexicon, claim, narrative and pattern shape.
 *
 * Mechanical only: it reads files, never the clock, the network or randomness, and runs no model.
 * Exit 0 clean, 1 with one line per issue (rule id, the issue, the fix), 2 on a usage error.
 * Nothing under the judge (src/constitution, certifiers, guards) imports this file (R16.1).
 */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { FINDING_REF, checkBriefWith, checkDivergeWith, checkDraftWith, excerpt, findingOf, frontmatter, isRecord, issue, jsonField, pinOf, runStageCli, strings, words } from "./stage-core.mjs";
export { STAGES } from "./stage-core.mjs";

const AGENT = "writer";
/** The Director slot every Writer candidate derives from. */
export const VOICE_SLOT = "identity.verbal.voice";
export const VOICE = `director:${VOICE_SLOT}`;

const HOOKS = {
  needed: () => [VOICE_SLOT],
  brief(root, world, brief, out, inputs) {
    for (const item of inputs) if (typeof item.slot === "string") {
      const pin = pinOf(root, item.slot);
      if (pin && pin.agent !== "director" && pin.agent !== "writer") out.push(issue("R20", `input ${item.slot} is a ${pin.agent} slot`, "Writer copy derives from Director and Writer pins and findings only"));
    }
  },
  direction(root, world, direction, at, out, traits) {
    if (!traits.includes(VOICE_SLOT)) out.push(issue("R20", `${at} does not cite ${VOICE_SLOT}`, `derive the direction from the pinned voice: add "${VOICE_SLOT}" to traits`));
    for (const id of traits) if (typeof id === "string" && !FINDING_REF.test(id)) {
      const pin = pinOf(root, id);
      if (pin && pin.agent !== "director" && pin.agent !== "writer") out.push(issue("R20", `${at} cites ${id}, a ${pin.agent} slot`, "derive from Director and Writer pins and findings only"));
    }
  },
};

export const checkBrief = (root, slot, brief) => checkBriefWith(root, AGENT, slot, brief, HOOKS);
export const checkDiverge = (root, slot, file) => checkDivergeWith(root, AGENT, slot, file, HOOKS);

// ---- draft: the copy candidate's shape ----------------------------------------------------------

/** The locale sections and entries of a Writer body; loose lines outside an entry are `stray`. */
export function parseCopy(text) {
  const locales = [], entries = [], stray = [];
  let locale, open;
  const close = () => {
    if (!open || locale === undefined) return;
    const lines = [...open.lines];
    while (lines.length && !lines[0].trim()) lines.shift();
    let meta = "has no meta comment";
    const first = /^<!--\s*(\{.*\})\s*-->$/.exec(lines[0]?.trim() ?? "");
    if (first) {
      try { const parsed = JSON.parse(first[1]); meta = isRecord(parsed) ? parsed : "meta comment is not an object"; } catch { meta = "meta comment is not JSON"; }
      lines.shift();
    }
    const value = lines.join("\n").trim();
    const fence = /^```json\s*\n([\s\S]*?)\n```$/.exec(value);
    let json;
    if (fence) { try { json = JSON.parse(fence[1]); } catch { json = "the json block does not parse"; } }
    entries.push({ locale, key: open.key, meta, value: fence ? fence[1] : value, fenced: Boolean(fence), ...(fence ? { json } : {}) });
    open = undefined;
  };
  for (const raw of text.split(/\r?\n/)) {
    const h2 = /^##\s+(\S.*?)\s*$/.exec(raw);
    const h3 = /^###\s+(\S.*?)\s*$/.exec(raw);
    if (h2 && !raw.startsWith("###")) { close(); locale = h2[1]; locales.push(locale); continue; }
    if (h3) { close(); if (locale === undefined) stray.push(raw.trim()); else open = { key: h3[1], lines: [] }; continue; }
    if (open) open.lines.push(raw);
    else if (raw.trim()) stray.push(raw.trim());
  }
  close();
  return { locales, entries, stray };
}

const body = draft => frontmatter(draft.text).body;
const copyEntries = draft => parseCopy(body(draft)).entries;
function sourceOf(draft) {
  const read = jsonField(frontmatter(draft.text).fields, "source");
  if (read.error) return read.error;
  if (!isRecord(read.value)) return "the frontmatter source is not an object";
  return { kind: read.value.kind, ref: strings(read.value.ref) };
}
function localesOf(draft) {
  const raw = frontmatter(draft.text).fields?.locales;
  if (typeof raw !== "string") return Array.isArray(raw) ? strings(raw) : undefined;
  try { return strings(JSON.parse(raw)); } catch { return undefined; }
}

const UPSTREAM_REF = /^(?:(?:director|writer):[a-z][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*){1,3}(?:#[a-z0-9][a-z0-9.-]*)?|(?:finding|evidence):[a-z0-9][a-z0-9.-]*)$/;
const COPY_REF = /^[a-z][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*){1,3}#[a-z0-9][a-z0-9.-]*$/;
const PLACEHOLDER = /\b(?:TODO|TBD|FIXME|lorem ipsum|placeholder)\b|\?\?\?|\{\{\s*[\w.]+\s*\}\}|\bxxx\b/i;
const MARKUP = /\*\*|__|`|^#|\[[^\]]+\]\([^)]+\)|<\/?[a-z][^>]*>/m;
const PLACEHOLDERS = [/lorem ipsum/gi, /\bTODO\b/g, /\bTBD\b/g, /\bFIXME\b/g, /\bXXX\b/g, /\bAcme\b/g, /\{\{[^}]*\}\}/g, /\[(?:insert|placeholder|your)[^\]]*\]/gi];
const FILLER = ["very", "really", "just", "actually", "basically", "simply", "literally", "truly", "quite", "leverage", "utilize", "seamless", "seamlessly", "cutting-edge", "best-in-class", "game-changing", "revolutionary", "synergy", "robust", "world-class", "next-generation", "in order to"];
const PLURAL_KEYS = /^(?:=\d+|zero|one|two|few|many|other)$/;
const SUPERLATIVE = ["best", "fastest", "leading", "#1", "number one", "unmatched", "unrivalled", "unrivaled", "guaranteed", "always", "never fails", "100%"];
const HEADING_KEY = "(?:^|\\.)(?:heading|headline|title|eyebrow|tagline|label|primary|secondary)$";
const FRAME = /^frames\.[a-z0-9][a-z0-9.-]*$/;
const BLOCK_TYPES = new Set(["heading", "paragraph", "list", "quote", "callout", "code", "step", "item", "scene", "line"]);

/** A literal pattern: `/re/flags` as a regular expression, anything else as a whole-word, case-insensitive phrase. */
function phrase(source) {
  const regex = /^\/(.+)\/([a-z]*)$/.exec(source);
  if (regex) return new RegExp(regex[1], regex[2].includes("g") ? regex[2] : `${regex[2]}g`);
  const escaped = source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "giu");
}

/** ICU message issues: balanced braces, an `other` case, plural categories only. */
function icuIssues(message) {
  const out = [];
  let depth = 0;
  for (const char of message.replace(/'[^']*'/g, "")) {
    if (char === "{") depth++;
    if (char === "}" && --depth < 0) { out.push("unbalanced }"); depth = 0; }
  }
  if (depth > 0) out.push("unclosed {");
  if (out.length) return out;
  for (const match of message.matchAll(/\{\s*[\w.]+\s*,\s*(plural|select|selectordinal)\s*,/g)) {
    let at = match.index + match[0].length, level = 0, key = "";
    const keys = [];
    for (; at < message.length; at++) {
      const char = message[at];
      if (char === "{") { if (level === 0) { keys.push(key.trim().replace(/^offset:\d+\s*/, "")); key = ""; } level++; }
      else if (char === "}") { if (level === 0) break; level--; }
      else if (level === 0) key += char;
    }
    if (!keys.includes("other")) out.push(`${match[1]} argument has no "other" case`);
    if (match[1] !== "select") for (const each of keys) if (!PLURAL_KEYS.test(each)) out.push(`${match[1]} case "${each}" is not a plural category`);
  }
  return out;
}

const endsWithKey = (key, suffix) => key === suffix || key.endsWith(`.${suffix}`);
const numberOf = value => typeof value === "number" ? value : undefined;
/** The limits a slot contract states: passage fields by last key segment, pattern parts, a string's own. */
function contractLimits(contract) {
  if (!isRecord(contract)) return { limits: [], fallback: {} };
  const limits = new Map();
  if (contract.kind === "passage" && isRecord(contract.copy) && Array.isArray(contract.copy.fields)) {
    for (const field of contract.copy.fields.filter(isRecord)) {
      const max = isRecord(field.maxLength) ? numberOf(field.maxLength.en) : undefined;
      if (max === undefined || typeof field.key !== "string") continue;
      const suffix = field.key.split("[].").at(-1);
      const was = limits.get(suffix)?.maxChars;
      limits.set(suffix, { suffix, maxChars: was === undefined ? max : Math.min(was, max) });
    }
  }
  if (contract.kind === "pattern" && isRecord(contract.parts) && Array.isArray(contract.parts.items)) {
    for (const item of contract.parts.items.filter(isRecord)) {
      if (typeof item.id !== "string") continue;
      const maxChars = numberOf(item.maxChars), maxWords = numberOf(item.maxWords);
      limits.set(item.id, { suffix: item.id, ...(maxChars !== undefined ? { maxChars } : {}), ...(maxWords !== undefined ? { maxWords } : {}) });
    }
  }
  const maxChars = contract.kind === "string" ? numberOf(contract.maxChars) : undefined, maxWords = contract.kind === "string" ? numberOf(contract.maxWords) : undefined;
  return { limits: [...limits.values()], fallback: { ...(maxChars !== undefined ? { maxChars } : {}), ...(maxWords !== undefined ? { maxWords } : {}) } };
}
const limitRows = params => Array.isArray(params.limits) ? params.limits.filter(isRecord).map(item => ({ ...(typeof item.suffix === "string" ? { suffix: item.suffix } : {}), ...(typeof item.maxChars === "number" ? { maxChars: item.maxChars } : {}), ...(typeof item.maxWords === "number" ? { maxWords: item.maxWords } : {}) })) : [];

const RECORD_FIELDS = {
  "voice-rule": record => [...(typeof record.rule === "string" && record.rule ? [] : ["rule"]), ...(record.value !== undefined && record.value !== "" ? [] : ["value"])],
  format: record => [...(typeof record.format === "string" && record.format ? [] : ["format"]), ...(record.value !== undefined && record.value !== "" ? [] : ["value"])],
  term: record => [
    ...(typeof record.term === "string" && record.term ? [] : ["term"]),
    ...(strings(record.forms).length ? [] : ["forms"]),
    ...(["preferred", "avoid", "brand", "allowed", "deprecated"].includes(record.termStatus) ? [] : ["termStatus"]),
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
    if (valid) { try { new RegExp(source); } catch { valid = false; } }
    return [...(valid ? [] : ["pattern.source"]), ...(["error", "warning", "info"].includes(record.severity) ? [] : ["severity"]), ...(typeof record.reason === "string" && words(record.reason).length >= 3 ? [] : ["reason"])];
  },
};

function narrativeRefs(value, out = []) {
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
const partList = value => Array.isArray(value) ? value.filter(isRecord).filter(item => typeof item.id === "string").map(item => ({ id: item.id, required: item.required !== false })) : [];

/** The draft checks by requirement id: the maker's preflight of what each requirement asks. */
export const DRAFT_CHECKS = Object.freeze({
  "copy.voice-derived": draft => {
    const source = sourceOf(draft);
    if (typeof source === "string") return [{ what: source, fix: `write source: {"kind": "derived", "ref": ["${VOICE}", ...]}` }];
    return source.ref.includes(VOICE) ? [] : [{ what: `source does not cite ${VOICE}`, fix: `add "${VOICE}" to source.ref: Writer copy derives from the pinned brand voice` }];
  },
  "copy.derived-upstream": (draft, params, world, root) => {
    const source = sourceOf(draft);
    if (typeof source === "string") return [{ what: source, fix: 'write source: {"kind": "derived", "ref": [...]}' }];
    const out = [];
    if (source.kind !== "derived") out.push({ what: `source kind is ${JSON.stringify(source.kind)}`, fix: 'set "kind": "derived"; Writer copy derives from upstream pins' });
    if (!source.ref.length) out.push({ what: "source cites nothing", fix: `cite ${VOICE} and the slot's pinned inputs` });
    for (const ref of source.ref) {
      if (!UPSTREAM_REF.test(ref)) { out.push({ what: `source ref "${ref}" is not director:<slot>, writer:<slot> or a finding`, fix: "cite upstream as director:<slot>, writer:<slot>[#key] or finding:<id>; never a bare id or a URL" }); continue; }
      if (FINDING_REF.test(ref)) { if (!findingOf(root, ref)) out.push({ what: `source ref ${ref} is not a recorded finding`, fix: "record it with clossys evidence first" }); continue; }
      const [agent, rest] = ref.split(":");
      const slot = rest.split("#")[0];
      const pin = pinOf(root, slot);
      if (!pin || pin.agent !== agent) out.push({ what: `source ref ${ref} is not a pinned ${agent} slot`, fix: `pin ${slot} upstream first, or cite a pinned slot` });
    }
    return out;
  },
  "copy.entries": draft => {
    const parsed = parseCopy(body(draft));
    const out = [];
    const declared = localesOf(draft);
    if (!declared?.length) out.push({ what: "the frontmatter names no locales", fix: 'set locales: ["en"]' });
    else if ([...parsed.locales].sort().join("|") !== [...declared].sort().join("|")) out.push({ what: `locale sections are ${parsed.locales.join(", ") || "none"}; the frontmatter names ${declared.join(", ")}`, fix: "write one ## <locale> section per frontmatter locale" });
    if (!parsed.entries.length) out.push({ what: "the body holds no ### entries", fix: "write one ### <key> entry per key" });
    for (const line of parsed.stray) out.push({ what: `loose text "${excerpt(line)}" outside an entry`, fix: "put every line inside a ### <key> entry" });
    const seen = new Set();
    for (const entry of parsed.entries) {
      const at = `${entry.locale} ${entry.key}`;
      if (seen.has(at)) out.push({ what: `${at} appears twice`, fix: "write each key once per locale" });
      seen.add(at);
      if (typeof entry.meta === "string") out.push({ what: `${at} ${entry.meta}`, fix: `open the entry with <!-- {"id": "${entry.key}", "bindings": []} -->` });
      else if (entry.meta.id !== entry.key) out.push({ what: `${at} meta id is ${JSON.stringify(entry.meta.id)}, not the key`, fix: `set the meta id to "${entry.key}"` });
      if (!entry.value.trim()) out.push({ what: `${at} has no value`, fix: "write the value" });
      if (entry.fenced && typeof entry.json === "string") out.push({ what: `${at} ${entry.json}`, fix: "make the ```json block parse" });
    }
    return out;
  },
  "copy.plain-values": (draft, params) => {
    const out = [];
    for (const entry of copyEntries(draft)) {
      if (entry.fenced) continue;
      const at = `${entry.locale} ${entry.key}`;
      if (PLACEHOLDER.test(entry.value)) out.push({ what: `${at} holds placeholder text "${excerpt(entry.value, 40)}"`, fix: "write the finished value" });
      if (MARKUP.test(entry.value)) out.push({ what: `${at} holds markup`, fix: "write plain text: no Markdown (**, __, `, #, [link](url)) and no HTML tags" });
      if (/ {2,}|\t/.test(entry.value)) out.push({ what: `${at} has doubled spaces or tabs`, fix: "use single spaces" });
      if (params.icu === true) for (const found of icuIssues(entry.value)) out.push({ what: `${at} ${found}`, fix: "write a valid ICU message" });
    }
    return out;
  },
  "text.no-placeholder": (draft, params) => {
    const found = [];
    for (const regex of [...PLACEHOLDERS, ...strings(params.extra).map(phrase)]) found.push(...(body(draft).match(regex) ?? []));
    return [...new Set(found)].map(item => ({ what: `placeholder text "${item}"`, fix: "replace it with finished copy" }));
  },
  "lexicon.clean": (draft, params) => {
    const allow = new Set(strings(params.allow).map(item => item.toLowerCase()));
    const sources = [...strings(params.avoid), ...(params.filler === false ? [] : FILLER.filter(item => !allow.has(item)))];
    const found = new Set();
    for (const source of sources) for (const match of body(draft).match(phrase(source)) ?? []) found.add(match.toLowerCase());
    return [...found].map(item => ({ what: `avoid "${item}"`, fix: "say it plainly without the word" }));
  },
  "copy.within-limits": (draft, params) => {
    const stated = contractLimits(params.contract);
    const limits = limitRows(params).length ? limitRows(params) : stated.limits;
    const fallback = { ...(typeof params.maxChars === "number" ? { maxChars: params.maxChars } : {}), ...(typeof params.maxWords === "number" ? { maxWords: params.maxWords } : {}), ...stated.fallback };
    if (!limits.length && fallback.maxChars === undefined && fallback.maxWords === undefined) return [{ what: "neither the standard nor the contract states a limit", fix: "fix the slot contract before crafting" }];
    const out = [];
    for (const entry of copyEntries(draft)) {
      if (entry.fenced) continue;
      const row = limits.filter(item => item.suffix && endsWithKey(entry.key, item.suffix)).sort((a, b) => b.suffix.length - a.suffix.length)[0] ?? fallback;
      const at = `${entry.locale} ${entry.key}`;
      const chars = [...entry.value].length, count = words(entry.value).length;
      if (row.maxChars !== undefined && chars > row.maxChars) out.push({ what: `${at} has ${chars} characters; at most ${row.maxChars}`, fix: "cut the value to the limit" });
      if (row.maxWords !== undefined && count > row.maxWords) out.push({ what: `${at} has ${count} words; at most ${row.maxWords}`, fix: "cut the value to the limit" });
    }
    return out;
  },
  "copy.sentence-case": (draft, params) => {
    const match = new RegExp(typeof params.match === "string" ? params.match : HEADING_KEY);
    const proper = new Set(strings(params.proper));
    const out = [];
    for (const entry of copyEntries(draft)) {
      if (entry.fenced || !match.test(entry.key)) continue;
      const at = `${entry.locale} ${entry.key}`;
      const list = words(entry.value.replace(/\{[^{}]*\}/g, " "));
      const capped = list.slice(1).filter(word => /^\p{Lu}/u.test(word) && !/^[\p{Lu}\d-]+$/u.test(word) && !proper.has(word));
      if (capped.length) out.push({ what: `${at} "${excerpt(entry.value, 40)}" is not sentence case (${capped.join(", ")})`, fix: `lower-case ${capped.join(", ")}; only the first word, acronyms and ${[...proper].join(", ") || "proper names"} are capitalised` });
      if (/!\s*$/.test(entry.value)) out.push({ what: `${at} ends with "!"`, fix: "end without an exclamation mark" });
    }
    return out;
  },
  "lexicon.record": (draft, params) => {
    const kinds = strings(params.kinds);
    if (!kinds.length) return [{ what: "the standard lists no record kinds", fix: "fix the standard before crafting" }];
    const out = [];
    const list = copyEntries(draft);
    if (!list.length) out.push({ what: "the body holds no records", fix: "write one ```json record per key" });
    for (const entry of list) {
      const at = `${entry.locale} ${entry.key}`;
      if (!entry.fenced || !isRecord(entry.json)) { out.push({ what: `${at} is not one json record`, fix: "write the value as one ```json block" }); continue; }
      const record = entry.json;
      if (record.id !== entry.key) out.push({ what: `${at} record id is ${JSON.stringify(record.id)}, not the key`, fix: `set "id": "${entry.key}"` });
      if (record.context !== entry.key) out.push({ what: `${at} record context is ${JSON.stringify(record.context)}, not the key`, fix: `set "context": "${entry.key}"` });
      const kind = typeof record.kind === "string" ? record.kind : "";
      if (!kinds.includes(kind)) { out.push({ what: `${at} record kind is ${JSON.stringify(record.kind)}`, fix: `use ${kinds.join(" or ")}` }); continue; }
      const missing = RECORD_FIELDS[kind]?.(record) ?? [];
      if (missing.length) out.push({ what: `${at} ${kind} record lacks a valid ${missing.join(", ")}`, fix: `give the ${kind} record its fields` });
    }
    return out;
  },
  "lexicon.claim-sourced": (draft, params) => {
    const banned = [...SUPERLATIVE, ...strings(params.banned)];
    const out = [];
    for (const entry of copyEntries(draft)) {
      if (!isRecord(entry.json) || entry.json.kind !== "claim") continue;
      const at = `${entry.locale} ${entry.key}`;
      if (typeof entry.json.strategy !== "string" || !entry.json.strategy.startsWith("director:")) out.push({ what: `${at} claim cites no Director strategy`, fix: 'set "strategy": "director:<slot>"' });
      if (entry.json.requiresCitation !== true) out.push({ what: `${at} claim does not require a citation`, fix: 'set "requiresCitation": true' });
      for (const phrasing of strings(entry.json.phrasings)) for (const word of banned) if (phrase(word).test(phrasing)) out.push({ what: `${at} phrasing "${excerpt(phrasing, 40)}" claims "${word}"`, fix: "phrase the claim without an unprovable superlative" });
    }
    return out;
  },
  "narrative.sequence": draft => {
    const out = [];
    const list = copyEntries(draft);
    if (!list.length) out.push({ what: "the body holds no narrative", fix: "write one ```json narrative record per key" });
    for (const entry of list) {
      const at = `${entry.locale} ${entry.key}`;
      if (!entry.fenced || !isRecord(entry.json)) { out.push({ what: `${at} is not one json record`, fix: "write the value as one ```json block" }); continue; }
      const record = entry.json;
      if (record.id !== entry.key) out.push({ what: `${at} record id is ${JSON.stringify(record.id)}, not the key`, fix: `set "id": "${entry.key}"` });
      const frame = isRecord(record.frame) ? record.frame.frameId : undefined;
      if (typeof frame !== "string" || !FRAME.test(frame)) out.push({ what: `${at} names no frame`, fix: 'set "frame": {"frameId": "frames.<id>"}' });
      const refs = narrativeRefs(record);
      for (const ref of refs) if (!COPY_REF.test(ref)) out.push({ what: `${at} reference "${ref}" is not <slot>#<key>`, fix: "reference passages as <slot>#<key>" });
      const blocks = Array.isArray(record.blocks) ? record.blocks : [];
      blocks.forEach((block, index) => {
        if (!isRecord(block) || !BLOCK_TYPES.has(block.type)) out.push({ what: `${at} block ${index} has no known type`, fix: `use one of ${[...BLOCK_TYPES].join(", ")}` });
        else if (!(typeof block.text === "string" && words(block.text).length) && !strings(block.items).length) out.push({ what: `${at} block ${index} has no text`, fix: "give the block text or items" });
      });
      if (!refs.length && !blocks.length) out.push({ what: `${at} tells nothing`, fix: "add passage references or blocks" });
    }
    return out;
  },
  "pattern.parts": (draft, params) => {
    if (!partList(params.parts).length && isRecord(params.contract) && params.contract.kind !== "pattern") return [];
    const parts = partList(params.parts).length ? partList(params.parts) : isRecord(params.contract) && isRecord(params.contract.parts) ? partList(params.contract.parts.items) : [];
    if (!parts.length) return [{ what: "the contract lists no pattern parts", fix: "fix the slot contract before crafting" }];
    const out = [];
    const groups = new Map();
    const list = copyEntries(draft);
    if (!list.length) out.push({ what: "the body holds no parts", fix: "write one entry per part" });
    for (const entry of list) {
      const part = parts.filter(item => endsWithKey(entry.key, item.id)).sort((a, b) => b.id.length - a.id.length)[0];
      if (!part) { out.push({ what: `${entry.locale} ${entry.key} is not one of the parts ${parts.map(item => item.id).join(", ")}`, fix: "end every key with a part id" }); continue; }
      const group = `${entry.locale} ${entry.key === part.id ? "" : entry.key.slice(0, -(part.id.length + 1))}`;
      groups.set(group, [...(groups.get(group) ?? []), part.id]);
    }
    for (const [group, found] of groups) for (const part of parts) {
      const count = found.filter(item => item === part.id).length;
      if (part.required && count === 0) out.push({ what: `${group.trim()} has no ${part.id} part`, fix: `write the ${part.id} part` });
      if (count > 1) out.push({ what: `${group.trim()} has ${count} ${part.id} parts`, fix: "write each part once per group" });
    }
    return out;
  },
});

/** Maker-only: the frontmatter names this slot. */
function draftExtra(root, world, draft) {
  const { fields } = frontmatter(draft.text);
  if (!fields) return [issue("R15.3", "the draft has no frontmatter", "open with --- slot, locales, source ---")];
  return fields.slot === world.slot ? [] : [issue("R15.3", `the draft frontmatter slot is ${JSON.stringify(fields.slot)}`, `set slot: "${world.slot}"`)];
}

export const checkDraft = (root, slot, draft) => checkDraftWith(root, AGENT, slot, draft, DRAFT_CHECKS, draftExtra);

export const main = (argv, cwd = process.cwd()) => runStageCli(AGENT, { brief: checkBrief, diverge: checkDiverge, draft: checkDraft }, argv, cwd);

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = main(process.argv.slice(2));
  (result.code === 0 ? process.stdout : process.stderr).write(result.text);
  process.exitCode = result.code;
}
