/**
 * Measurable Voice shapes (writer.md 2 Voice; foundry-audit-0017) and the named-input rule (foundry-audit-0016).
 * Each Voice slot's value is a closed shape: an enum, a scale, a per-role number or a list. Categorical prose
 * ("Plain and conversational: ...") is not a value; it fails `voice.shape`. Word budgets per role derive from the
 * Designer character budgets (packages/designer/src/check/copy-fields-role.ts) at five characters a word, capped at
 * 40 words a sentence; a test pins both tables to the Designer's.
 */
import { readFileSync, readdirSync } from "node:fs";
import { loadCatalog } from "@clossys/director/catalog";
import type { GroupTree, WriterTreeFinding } from "./target.js";

export const VOICE_ROLES = ["eyebrow", "heading", "lead", "body", "action", "label", "alt"] as const;
export type VoiceRole = (typeof VOICE_ROLES)[number];
/** Designer ROLE_BUDGET (en, characters), mirrored. */
export const ROLE_CHAR_BUDGET: Readonly<Record<VoiceRole, number>> = { eyebrow: 48, heading: 60, lead: 200, body: 48000, action: 24, label: 160, alt: 140 };
export const MAX_SENTENCE_WORDS = 40;
export const ROLE_WORD_BUDGET: Readonly<Record<VoiceRole, number>> = Object.fromEntries(
  VOICE_ROLES.map(role => [role, Math.min(MAX_SENTENCE_WORDS, Math.floor(ROLE_CHAR_BUDGET[role] / 5))]),
) as Record<VoiceRole, number>;

export interface VoiceFinding { code: "voice.shape" | "voice.budget"; slot: string; message: string }
type Obj = Record<string, unknown>;
const isObj = (value: unknown): value is Obj => typeof value === "object" && value !== null && !Array.isArray(value);
const isInt = (value: unknown, min: number, max: number): value is number => Number.isInteger(value) && (value as number) >= min && (value as number) <= max;
const LOCALE = /^[a-z]{2,3}(?:-[A-Z][a-z]{3})?(?:-[A-Z]{2})?$/;

function shapeChecker(slot: string) {
  const findings: VoiceFinding[] = [];
  const fail = (message: string, code: VoiceFinding["code"] = "voice.shape") => { findings.push({ code, slot, message: `${slot}: ${message}` }); };
  const keys = (value: unknown, where: string, allowed: readonly string[], required: readonly string[] = allowed): value is Obj => {
    if (!isObj(value)) { fail(`${where} must be an object`); return false; }
    for (const key of Object.keys(value)) if (!allowed.includes(key)) fail(`${where} has unknown key ${key}`);
    for (const key of required) if (!(key in value)) fail(`${where} is missing ${key}`);
    return true;
  };
  const oneOf = (value: unknown, where: string, options: readonly string[]) => { if (typeof value !== "string" || !options.includes(value)) fail(`${where} must be one of ${options.join(", ")}`); };
  const perLocale = (value: unknown, where: string, each: (entry: unknown, at: string) => void) => {
    if (!isObj(value) || !Object.keys(value).length) { fail(`${where} must map at least one locale`); return; }
    for (const [locale, entry] of Object.entries(value)) {
      if (!LOCALE.test(locale)) fail(`${where} has invalid locale ${locale}`);
      each(entry, `${where}.${locale}`);
    }
  };
  const perRole = (value: unknown, where: string, each: (entry: unknown, at: string, role: VoiceRole) => void) => {
    if (!keys(value, where, VOICE_ROLES)) return;
    for (const role of VOICE_ROLES) if (role in value) each(value[role], `${where}.${role}`, role);
  };
  return { findings, fail, keys, oneOf, perLocale, perRole };
}

