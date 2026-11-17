/**
 * CANDIDATE-OPTIONS check: a slot classed for choice (options = N) holds at least
 * N candidates that differ on its `varyOn` axis, so the owner (or a judge seat)
 * reacts to real alternatives rather than one option.
 *
 * Reads slots only through records/slots.ts. Each candidate tags its variation as
 * `vary: {"<axis>": "<value>"}` (frontmatter, or `meta.vary` in JSON). A candidate
 * with no tag counts once, as the slot's baseline (the pre-options candidate whose
 * bytes a pin already hashes), so tagging never forces a repin.
 *
 * A slot whose slot.json carries `family` (clossys.slot/2, foundry-build-0048 U3) is judged by it: the family is the
 * slot's own data and the option table only seeds it (`clossys migrate contracts`). A family the table's class for
 * the slot disagrees with is `options-drift`, so a reseed is visible; a slot with no family falls back to the table.
 */
import { parseFrontmatter } from "./slot-model/frontmatter.js";
import { OPTION_TABLE, type OptionClass, type OptionTable } from "./slot-model/option-classes.js";
import { validVary } from "./slot-model/validate.js";
import { inspectSlot, listSlots, readCandidate, type SlotEntry } from "./slots.js";
import { SLOT_AGENTS, pinStatus, type PinStatus, type SlotAgent, type SlotDoc } from "./slot-model/types.js";

export type SlotOptionsCode = "options-unclassified" | "options-unknown-class" | "options-drift" | "options-vary-invalid" | "options-vary-duplicate" | "options-short";
export interface SlotOptionsFinding { readonly code: SlotOptionsCode; readonly agent: SlotAgent; readonly slot: string; readonly message: string }

export interface OptionCandidate {
  readonly name: string;
  /** The candidate's variation value on the slot's axis; null = untagged baseline. */
  readonly vary: { readonly axis: string; readonly value: string } | null;
  readonly pinned: boolean;
}
export interface SlotOptions {
  readonly agent: SlotAgent;
  readonly slot: string;
  readonly group: string;
  readonly classId: string | null;
  readonly options: number;
  readonly varyOn: string | null;
  readonly values: readonly string[];
  readonly candidates: readonly OptionCandidate[];
  /** Distinct options held: distinct tagged values plus one untagged baseline. */
  readonly distinct: number;
  /** Axis values not yet offered by any candidate. */
  readonly missing: readonly string[];
  /** Pin status as Studio shows it (slot-model pinStatus): pinned (owner pick), confirm (bulk, planner or agent basis), or none. */
  readonly pinStatus: PinStatus | "none";
}

/** The class an agent's slot falls in: slot override first, then its `<l1>/<l2>` group. Null = agent not mapped. */
export function classify(agent: SlotAgent, slot: string, group: string, table: OptionTable = OPTION_TABLE): { classId: string | undefined } | null {
  const groups = table.groups[agent];
  if (!groups) return null;
  return { classId: table.overrides[agent]?.[slot]?.class ?? groups[group] };
}

/** A candidate's `vary` tag, null when it carries none, `invalid` when the tag or the bytes are malformed. */
export function candidateVary(name: string, bytes: string): Record<string, string> | null | "invalid" {
  let raw: unknown;
  if (name.endsWith(".md")) {
    const parsed = parseFrontmatter(bytes);
    if (!parsed.ok) return null;
    raw = parsed.value.fields.vary;
  } else {
    // Unparseable bytes cannot prove the slot's options: the options check reports them.
    try { raw = (JSON.parse(bytes) as { meta?: { vary?: unknown } }).meta?.vary; } catch { return "invalid"; }
  }
  if (raw === undefined) return null;
  return validVary(raw) ? raw : "invalid";
}

function groupOf(entry: SlotEntry): string { return `${entry.position.l1}/${entry.position.l2}`; }

/** The slot's own family as an option class (`family.class` names the class it was seeded from), when it carries one. */
export function familyClass(doc: Pick<SlotDoc, "family">): OptionClass | undefined {
  const family = doc.family;
  if (!family) return undefined;
  return {
    id: family.class ?? `family.${family.options}`, options: family.options,
    ...(family.options > 1 && family.varyOn ? { varyOn: family.varyOn, values: [...family.values] } : {}),
    summary: "the slot's family (slot.json)",
  };
}
const sameClass = (a: OptionClass, b: OptionClass) => a.options === b.options && (a.varyOn ?? null) === (b.varyOn ?? null)
  && JSON.stringify(a.values ?? []) === JSON.stringify(b.values ?? []);

/**
 * One slot's options view (what `clossys options` prints and the check judges). `only` judges a subset of the
 * slot's candidates (loop.create's exit: the submitted, certified ones), counted by the same rules.
 */
