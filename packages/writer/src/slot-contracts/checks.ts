/**
 * Writer check suite `writer.copy.v1`. Deterministic and report-only:
 * callers decide whether findings fail a run.
 */
import { parseCell, type Cell } from "@clossys/director";
import { parseWriterCell, type CellRecord, type JsonRecord, type WriterCell } from "../cells/parse.js";
import { exemplarTexts, loadWriterContracts, WRITER_CHECK_SUITE_ID, type WriterContracts, type WriterFieldLimit, type WriterSlotContract } from "./format.js";
import { copiedExemplar, normalizeText, stripIcu } from "./similarity.js";

export type WriterCheckId = "W-LEN" | "W-ROOM" | "W-REQ" | "W-VOICE" | "W-BRAND" | "W-CLAIM" | "W-ORIG" | "W-DUP" | "INPUT";
export const WRITER_CHECKS: ReadonlyArray<{ id: Exclude<WriterCheckId, "INPUT">; description: string }> = [
  { id: "W-LEN", description: "Characters, words and line breaks per key stay within the slot limits; narrative counts stay in range." },
  { id: "W-ROOM", description: "Source-locale text leaves the translation-expansion headroom (30%) below maxChars." },
  { id: "W-REQ", description: "Required parts, fields and record properties are present." },
  { id: "W-VOICE", description: "No phrase banned by the Director voice cell, the proof cell's never-claims or lexicon avoid records." },
  { id: "W-BRAND", description: "Brand names use an accepted spelling from the Director name cell or lexicon brand terms." },
  { id: "W-CLAIM", description: "Numbers, percentages, currency and superlatives (best, first, only...) carry a claim or evidence reference." },
  { id: "W-ORIG", description: "Copy does not reproduce a reference exemplar verbatim or near-verbatim." },
  { id: "W-DUP", description: "Copy in unique slots is not repeated on another page." },
];

export interface WriterFinding {
  check: WriterCheckId;
  severity: "error" | "warning";
  slot: string;
  path: string;
  record?: string;
  locale?: string;
  key?: string;
  message: string;
}
export interface DirectorVoice {
  banned: Array<{ phrase: string; source: string }>;
  brands: Array<{ name: string; forms: string[]; source: string }>;
}
export interface WriterSuiteResult {
  suite: typeof WRITER_CHECK_SUITE_ID;
  checks: typeof WRITER_CHECKS;
  files: string[];
  records: number;
  findings: WriterFinding[];
}