const SHAPES: Readonly<Record<string, (content: Obj, c: ReturnType<typeof shapeChecker>) => void>> = {
  "lexicon.formality": (content, c) => {
    if (!c.keys(content, "content", ["byLocale"])) return;
    c.perLocale(content.byLocale, "byLocale", (entry, at) => {
      if (!c.keys(entry, at, ["register", "address", "contractions"])) return;
      c.oneOf(entry.register, `${at}.register`, ["formal", "neutral", "casual"]);
      c.oneOf(entry.address, `${at}.address`, ["informal-you", "formal-you", "none"]);
      if (typeof entry.contractions !== "boolean") c.fail(`${at}.contractions must be a boolean`);
    });
  },
  "lexicon.warmth": (content, c) => {
    if (!c.keys(content, "content", ["level"])) return;
    if (!isInt(content.level, 1, 5)) c.fail("level must be an integer from 1 to 5");
  },
  "lexicon.energy": (content, c) => {
    if (!c.keys(content, "content", ["level", "maxExclamationsPer1k"])) return;
    if (!isInt(content.level, 1, 5)) c.fail("level must be an integer from 1 to 5");
    if (!isInt(content.maxExclamationsPer1k, 0, 50)) c.fail("maxExclamationsPer1k must be an integer from 0 to 50");
  },
  "lexicon.person": (content, c) => {
    if (!c.keys(content, "content", ["point"])) return;
    c.oneOf(content.point, "point", ["we-you", "you-only", "third"]);
  },
  "lexicon.mood": (content, c) => {
    if (!c.keys(content, "content", ["byRole"])) return;
    c.perRole(content.byRole, "byRole", (entry, at) => c.oneOf(entry, at, ["imperative", "declarative", "question"]));
  },
  "lexicon.sentence-length": (content, c) => {
    if (!c.keys(content, "content", ["byLocale"])) return;
    c.perLocale(content.byLocale, "byLocale", (entry, at) => {
      if (!c.keys(entry, at, ["byRole"])) return;
      c.perRole(entry.byRole, `${at}.byRole`, (limits, where, role) => {
        if (!c.keys(limits, where, ["max", "mean"])) return;
        const budget = ROLE_WORD_BUDGET[role];
        if (!isInt(limits.max, 1, MAX_SENTENCE_WORDS)) c.fail(`${where}.max must be an integer from 1 to ${MAX_SENTENCE_WORDS}`);
        else if (limits.max > budget) c.fail(`${where}.max ${limits.max} is over the ${role} role budget of ${budget} words`, "voice.budget");
        if (!isInt(limits.mean, 1, MAX_SENTENCE_WORDS) || (typeof limits.max === "number" && limits.mean > limits.max)) c.fail(`${where}.mean must be an integer no larger than max`);
      });
    });
  },
  "lexicon.reading-level": (content, c) => {
    if (!c.keys(content, "content", ["maxGrade", "formula"], ["maxGrade"])) return;
    c.perLocale(content.maxGrade, "maxGrade", (grade, at) => { if (!isInt(grade, 1, 18)) c.fail(`${at} must be a grade from 1 to 18`); });
    if ("formula" in content) c.perLocale(content.formula, "formula", (formula, at) => c.oneOf(formula, at, ["flesch-kincaid", "none"]));
  },
  "lexicon.capitalization": (content, c) => {
    if (!c.keys(content, "content", ["byRole", "exceptionsFrom"])) return;
    c.perRole(content.byRole, "byRole", (entry, at) => c.oneOf(entry, at, ["sentence", "title", "upper", "lower"]));
    if (content.exceptionsFrom !== "director/identity.naming.name#Casing") c.fail("exceptionsFrom must be director/identity.naming.name#Casing");
  },
  "lexicon.punctuation": (content, c) => {
    if (!c.keys(content, "content", ["byLocale"])) return;
    c.perLocale(content.byLocale, "byLocale", (entry, at) => {
      if (!c.keys(entry, at, ["serialComma", "quotes", "rangeDash", "terminalPeriod"])) return;
      if (typeof entry.serialComma !== "boolean") c.fail(`${at}.serialComma must be a boolean`);
      c.oneOf(entry.quotes, `${at}.quotes`, ["curly", "straight"]);
      c.oneOf(entry.rangeDash, `${at}.rangeDash`, ["en", "hyphen"]);
      c.perRole(entry.terminalPeriod, `${at}.terminalPeriod`, (flag, where) => { if (typeof flag !== "boolean") c.fail(`${where} must be a boolean`); });
    });
  },
  "lexicon.preferred-terms": (content, c) => {
    if (!c.keys(content, "content", ["terms"])) return;
    if (!Array.isArray(content.terms)) { c.fail("terms must be a list"); return; }
    content.terms.forEach((term, index) => {
      if (!c.keys(term, `terms[${index}]`, ["use", "avoid"])) return;
      if (typeof term.use !== "string" || !term.use.trim() || term.use.split(/\s+/).length > 4) c.fail(`terms[${index}].use must be a term of at most 4 words`);
      if (!Array.isArray(term.avoid) || !term.avoid.length || term.avoid.some(word => typeof word !== "string" || !word.trim())) c.fail(`terms[${index}].avoid must list at least one term`);
    });
  },
  "lexicon.avoid-terms": (content, c) => {
    if (!c.keys(content, "content", ["terms"])) return;
    if (!Array.isArray(content.terms) || content.terms.some(term => typeof term !== "string" || !term.trim() || term.split(/\s+/).length > 4)) c.fail("terms must be a list of terms of at most 4 words");
  },
  "lexicon.avoid-patterns": (content, c) => {
    if (!c.keys(content, "content", ["patterns"])) return;
    if (!Array.isArray(content.patterns)) { c.fail("patterns must be a list"); return; }
    content.patterns.forEach((pattern, index) => {
      if (!c.keys(pattern, `patterns[${index}]`, ["id", "regex", "flags"], ["id", "regex"])) return;
      if (typeof pattern.id !== "string" || !/^[a-z0-9-]+$/.test(pattern.id)) c.fail(`patterns[${index}].id must be a kebab id`);
      if ("flags" in pattern && (typeof pattern.flags !== "string" || !/^[imsu]*$/.test(pattern.flags))) c.fail(`patterns[${index}].flags may only use i, m, s and u`);
      try { new RegExp(String(pattern.regex), typeof pattern.flags === "string" ? pattern.flags : ""); }
      catch { c.fail(`patterns[${index}].regex is not a valid expression`); }
    });
  },
};

