#!/usr/bin/env node
/**
 * stage-check (Director): the maker's own check of a craft stage's output, run before the stage is
 * recorded (slot-constitution.md section 5b; foundry-feedback-0015, -0018). Every recipe under
 * packages/director/recipes/ calls it.
 *
 *   clossys recipe check <recipe-id> brief   <slot> <brief.json>      [--root <dir>]
 *   clossys recipe check <recipe-id> diverge <slot> <directions.json> [--root <dir>]
 *   clossys recipe check <recipe-id> draft   <slot> <draft.md>        [--root <dir>]
 *
 * brief and diverge: the shared rules of stage-core.mjs, plus: a brief derives from Director pins
 * and recorded findings only, so every input and every direction's traits are Director slots or
 * finding:<id> (never another agent, a URL or a file).
 * draft: the brief candidate meets the mechanical requirements its standard names (the 3S-ND
 * worklist classes): three sections in order, every contract key answered once, a derived source of
 * pinned Director slots and recorded findings, each cited by a Because line, Watch lines of the form
 * "If <metric> <comparator> <number> <window>, then <action>." (a time window always), plain Direction
 * within the standard's word and sentence limits, quantities for a measure, a boundary for a profile.
 *
 * Mechanical only: it reads files, never the clock, the network or randomness, and runs no model.
 * Exit 0 clean, 1 with one line per issue (rule id, the issue, the fix), 2 on a usage error.
 * Nothing under the judge (src/constitution, certifiers, guards) imports this file (R16.1).
 */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { FINDING_REF, SLOT_ID, checkBriefWith, checkDivergeWith, checkDraftWith, excerpt, findingOf, frontmatter, isRecord, issue, jsonField, pinOf, runStageCli, sentences, strings, words } from "./stage-core.mjs";
export { STAGES } from "./stage-core.mjs";

const AGENT = "director";

/** A ref a brief may derive from: a pinned Director slot (bare or director:) or a recorded finding. */
function refIssue(root, ref) {
  if (FINDING_REF.test(ref)) return findingOf(root, ref) ? undefined : issue("R06.7", `${ref} is not a recorded finding`, "record outside evidence with clossys evidence and cite finding:<id>");
  const bare = ref.startsWith("director:") ? ref.slice("director:".length) : ref;
  if (!SLOT_ID.test(bare)) return issue("R06.7", `${JSON.stringify(ref)} is not a Director slot or a finding`, "cite a Director slot id or finding:<id>; never a URL, a file or an owner note");
  const pin = pinOf(root, bare);
  if (!pin) return issue("R07", `${bare} is not pinned`, `pin ${bare} first; a brief derives from pinned Director slots`);
  if (pin.agent !== AGENT) return issue("R20", `${bare} is a ${pin.agent} slot`, "a brief derives from Director slots and findings only");
  return undefined;
}

const HOOKS = {
  brief(root, world, brief, out, inputs) {
    if (!inputs.length) out.push(issue("R20", "the brief lists no input", "list the pinned Director slots and recorded findings the brief derives from ({slot, candidate, sha256} or {finding, sha256})"));
    for (const item of inputs) if (typeof item.slot === "string") {
      const pin = pinOf(root, item.slot);
      if (pin && pin.agent !== AGENT) out.push(issue("R20", `input ${item.slot} is a ${pin.agent} slot`, "a brief derives from Director slots and findings only"));
    }
  },
  direction(root, world, direction, at, out, traits) {
    if (!traits.length) out.push(issue("R20", `${at} cites no Director slot or finding`, "name the pinned Director slots or finding:<id> this direction derives from"));
    for (const id of traits) if (typeof id === "string" && !FINDING_REF.test(id)) {
      const pin = pinOf(root, id);
      if (pin && pin.agent !== AGENT) out.push(issue("R20", `${at} cites ${id}, a ${pin.agent} slot`, "derive from Director slots and findings only"));
    }
  },
};

export const checkBrief = (root, slot, brief) => checkBriefWith(root, AGENT, slot, brief, HOOKS);
export const checkDiverge = (root, slot, file) => checkDivergeWith(root, AGENT, slot, file, HOOKS);

// ---- draft: the brief candidate's shape ---------------------------------------------------------

const ORDER = ["Direction", "Because", "Watch"];

/** The `## ` sections of a brief body: their `- ` lines and any other non-empty lines (stray). */
export function briefSections(text) {
  const out = [];
  let current;
  const preamble = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const heading = /^##\s+(.+?)\s*$/.exec(line);
    if (heading && !line.startsWith("###")) { out.push(current = { heading: heading[1], lines: [], stray: [] }); continue; }
    if (!line) continue;
    const bullet = /^-\s+(.+)$/.exec(line);
    if (!current) preamble.push(line);
    else if (bullet) current.lines.push(bullet[1].trim());
    else current.stray.push(line);
  }
  if (preamble.length) out.unshift({ heading: "", lines: [], stray: preamble });
  return out;
}
const sectionLines = (text, heading) => briefSections(text).find(section => section.heading === heading)?.lines ?? [];
const keyed = line => { const match = /^([A-Z][A-Za-z-]*(?: [a-z][a-z-]*){0,3}):\s+(.+)$/.exec(line); return match ? { key: match[1], value: match[2].trim() } : undefined; };
const lineValue = line => keyed(line)?.value ?? line;