export function slotOptions(consumer: string, entry: SlotEntry, table: OptionTable = OPTION_TABLE, only?: ReadonlySet<string>): SlotOptions {
  const group = groupOf(entry);
  const doc = inspectSlot(consumer, entry.agent, entry.id).doc as SlotDoc;
  const klass: OptionClass | undefined = familyClass(doc) ?? (() => { const c = classify(entry.agent, entry.id, group, table)?.classId; return c ? table.classes[c] : undefined; })();
  const options = klass?.options ?? doc.options ?? 1;
  const varyOn = klass?.varyOn ?? doc.varyOn ?? null;
  const candidates = entry.candidates.filter(name => !only || only.has(name)).map(name => {
    const tag = candidateVary(name, readCandidate(consumer, entry.agent, entry.id, name).bytes);
    const pair = tag && tag !== "invalid" ? Object.entries(tag)[0]! : null;
    return { name, vary: pair ? { axis: pair[0], value: pair[1] } : null, pinned: entry.pin?.candidate === name };
  });
  const values = klass?.values ?? [];
  // Only allowed values on the slot's axis count; foreign axes and unlisted values are findings, not options.
  const tagged = new Set(candidates.filter(c => c.vary && c.vary.axis === varyOn && (!klass?.values || values.includes(c.vary.value))).map(c => c.vary!.value));
  const baseline = candidates.some(c => !c.vary) ? 1 : 0;
  return {
    agent: entry.agent, slot: entry.id, group, classId: klass?.id ?? null, options, varyOn, values, candidates,
    distinct: tagged.size + baseline, missing: values.filter(v => !tagged.has(v)), pinStatus: entry.pin ? pinStatus(entry.pin.basis) : "none",
  };
}

/**
 * One slot judged by the CANDIDATE-OPTIONS rules: its view and findings, or undefined for a slot the check skips
 * (an unmapped agent's slot with no family). check:slot-options runs it over every slot; loop.create's exit
 * (candidates.certified) runs it with `only` = the submitted, certified candidates, so the two never drift.
 */
export function judgeSlotOptions(consumer: string, entry: SlotEntry, table: OptionTable = OPTION_TABLE, only?: ReadonlySet<string>): { view?: SlotOptions; findings: SlotOptionsFinding[] } | undefined {
  const agent = entry.agent;
  const findings: SlotOptionsFinding[] = [];
  const add = (code: SlotOptionsCode, message: string) => findings.push({ code, agent, slot: entry.id, message });
  const group = groupOf(entry);
  const doc = inspectSlot(consumer, agent, entry.id).doc as SlotDoc;
  const own = familyClass(doc);
  if (!own && !table.groups[agent]) return undefined;
  const classId = classify(agent, entry.id, group, table)?.classId;
  const seeded = classId ? table.classes[classId] : undefined;
  let klass: OptionClass;
  if (own) {
    klass = own;
    const tableSays = classify(agent, entry.id, group, table) === null ? familyClass({ family: { options: 1, varyOn: null, values: [] } })! : seeded;
    if (tableSays && !sameClass(own, tableSays)) {
      add("options-drift", `slot.json family ${own.options}${own.varyOn ? `/${own.varyOn}` : ""} != class ${tableSays.id} ${tableSays.options}${tableSays.varyOn ? `/${tableSays.varyOn}` : ""}; run clossys migrate contracts`);
    }
  } else {
    if (!classId) { add("options-unclassified", `L2 group ${group} has no option class`); return { findings }; }
    if (!seeded) { add("options-unknown-class", `class ${classId} is not defined`); return { findings }; }
    klass = seeded;
    const stored = doc.options ?? 1;
    if (stored !== klass.options || (doc.varyOn ?? undefined) !== klass.varyOn) {
      add("options-drift", `slot.json options ${stored}${doc.varyOn ? `/${doc.varyOn}` : ""} != class ${klass.id} ${klass.options}${klass.varyOn ? `/${klass.varyOn}` : ""}; run clossys options --classes`);
    }
  }
  const view = slotOptions(consumer, entry, table, only);
  if (klass.options <= 1) return { view, findings };
  const seen = new Map<string, string>();
  for (const candidate of view.candidates) {
    const tag = candidateVary(candidate.name, readCandidate(consumer, agent, entry.id, candidate.name).bytes);
    if (tag === "invalid") { add("options-vary-invalid", `${candidate.name}: vary must be {"${klass.varyOn}": "<value>"}`); continue; }
    if (!candidate.vary) continue;
    if (candidate.vary.axis !== klass.varyOn) { add("options-vary-invalid", `${candidate.name}: varies on ${candidate.vary.axis}, slot varies on ${klass.varyOn}`); continue; }
    if (!klass.values?.includes(candidate.vary.value)) { add("options-vary-invalid", `${candidate.name}: ${klass.varyOn} ${candidate.vary.value} is not one of ${klass.values?.join(", ")}`); continue; }
    const prior = seen.get(candidate.vary.value);
    if (prior) add("options-vary-duplicate", `${candidate.name} and ${prior} both offer ${klass.varyOn} ${candidate.vary.value}`);
    else seen.set(candidate.vary.value, candidate.name);
  }
  if (view.distinct < klass.options) add("options-short", `holds ${view.distinct} distinct option(s) on ${klass.varyOn}, needs ${klass.options}; run clossys options ${agent}/${entry.id} --more`);
  return { view, findings };
}

/** Every slot that carries a family, and every mapped agent's slots, with findings; other slots of unmapped agents are skipped. */
export function checkSlotOptions(consumer: string, table: OptionTable = OPTION_TABLE): { findings: SlotOptionsFinding[]; slots: SlotOptions[] } {
  const findings: SlotOptionsFinding[] = [];
  const slots: SlotOptions[] = [];
  for (const agent of SLOT_AGENTS) {
    for (const entry of listSlots(consumer, agent)) {
      const judged = judgeSlotOptions(consumer, entry, table);
      if (!judged) continue;
      findings.push(...judged.findings);
      if (judged.view) slots.push(judged.view);
    }
  }
  return { findings, slots };
}

/** Counts per class for the report. */
export function classCounts(slots: readonly SlotOptions[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const slot of slots) if (slot.classId) counts[slot.classId] = (counts[slot.classId] ?? 0) + 1;
  return counts;
}