export const VOICE_SLOT_IDS = Object.keys(SHAPES);

/** Checks one Voice value against its slot's shape. */
export function checkVoiceContent(slot: string, content: unknown): VoiceFinding[] {
  const shape = SHAPES[slot];
  const checker = shapeChecker(slot);
  if (!shape) { checker.fail("is not a Voice slot"); return checker.findings; }
  if (isObj(content) && Object.values(content).some(value => typeof value === "string" && value.trim().split(/\s+/).length > 6)) {
    checker.fail("is categorical prose; a Voice value is a measurable shape (enum, scale, per-role number or list)");
  }
  if (!isObj(content)) { checker.fail("content must be an object"); return checker.findings; }
  shape(content, checker);
  return checker.findings;
}

export interface VoiceDefault { slot: string; name: string; version: number; candidate: { clossys: Record<string, unknown>; content: unknown } }

/** Package defaults at `defaults/<slot-id>/<name>-vN.json`; candidate files are never edited in place. */
export function loadVoiceDefaults(): VoiceDefault[] {
  const root = new URL("../../../defaults/", import.meta.url);
  const out: VoiceDefault[] = [];
  for (const slot of readdirSync(root).filter(name => name.startsWith("lexicon.")).sort()) {
    for (const name of readdirSync(new URL(`${slot}/`, root)).filter(file => file.endsWith(".json")).sort()) {
      const match = /-v(\d+)\.json$/.exec(name);
      if (!match) throw new Error(`Writer defaults: ${slot}/${name} has no version suffix`);
      out.push({ slot, name, version: Number(match[1]), candidate: JSON.parse(readFileSync(new URL(`${slot}/${name}`, root), "utf8")) });
    }
  }
  return out;
}

/**
 * Inputs rule (foundry-audit-0016): every Director input names a key the Director cell declares; Prose and Copy read
 * style only through the 12 Voice slots and never list identity.verbal.voice directly.
 */
export function checkWriterInputs(trees: readonly GroupTree[]): WriterTreeFinding[] {
  const findings: WriterTreeFinding[] = [];
  const cells = new Map(loadCatalog().cells.map(cell => [cell.id, new Set(cell.mustContain.map(entry => entry.key))]));
  const voiceIds = trees.find(tree => tree.group === "voice")?.slots.map(slot => slot.id) ?? [];
  for (const tree of trees) {
    for (const slot of tree.slots) {
      const fail = (message: string) => { findings.push({ code: "INPUTS", group: tree.group, message: `INPUTS: ${slot.id} ${message}` }); };
      for (const ref of slot.inputs ?? []) {
        if (ref.to.startsWith("director/")) {
          const cell = ref.to.slice("director/".length);
          const keys = cells.get(cell);
          if (!keys) fail(`reads unknown Director cell ${cell}`);
          else if (typeof ref.key !== "string") fail(`reads Director ${cell} with no key (a blanket input)`);
          else if (!keys.has(ref.key)) fail(`reads ${cell} key ${ref.key}, which the cell does not declare`);
          if (tree.group !== "voice" && cell === "identity.verbal.voice") fail("lists director/identity.verbal.voice directly; style goes through the Voice slots");
        } else if (ref.to.startsWith("writer/")) {
          if (tree.group === "voice") fail(`is a Voice slot and may not read ${ref.to}`);
          else if (!voiceIds.includes(ref.to.slice("writer/".length))) fail(`reads ${ref.to}, which is not a Voice slot`);
        } else fail(`has an input with an unknown agent: ${ref.to}`);
      }
      if (tree.group !== "voice") {
        const read = new Set((slot.inputs ?? []).map(ref => ref.to));
        for (const id of voiceIds) if (!read.has(`writer/${id}`)) fail(`does not read Voice slot ${id}`);
      }
    }
  }
  return findings;
}