/** The draft's source refs, or the reason they cannot be read. */
function sourceOf(draft) {
  const { fields } = frontmatter(draft.text);
  const read = jsonField(fields, "source");
  if (read.error) return read.error;
  if (!isRecord(read.value)) return "the frontmatter source is not an object";
  return { kind: read.value.kind, ref: strings(read.value.ref) };
}
const body = draft => frontmatter(draft.text).body;
const cited = line => { const match = /\(([^()]+)\)\.?$/.exec(line.trim()); return match ? match[1].split(/[;,]\s*/).map(item => item.trim()).filter(Boolean) : undefined; };

const COMPARATOR = /(?:[<>]=?|[≤≥]|=|\b(?:reach(?:es)?|exceeds?|(?:falls?|drops?) (?:below|under)|rises? (?:above|over)|(?:is |stays )?(?:above|below|over|under)|at (?:least|most))\s)\s*[-+]?\d/;
const WINDOW = /\b(?:by \d{4}-\d{2}(?:-\d{2})?|(?:in|within|per|each|every|any|over) (?:any |a |the |one |\d+ )?(?:day|week|month|quarter|year|release|run|rebuild|review)s?)\b/i;
const WATCH_FORM = "If <metric> <comparator> <number> <window>, then <action>.";
const INTERNAL = [
  { re: /\b(?:finding|evidence|director|designer|writer|publisher|producer):[a-z0-9]/i, what: "a record reference" },
  { re: /(?<![\w@/.-])[a-z][a-z0-9-]*\.[a-z0-9-]+\.[a-z0-9-]+(?![\w-])/, what: "a slot id" },
  { re: /`/, what: "code markup" },
  { re: /(?:^|\s)(?:packages|clossys|src)\/\S+/, what: "a file path" },
  { re: /\b(?:TODO|TBD|FIXME|lorem ipsum)\b|\?\?\?|\{\{/i, what: "a placeholder" },
];
const QUANTITY = /\d|\b(?:zero|none|free)\b/i;
const BOUNDARY = /\b(?:not|never|no|avoid|without|rather than|instead of|in place of|only)\b/i;
const num = (value, fallback) => typeof value === "number" && Number.isFinite(value) ? value : fallback;

/** The draft checks by requirement id: the maker's preflight of what each requirement asks. */
export const DRAFT_CHECKS = Object.freeze({
  "brief.sections": draft => {
    const found = briefSections(body(draft));
    const out = [];
    const headings = found.map(section => section.heading).filter(Boolean);
    if (headings.join("|") !== ORDER.join("|")) out.push({ what: `sections are ${headings.length ? headings.map(item => `"## ${item}"`).join(", ") : "none"}`, fix: 'write "## Direction", "## Because" and "## Watch", in that order' });
    for (const section of found) {
      if (section.heading && !section.lines.length) out.push({ what: `"## ${section.heading}" has no "- " line`, fix: "give every section at least one - line" });
      for (const line of section.stray) out.push({ what: `loose text "${excerpt(line)}"`, fix: 'make every line a "- " item' });
    }
    return out;
  },
  "brief.keys": (draft, params) => {
    const contract = isRecord(params.contract) ? params.contract : {};
    const wanted = strings(params.keys).length ? strings(params.keys) : (Array.isArray(contract.mustContain) ? contract.mustContain.filter(isRecord).map(item => item.key).filter(key => typeof key === "string") : []);
    if (!wanted.length) return [{ what: "the contract names no mustContain keys", fix: "fix the slot contract before crafting" }];
    const lines = sectionLines(body(draft), "Direction");
    const out = [];
    for (const key of wanted) {
      const hits = lines.filter(line => line.startsWith(`${key}:`));
      if (!hits.length) out.push({ what: `Direction has no "- ${key}: ..." line`, fix: `answer the contract key ${key} once` });
      else if (hits.length > 1) out.push({ what: `Direction answers "${key}" ${hits.length} times`, fix: "answer it once" });
      else if (!words(hits[0].slice(key.length + 1)).length) out.push({ what: `Direction "${key}" has no value`, fix: "give it a value" });
    }
    return out;
  },
  "brief.derived-upstream": (draft, params, world, root) => {
    const source = sourceOf(draft);
    if (typeof source === "string") return [{ what: source, fix: 'write source: {"kind": "derived", "ref": [<Director slot ids and finding:<id>>]}' }];
    const out = [];
    if (source.kind !== "derived") out.push({ what: `source kind is ${JSON.stringify(source.kind)}`, fix: 'set "kind": "derived"; a brief derives from Director pins and findings' });
    if (!source.ref.length) out.push({ what: "source cites nothing", fix: "cite the Director slots and findings the brief derives from" });
    for (const ref of source.ref) { const found = refIssue(root, ref); if (found) out.push({ what: `source ref ${found.what}`, fix: found.fix }); }
    return out;
  },
  "brief.because-cited": draft => {
    const source = sourceOf(draft);
    if (typeof source === "string") return [{ what: source, fix: "write the frontmatter source first" }];
    const refs = new Set(source.ref), used = new Set(), out = [];
    for (const line of sectionLines(body(draft), "Because")) {
      const list = cited(line);
      if (!list) { out.push({ what: `Because line "${excerpt(line)}" cites no source`, fix: "end it with (<ref>), a ref of the source" }); continue; }
      for (const ref of list) { if (refs.has(ref)) used.add(ref); else out.push({ what: `Because line cites "${ref}", which the source does not list`, fix: "add it to source.ref or cite a listed ref" }); }
    }
    for (const ref of refs) if (!used.has(ref)) out.push({ what: `source ref "${ref}" backs no Because line`, fix: `write a Because line ending (${ref}), or drop the ref` });
    return out;
  },
  "brief.watch-trigger": draft => {
    const out = [];
    for (const line of sectionLines(body(draft), "Watch")) {
      const at = `Watch line "${excerpt(line)}"`;
      const match = /^If\s+(.+?),\s+then\s+(.+)$/.exec(line);
      if (!match) { out.push({ what: `${at} is not "${WATCH_FORM}"`, fix: `rewrite it as "${WATCH_FORM}"` }); continue; }
      if (!COMPARATOR.test(match[1])) out.push({ what: `${at} has no numeric threshold`, fix: "state a comparator and a number (>, <, >=, <=, = or reaches, exceeds, falls below ... a number)" });
      if (!WINDOW.test(match[1])) out.push({ what: `${at} has no time window`, fix: "add a window before the comma: by <YYYY-MM-DD>, or in any month, per quarter, within one release ..." });
      if (!/[.!]$/.test(match[2].trim()) || words(match[2]).length < 2) out.push({ what: `${at} has no action sentence after "then"`, fix: "end with the action, as a sentence" });
    }
    return out;
  },
  "brief.plain-direction": draft => {
    const out = [];
    for (const line of sectionLines(body(draft), "Direction")) for (const item of INTERNAL) if (item.re.test(line)) out.push({ what: `Direction line "${excerpt(line)}" holds ${item.what}`, fix: "write Direction in plain language; evidence and refs go in Because" });
    return out;
  },
  "brief.direction-values": (draft, params) => {
    const maxWords = num(params.maxWords, Number.NaN);
    if (!Number.isFinite(maxWords)) return [{ what: "the standard gives no maxWords", fix: "fix the standard before crafting" }];
    const maxSentences = num(params.maxSentences, 1);
    const out = [];
    for (const line of sectionLines(body(draft), "Direction")) {
      const value = lineValue(line), count = words(value).length, said = sentences(value).length;
      if (count > maxWords) out.push({ what: `Direction "${excerpt(line, 40)}" has ${count} words; at most ${maxWords}`, fix: "cut the value; move evidence to Because" });
      if (said > maxSentences) out.push({ what: `Direction "${excerpt(line, 40)}" has ${said} sentences; at most ${maxSentences}`, fix: "say it in fewer sentences" });
    }
    return out;
  },
  "brief.quantified": (draft, params) => {
    const min = num(params.min, 2);
    const count = sectionLines(body(draft), "Direction").filter(line => keyed(line)).map(lineValue).filter(value => QUANTITY.test(value)).length;
    return count < min ? [{ what: `Direction states ${count} quantities; a measure brief states at least ${min}`, fix: "give values a number, a date, or an explicit zero, none or free" }] : [];
  },
  "brief.boundary": draft => {
    const has = sectionLines(body(draft), "Direction").some(line => /^(?:Not|Never|Avoid)(?:[- ][A-Za-z-]+)*:/.test(line) || BOUNDARY.test(lineValue(line)));
    return has ? [] : [{ what: "Direction draws no boundary", fix: "say who or what it is not: a Not, Never or Avoid line, or an exclusion (not, rather than, only ...)" }];
  },
});

/** Maker-only: the frontmatter names this slot. */
function draftExtra(root, world, draft) {
  const { fields } = frontmatter(draft.text);
  if (!fields) return [issue("R15.3", "the draft has no frontmatter", "open with --- slot, source, feeds, functions, note ---")];
  return fields.slot === world.slot ? [] : [issue("R15.3", `the draft frontmatter slot is ${JSON.stringify(fields.slot)}`, `set slot: "${world.slot}"`)];
}

export const checkDraft = (root, slot, draft) => checkDraftWith(root, AGENT, slot, draft, DRAFT_CHECKS, draftExtra);

export const main = (argv, cwd = process.cwd()) => runStageCli(AGENT, { brief: checkBrief, diverge: checkDiverge, draft: checkDraft }, argv, cwd);

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = main(process.argv.slice(2));
  (result.code === 0 ? process.stdout : process.stderr).write(result.text);
  process.exitCode = result.code;
}