export const SUPERLATIVES = ["best", "first", "only", "fastest", "leading", "#1", "number one", "guaranteed", "guarantee", "most", "largest", "biggest", "cheapest", "unmatched", "unrivalled", "unrivaled", "unbeatable", "always", "never fails", "100%"];
const NEGATIVE_KEYS = ["Never", "Avoid", "Not", "Refuse", "Never-claim"];
const object = (v: unknown): v is JsonRecord => v !== null && typeof v === "object" && !Array.isArray(v);
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const phraseRe = (phrase: string, flags = "iu") => new RegExp(`(?<![\\p{L}\\p{N}])${escape(phrase)}(?![\\p{L}\\p{N}])`, flags);
const wordCount = (t: string) => t.trim().split(/\s+/).filter(Boolean).length;
const quotedPhrases = (t: string) => [...t.matchAll(/["“]([^"”]+)["”]/g)].map(m => m[1]!.trim()).filter(Boolean);

function listItems(text: string): string[] {
  const quoted = quotedPhrases(text);
  if (quoted.length) return quoted;
  return text.split(/[,;]/).map(s => s.trim().replace(/^(?:and|or)\s+/i, "").replace(/[.]+$/, "").trim()).filter(s => s && wordCount(s) <= 4);
}

/** Read banned phrases and brand names from Director voice, proof and name cells. */
export function directorVoiceFromCells(cells: Cell[]): DirectorVoice {
  const latest = new Map<string, Cell>();
  for (const c of cells) if (c.status !== "retired" && (latest.get(c.id)?.version ?? 0) < c.version) latest.set(c.id, c);
  const voice: DirectorVoice = { banned: [], brands: [] };
  for (const id of ["identity.verbal.voice", "advantage.proposition.proof"]) {
    const cell = latest.get(id); if (!cell) continue;
    for (const b of cell.direction) if (b.key && NEGATIVE_KEYS.includes(b.key)) for (const phrase of listItems(b.text)) voice.banned.push({ phrase, source: `director:${id}@${cell.version}` });
  }
  const name = latest.get("identity.naming.name");
  if (name) {
    const nameBullet = name.direction.find(b => b.key === "Name");
    const casing = name.direction.find(b => b.key === "Casing");
    const names = nameBullet ? (quotedPhrases(nameBullet.text).length ? quotedPhrases(nameBullet.text) : [nameBullet.text.replace(/\s*\([^)]*\)\s*$/, "").replace(/[.]+$/, "").trim()]) : [];
    const forms = casing ? quotedPhrases(casing.text) : [];
    for (const n of names.filter(Boolean)) voice.brands.push({ name: n, forms: [...new Set([n, ...forms.filter(f => normalizeText(f).replace(/ /g, "") .startsWith(normalizeText(n).replace(/ /g, "")))])], source: `director:identity.naming.name@${name.version}` });
  }
  return voice;
}

interface Located { cell: WriterCell; path: string; item: CellRecord }
type Index = Map<string, JsonRecord>;
const indexKey = (locale: string, id: string) => `${locale}\0${id}`;

function resolveRef(ref: unknown, locale: string, index: Index): string[] | undefined {
  if (!object(ref) || typeof ref.id !== "string") return undefined;
  const target = index.get(indexKey(locale, ref.id));
  if (!target) return undefined;
  if (ref.ref === "term") return typeof target.term === "string" ? [target.term] : [];
  if (ref.ref === "pattern") {
    const parts = object(target.parts) ? target.parts : {};
    const chosen = typeof ref.part === "string" ? [parts[ref.part]] : Object.values(parts);
    return chosen.flatMap(p => object(p) && typeof p.text === "string" ? [p.text] : object(p) && object(p.ref) ? resolveRef({ ref: "string", ...p.ref }, locale, index) ?? [] : []);
  }
  return typeof target.text === "string" ? [target.text] : [];
}

function blockTexts(blocks: unknown): string[] {
  if (!Array.isArray(blocks)) return [];
  return blocks.flatMap(b => object(b) ? [...(typeof b.text === "string" ? [b.text] : []), ...blockTexts(b.children)] : []);
}

/** Text values per key, plus keys present but unresolved (for W-REQ). */
function recordTexts(record: JsonRecord, contract: WriterSlotContract, locale: string, index: Index): { texts: Array<{ key: string; text: string }>; present: Set<string> } {
  const texts: Array<{ key: string; text: string }> = []; const present = new Set<string>();
  const push = (key: string, values: string[] | undefined) => { present.add(key); for (const v of values ?? []) texts.push({ key, text: v }); };
  if (contract.layer === "strings") { if (typeof record.text === "string") push("text", [record.text]); }
  else if (contract.layer === "patterns" && object(record.parts)) {
    for (const [key, part] of Object.entries(record.parts)) push(key, object(part) && typeof part.text === "string" ? [part.text] : object(part) && object(part.ref) ? resolveRef({ ref: "string", ...part.ref }, locale, index) : undefined);
  } else if (contract.layer === "passages" && object(record.fields)) {
    for (const [key, value] of Object.entries(record.fields)) push(key, (Array.isArray(value) ? value : [value]).flatMap(r => resolveRef(r, locale, index) ?? []));
  } else if (contract.layer === "narratives") {
    if (typeof record.title === "string") push("title", [record.title]);
    push("blocks", blockTexts(record.blocks));
  } else if (contract.layer === "lexicon") {
    for (const key of ["term", "alternative"]) if (typeof record[key] === "string") push(key, [record[key] as string]);
    if (Array.isArray(record.phrasings)) push("phrasings", record.phrasings.filter((p): p is string => typeof p === "string"));
  }
  return { texts, present };
}

function lengthFindings(text: string, limit: WriterFieldLimit, headroom: number, source: boolean): Array<{ check: "W-LEN" | "W-ROOM"; severity: "error" | "warning"; message: string }> {
  const out: Array<{ check: "W-LEN" | "W-ROOM"; severity: "error" | "warning"; message: string }> = [];
  const chars = [...text].length; const words = wordCount(stripIcu(text)); const lines = text.split("\n").length;
  if (chars > limit.maxChars) out.push({ check: "W-LEN", severity: "error", message: `${chars} characters; limit is ${limit.maxChars}` });
  if (limit.maxWords !== undefined && words > limit.maxWords) out.push({ check: "W-LEN", severity: "error", message: `${words} words; limit is ${limit.maxWords}` });
  if (limit.minChars !== undefined && chars < limit.minChars) out.push({ check: "W-LEN", severity: "error", message: `${chars} characters; minimum is ${limit.minChars}` });
  if (limit.minWords !== undefined && words < limit.minWords) out.push({ check: "W-LEN", severity: "error", message: `${words} words; minimum is ${limit.minWords}` });
  if (limit.maxLines !== undefined && lines > limit.maxLines) out.push({ check: "W-LEN", severity: "error", message: `${lines} lines; limit is ${limit.maxLines}` });
  const room = Math.floor(limit.maxChars / (1 + headroom));
  if (source && chars <= limit.maxChars && chars > room) out.push({ check: "W-ROOM", severity: "warning", message: `${chars} characters leaves less than ${Math.round(headroom * 100)}% translation headroom (keep to ${room})` });
  return out;
}

const MONTH = "(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
const DATE_RES = [
  new RegExp(`(?<![\\p{L}\\p{N}])\\d{1,2}(?:st|nd|rd|th)?\\s+${MONTH}\\.?,?\\s+\\d{4}(?![\\p{L}\\p{N}])`, "giu"),
  new RegExp(`(?<![\\p{L}\\p{N}])${MONTH}\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s+\\d{4}(?![\\p{L}\\p{N}])`, "giu"),
  /(?<![\p{L}\p{N}])\d{4}-\d{2}-\d{2}(?![\p{L}\p{N}])/gu,
];
/** Calendar dates (a draft or revision date) state when, not how much; they are not claims. */
export function stripDates(text: string): string {
  return DATE_RES.reduce((t, re) => t.replace(re, " "), text);
}
/**
 * "first" is a claim only in superlative use (world's first, first-ever, the
 * first tool to do X); ordinal use (the first version, the first step) is not.
 */
const FIRST_CLAIM = /(?<![\p{L}\p{N}])(?:(?:world|industry|market|country|nation|sector|category)['’]s\s+first|first[-\s]ever|first\s+of\s+its\s+kind|first\s+(?:[\p{L}-]+\s+){0,2}to\s+(?!the\b|a\b|an\b)\p{L}+)(?![\p{L}\p{N}])/iu;

function claimHits(text: string): string[] {
  const bare = stripDates(stripIcu(text)); const hits: string[] = [];
  if (/\p{N}/u.test(bare)) hits.push("number");
  if (/%/.test(bare)) hits.push("percentage");
  if (/[$€£¥₹]/u.test(bare)) hits.push("currency");
  for (const s of SUPERLATIVES) if (s === "first" ? FIRST_CLAIM.test(bare) : phraseRe(s).test(bare)) hits.push(`"${s}"`);
  return [...new Set(hits)];
}

function brandRe(name: string): RegExp {
  const letters = [...name.replace(/[\s-]+/g, "")].map(escape).join("[\\s-]?");
  return new RegExp(`(?<![\\p{L}\\p{N}])${letters}(?![\\p{L}\\p{N}])`, "giu");
}

interface VoiceRules {
  banned: DirectorVoice["banned"];
  brands: DirectorVoice["brands"];
  patternRules: Array<{ re: RegExp; source: string; severity: "error" | "warning" }>;
}

/** Banned phrases, brand spellings and avoided patterns: the Director voice plus the Writer's own lexicon records. */
function voiceRules(records: readonly JsonRecord[], director: DirectorVoice | undefined): VoiceRules {
  const rules: VoiceRules = { banned: [...(director?.banned ?? [])], brands: [...(director?.brands ?? [])], patternRules: [] };
  for (const r of records) {
    if (r.kind === "term" && typeof r.term === "string") {
      const forms = Array.isArray(r.forms) ? r.forms.filter((f): f is string => typeof f === "string") : [];
      if (r.termStatus === "avoid") for (const phrase of [r.term, ...forms]) rules.banned.push({ phrase, source: `writer:${String(r.id)}` });
      if (r.termStatus === "brand") rules.brands.push({ name: r.term, forms: [r.term, ...forms], source: `writer:${String(r.id)}` });
    }
    if (r.kind === "pattern-rule" && object(r.pattern) && typeof r.pattern.source === "string") {
      try { rules.patternRules.push({ re: new RegExp(r.pattern.source, `${typeof r.pattern.flags === "string" ? r.pattern.flags.replace(/g/g, "") : ""}u`), source: `writer:${String(r.id)}`, severity: r.severity === "error" ? "error" : "warning" }); } catch { /* invalid rule is the lexicon checker's finding */ }
    }
  }
  return rules;
}

type TextFinding = { check: WriterCheckId; severity: "error" | "warning"; message: string };
/** W-LEN, W-ROOM, W-VOICE, W-BRAND, W-CLAIM and W-ORIG over one text value. */
function textFindings(text: string, limit: WriterFieldLimit | undefined, contract: WriterSlotContract, r: JsonRecord, source: boolean, rules: VoiceRules, exemplars: ReadonlyArray<{ slot: string; text: string }>): TextFinding[] {
  const out: TextFinding[] = [];
  const L = contract.limits;
  if (limit) out.push(...lengthFindings(text, limit, L.translationHeadroom, source));
  // The lexicon defines voice and brand rules; it is not checked against them.
  const governed = contract.layer !== "lexicon";
  if (governed) for (const b of rules.banned) if (phraseRe(b.phrase).test(text)) out.push({ check: "W-VOICE", severity: "error", message: `Banned phrase "${b.phrase}" (${b.source})` });
  if (governed) for (const rule of rules.patternRules) if (rule.re.test(text)) out.push({ check: "W-VOICE", severity: rule.severity, message: `Matches avoided pattern /${rule.re.source}/ (${rule.source})` });
  if (governed) for (const brand of rules.brands) for (const m of text.matchAll(brandRe(brand.name))) if (!brand.forms.includes(m[0])) out.push({ check: "W-BRAND", severity: "error", message: `"${m[0]}" should be spelled ${brand.forms.map(f => `"${f}"`).join(" or ")} (${brand.source})` });
  if (L.claims && r.claim === undefined && r.evidence === undefined) { const hits = claimHits(text); if (hits.length) out.push({ check: "W-CLAIM", severity: "error", message: `Claim-like ${hits.join(", ")} without a claim or evidence reference` }); }
  const copied = copiedExemplar(text, exemplars);
  if (copied) out.push({ check: "W-ORIG", severity: "error", message: `${copied.mode === "contains" ? "Contains" : `Is ${Math.round(copied.score * 100)}% similar to`} reference exemplar of ${copied.slot}: "${copied.exemplar}"` });
  return out;
}

export interface WriterSuiteInput { path: string; text: string }

/** Run the whole suite over Writer cell files, with an optional Director voice. */
export function runWriterSuite(input: { cells: WriterSuiteInput[]; director?: DirectorVoice }, contracts: WriterContracts = loadWriterContracts()): WriterSuiteResult {
  const byId = new Map(contracts.slots.map(s => [s.id, s]));
  const findings: WriterFinding[] = []; const located: Located[] = []; const index: Index = new Map();
  for (const file of input.cells) {
    let cell: WriterCell;
    try { cell = parseWriterCell(file.text, file.path); } catch (error) {
      findings.push({ check: "INPUT", severity: "error", slot: "?", path: file.path, message: error instanceof Error ? error.message : String(error) }); continue;
    }
    for (const item of cell.records) {
      located.push({ cell, path: file.path, item });
      if (typeof item.record.id === "string") index.set(indexKey(item.locale, item.record.id), item.record);
    }
  }
  const exemplars = exemplarTexts(contracts);
  const { banned, brands, patternRules } = voiceRules(located.map(({ item }) => item.record), input.director);
  const unique = new Map<string, Array<{ page: string; at: Located; slot: string }>>();
  for (const at of located) {
    const { cell, path, item } = at; const r = item.record;
    const slot = typeof r.leaf === "string" ? r.leaf : "?";
    const base = { slot, path, ...(typeof r.id === "string" ? { record: r.id } : {}), locale: item.locale };
    const contract = byId.get(slot);
    if (!contract) { findings.push({ ...base, check: "INPUT", severity: "error", message: `No Writer slot contract for leaf ${slot}` }); continue; }
    const source = item.locale === cell.locales[0];
    const { texts, present } = recordTexts(r, contract, item.locale, index);
    const L = contract.limits;
    // W-REQ
    for (const [key, limit] of Object.entries(L.fields)) if (limit.required && !present.has(key) && contract.layer !== "strings") findings.push({ ...base, key, check: "W-REQ", severity: "error", message: `Required ${contract.layer === "patterns" ? "part" : "field"} ${key} is missing` });
    if (contract.layer === "strings" && (typeof r.text !== "string" || !r.text.trim())) findings.push({ ...base, key: "text", check: "W-REQ", severity: "error", message: "String text is empty" });
    for (const prop of L.requiredProperties ?? []) {
      const v = r[prop];
      if (v === undefined || v === null || v === "") findings.push({ ...base, key: prop, check: "W-REQ", severity: "error", message: `Required property ${prop} is missing` });
    }
    if (L.recordKind && r.kind !== L.recordKind) findings.push({ ...base, check: "W-REQ", severity: "error", message: `Expected a ${L.recordKind} record, found ${String(r.kind)}` });
    if (L.countKey) {
      const v = r[L.countKey]; const n = Array.isArray(v) ? v.length : object(v) ? Object.keys(v).length : 0;
      if ((L.minCount !== undefined && n < L.minCount) || (L.maxCount !== undefined && n > L.maxCount)) findings.push({ ...base, key: L.countKey, check: "W-LEN", severity: "error", message: `${n} ${L.countKey}; expected ${L.minCount ?? 0} to ${L.maxCount ?? "any"}` });
    }
    for (const { key, text } of texts) {
      const at2 = { ...base, key };
      findings.push(...textFindings(text, L.fields[key], contract, r, source, { banned, brands, patternRules }, exemplars).map(f => ({ ...at2, ...f })));
      if (L.unique && source) {
        const norm = normalizeText(text);
        if (norm) { const page = String(r.context ?? cell.id).split(".")[0] || cell.id; const list = unique.get(norm) ?? []; list.push({ page, at, slot }); unique.set(norm, list); }
      }
    }
  }
  for (const list of unique.values()) {
    const pages = [...new Set(list.map(e => e.page))];
    if (pages.length < 2) continue;
    const first = list[0]!;
    for (const e of list) if (e.page !== first.page) findings.push({ check: "W-DUP", severity: "error", slot: e.slot, path: e.at.path, ...(typeof e.at.item.record.id === "string" ? { record: e.at.item.record.id } : {}), locale: e.at.item.locale, message: `Same text as ${String(first.at.item.record.id)} on page ${first.page}` });
  }
  return { suite: WRITER_CHECK_SUITE_ID, checks: WRITER_CHECKS, files: input.cells.map(f => f.path), records: located.length, findings };
}

/** Parse Director cell files for the voice inputs, skipping files that do not parse. */
export function directorVoiceFromFiles(files: WriterSuiteInput[]): { voice: DirectorVoice; issues: string[] } {
  const cells: Cell[] = []; const issues: string[] = [];
  for (const f of files) { const parsed = parseCell(f.text, f.path); if (parsed.ok) cells.push(parsed.value); else issues.push(`${f.path}: ${parsed.issues[0]?.message ?? "unreadable"}`); }
  return { voice: directorVoiceFromCells(cells), issues };
}

/** One pinned Writer slot candidate, already parsed by the Writer's own slot-body parser. */
export interface WriterPinnedSlot {
  /** The L3 slot id (`strings.page-titles`); it selects the slot contract. */
  slot: string;
  /** Where the candidate lives, for finding locations. */
  path: string;
  /** Candidate locales in order; the first is the source locale. */
  locales: readonly string[];
  rows: ReadonlyArray<{ locale: string; record: JsonRecord }>;
}
export interface WriterSlotSuiteResult extends WriterSuiteResult { slots: number }

/** The passage or pattern field a text row fills: the longest contract key its context ends with. */
function rowField(contract: WriterSlotContract, context: string): string | undefined {
  if (contract.layer === "strings") return "text";
  const keys = Object.keys(contract.limits.fields).filter(key => !key.includes("[]")).sort((a, b) => b.length - a.length);
  return keys.find(key => context === key || context.endsWith(`.${key}`));
}

/**
 * The same `writer.copy.v1` checks over PINNED slot candidates: one row per record, the
 * slot contract chosen by the candidate's slot id. Text rows get length, room, voice,
 * brand, claim, originality and duplicate checks; textless (JSON) rows get the record
 * kind, required-property and count checks. A slot with no contract is an INPUT error.
 * Field presence across a passage is a page-binding question, not a row check, and is
 * left to the Publisher copy binding.
 */
export function runWriterSlotSuite(input: { slots: readonly WriterPinnedSlot[]; director?: DirectorVoice }, contracts: WriterContracts = loadWriterContracts()): WriterSlotSuiteResult {
  const byId = new Map(contracts.slots.map(s => [s.id, s]));
  const findings: WriterFinding[] = [];
  const exemplars = exemplarTexts(contracts);
  const rules = voiceRules(input.slots.flatMap(slot => slot.rows.map(row => row.record)), input.director);
  const unique = new Map<string, Array<{ page: string; slot: string; path: string; record: string; locale: string }>>();
  let records = 0;
  for (const slot of input.slots) {
    const contract = byId.get(slot.slot);
    if (!contract) { findings.push({ check: "INPUT", severity: "error", slot: slot.slot, path: slot.path, message: `No Writer slot contract for slot ${slot.slot}` }); continue; }
    const L = contract.limits;
    for (const { locale, record: r } of slot.rows) {
      records++;
      const id = String(r.id);
      const base = { slot: slot.slot, path: slot.path, record: id, locale };
      const source = locale === slot.locales[0];
      if (typeof r.text === "string") {
        if (!r.text.trim()) { findings.push({ ...base, key: "text", check: "W-REQ", severity: "error", message: "String text is empty" }); continue; }
        const key = rowField(contract, String(r.context ?? ""));
        findings.push(...textFindings(r.text, key ? L.fields[key] : undefined, contract, r, source, rules, exemplars).map(f => ({ ...base, ...(key ? { key } : {}), ...f })));
        if (L.unique && source) {
          const norm = normalizeText(r.text);
          // A slot's `unique` limit is its own leaf rule: the same text in two different slots (a page
          // title and a component name, say) is not a repeat.
          if (norm) { const page = String(r.context ?? id).split(".")[0] || id; const key = `${slot.slot}\u0000${locale}\u0000${norm}`; const list = unique.get(key) ?? []; list.push({ page, slot: slot.slot, path: slot.path, record: id, locale }); unique.set(key, list); }
        }
        continue;
      }
      if (L.recordKind && r.kind !== L.recordKind) findings.push({ ...base, check: "W-REQ", severity: "error", message: `Expected a ${L.recordKind} record, found ${String(r.kind)}` });
      for (const prop of L.requiredProperties ?? []) {
        const v = r[prop];
        if (v === undefined || v === null || v === "") findings.push({ ...base, key: prop, check: "W-REQ", severity: "error", message: `Required property ${prop} is missing` });
      }
      if (L.countKey) {
        const v = r[L.countKey]; const n = Array.isArray(v) ? v.length : object(v) ? Object.keys(v).length : 0;
        if ((L.minCount !== undefined && n < L.minCount) || (L.maxCount !== undefined && n > L.maxCount)) findings.push({ ...base, key: L.countKey, check: "W-LEN", severity: "error", message: `${n} ${L.countKey}; expected ${L.minCount ?? 0} to ${L.maxCount ?? "any"}` });
      }
      const { texts } = recordTexts(r, contract, locale, new Map());
      for (const { key, text } of texts) findings.push(...textFindings(text, L.fields[key], contract, r, source, rules, exemplars).map(f => ({ ...base, key, ...f })));
    }
  }
  for (const list of unique.values()) {
    const pages = [...new Set(list.map(e => e.page))];
    if (pages.length < 2) continue;
    const first = list[0]!;
    for (const e of list) if (e.page !== first.page) findings.push({ check: "W-DUP", severity: "error", slot: e.slot, path: e.path, record: e.record, locale: e.locale, message: `Same text as ${first.record} on page ${first.page}` });
  }
  return { suite: WRITER_CHECK_SUITE_ID, checks: WRITER_CHECKS, files: input.slots.map(slot => slot.path), records, slots: input.slots.length, findings };
}
