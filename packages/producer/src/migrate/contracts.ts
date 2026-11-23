/**
 * `clossys migrate contracts` (foundry-build-0048 U3, the CREATE and CHOOSE contract): seeds every live
 * slot/2 slot.json of Director, Designer, Writer and Publisher with the slot data CREATE and CHOOSE read, from
 * package data only, never by hand:
 * - `family {options, varyOn, values, class}`: the slot's option class from the committed option table
 *   (records/slot-model/option-classes.ts, classify by the slot's `<l1>/<l2>` group). An agent the table
 *   maps nothing for (Designer, Publisher) offers one candidate. A Director or Writer slot whose group the table does
 *   not class gets no family and is named (an unclassified slot is the table's gap, not a guess).
 * - `contract.requirements [{check}]`: every requirement check of the slot's standard (the params stay in
 *   the standard; certify merges them by check id, records/standards resolveRequirements).
 * - `contract.fixture`, only when the contract's own data determines it: a Writer copy contract's
 *   `{keys: <required copy field keys>, locales: [<sourceLocale>]}`. A fixture the contract does not
 *   determine (a mounted Designer element, a Voice or Prose rule) is named, never invented.
 * Each rewrite is one ledgered `slot` event (verb migrate); a second run changes nothing.
 */
import type { Slot, SlotFamily } from "../records/types.js";
import { listSlots, readSlotRecordText } from "../records/slots.js";
import { OPTION_TABLE, type OptionTable } from "../records/slot-model/option-classes.js";
import { classify } from "../records/slot-options.js";
import { readStandard, type StandardDoc } from "../records/standards.js";
import { writeSlotSeed } from "../records/slot-write.js";
import type { SlotAgent } from "../records/slot-model/index.js";
import { existsSync, readFileSync } from "node:fs";
import { packagePath } from "../package-path.js";

/** The Publisher package records by slot id (the three tree files' `slots`), read once per plan. */
function publisherRecords(root: string): Map<string, Record<string, unknown>> {
  const out = new Map<string, Record<string, unknown>>();
  for (const name of ["composition", "directory", "release"]) {
    const file = packagePath(root, `packages/publisher/src/catalog/ia/${name}.json`);
    if (!existsSync(file)) continue;
    const doc = JSON.parse(readFileSync(file, "utf8")) as { slots?: Record<string, unknown> };
    for (const [id, record] of Object.entries(doc.slots ?? {})) if (object(record)) out.set(id, record);
  }
  return out;
}
/** A Publisher slot's family from its package record, `null` when the record holds none. */
function publisherFamily(records: Map<string, Record<string, unknown>>, id: string): SlotFamily | null {
  const family = records.get(id)?.family;
  return object(family) ? family as unknown as SlotFamily : null;
}

export const CONTRACT_AGENTS: readonly SlotAgent[] = ["director", "designer", "writer"];
/**
 * The agents `clossys migrate contracts` seeds: the contract agents and the Publisher, whose workspace IA `ia sync`
 * never refreshes. A Publisher slot's family is its package record's own `family` (packages/publisher/src/catalog/ia):
 * Publisher assembles only, so each record offers one assembly (`{options: 1, varyOn: null, values: []}`). A slot
 * whose package record holds no family gets none and is named.
 */
export const SEEDED_AGENTS: readonly SlotAgent[] = [...CONTRACT_AGENTS, "publisher"];
export const CONTRACTS_MIGRATION = "contracts";

export interface ContractSeed {
  readonly agent: SlotAgent;
  readonly slot: string;
  readonly family?: SlotFamily;
  readonly requirements?: readonly { check: string }[];
  readonly fixture?: Readonly<Record<string, unknown>>;
  /** What this run would change: the fields whose stored value differs. */
  readonly changes: readonly ("family" | "requirements" | "fixture")[];
}
export interface ContractsPlan {
  readonly seeds: readonly ContractSeed[];
  /** Slot data the package does not determine, named per slot. */
  readonly gaps: readonly { agent: SlotAgent; slot: string; field: "family" | "requirements" | "fixture"; reason: string }[];
}

const object = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** The family a slot's option class gives it, `null` when the table maps the agent but not the slot's group. */
export function familyFor(agent: SlotAgent, id: string, group: string, table: OptionTable = OPTION_TABLE): SlotFamily | null {
  const classed = classify(agent, id, group, table);
  if (classed === null) return { options: 1, varyOn: null, values: [] };
  const klass = classed.classId ? table.classes[classed.classId] : undefined;
  if (!klass) return null;
  return { options: klass.options, varyOn: klass.options > 1 ? klass.varyOn ?? null : null, values: klass.options > 1 ? [...(klass.values ?? [])] : [], class: klass.id };
}

/** The fixture a Writer copy contract determines: its required copy keys (else every key) in its source locale. */
export function copyFixture(contract: Readonly<Record<string, unknown>>): { keys: string[]; locales: string[] } | undefined {
  const copy = contract.copy;
  if (!object(copy) || typeof copy.sourceLocale !== "string" || !Array.isArray(copy.fields)) return undefined;
  const fields = copy.fields.filter(object).filter(field => typeof field.key === "string" && field.key.length > 0);
  const required = fields.filter(field => field.required === true);
  const keys = (required.length ? required : fields).map(field => field.key as string);
  return keys.length ? { keys, locales: [copy.sourceLocale] } : undefined;
}

/**
 * One contract with the CREATE and CHOOSE seed applied, from package data only: the contract's own
 * requirements, then every requirement check of the slot's standard it does not list yet; and, when the
 * contract declares no fixture, the copy fixture a Writer contract determines. `clossys migrate contracts`
 * writes it, and `clossys ia sync` compares and writes a slot/2 contract against the package contract
 * seeded so (a sync never strips the seed, and a hand edit of it is still drift).
 */
export function seededContract(agent: string, contract: Readonly<Record<string, unknown>>, standard: StandardDoc | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = { ...contract };
  if (standard) {
    const have = Array.isArray(contract.requirements) ? contract.requirements.filter(object) : [];
    const ids = new Set(have.map(item => item.check));
    const requirements = [...have as { check: string }[], ...standard.requirements.filter(item => !ids.has(item.check)).map(item => ({ check: item.check }))];
    if (requirements.length) out.requirements = requirements;
  }
  if (contract.fixture === undefined && agent === "writer") {
    const fixture = copyFixture(contract);
    if (fixture) out.fixture = fixture;
  }
  return out;
}

/** Plans the seed of every live slot/2 slot of the contract agents. `root` resolves the packages (standards). */
export function planContracts(consumer: string, root: string, table: OptionTable = OPTION_TABLE): ContractsPlan {
  const seeds: ContractSeed[] = [];
  const gaps: ContractsPlan["gaps"][number][] = [];
  let records: Map<string, Record<string, unknown>> | undefined;
  for (const agent of SEEDED_AGENTS) {
    for (const entry of listSlots(consumer, agent)) {
      const text = readSlotRecordText(entry.dir, "slot.json");
      if (text === undefined) continue;
      const doc = JSON.parse(text) as Record<string, unknown>;
      if (doc.schema !== "clossys.slot/2" || doc.base !== null) continue;
      const contract = object(doc.contract) ? doc.contract : {};
      const gap = (field: "family" | "requirements" | "fixture", reason: string) => gaps.push({ agent, slot: entry.id, field, reason });
      const changes: ContractSeed["changes"][number][] = [];
      const family = agent === "publisher" ? publisherFamily(records ??= publisherRecords(root), entry.id) : familyFor(agent, entry.id, `${entry.position.l1}/${entry.position.l2}`, table);
      if (family === null) gap("family", agent === "publisher" ? `the Publisher package record of ${entry.id} holds no family` : `the option table classes no ${entry.position.l1}/${entry.position.l2} group`);
      else if (!same(doc.family, family)) changes.push("family");
      const standardId = typeof doc.standard === "string" ? doc.standard : undefined;
      const standard = standardId ? readStandard(root, agent, standardId) : undefined;
      if (!standard?.doc) gap("requirements", `standard ${standardId ?? "(none)"} is missing or not valid`);
      const seeded = seededContract(agent, contract, standard?.doc);
      const requirements = seeded.requirements as { check: string }[] | undefined;
      if (standard?.doc) {
        if (!requirements?.length) gap("requirements", `standard ${standardId} lists no requirement`);
        else if (!same(contract.requirements, requirements)) changes.push("requirements");
      }
      const fixture = contract.fixture === undefined ? seeded.fixture as Record<string, unknown> | undefined : undefined;
      if (contract.fixture === undefined) {
        if (fixture) changes.push("fixture");
        else gap("fixture", agent === "writer" ? "the contract carries no copy fields to derive a fixture from" : "the contract does not determine a fixture (a mounted element needs the candidate's file and export)");
      }
      seeds.push({ agent, slot: entry.id, ...(family ? { family } : {}), ...(requirements?.length ? { requirements } : {}), ...(fixture ? { fixture } : {}), changes });
    }
  }
  return { seeds, gaps };
}

/** Writes every pending seed, one ledgered slot event each; returns the slots written. */
export function applyContracts(consumer: string, plan: ContractsPlan, at: string): string[] {
  const written: string[] = [];
  for (const seed of plan.seeds) {
    if (!seed.changes.length) continue;
    const change = (slot: Slot): Slot => {
      const contract = { ...(slot.contract as Record<string, unknown>) };
      if (seed.changes.includes("requirements")) contract.requirements = seed.requirements;
      if (seed.changes.includes("fixture")) contract.fixture = seed.fixture;
      return { ...slot, contract, ...(seed.changes.includes("family") ? { family: seed.family! } : {}) };
    };
    const fields = { migration: CONTRACTS_MIGRATION, changed: seed.changes, ...(seed.family?.class ? { class: seed.family.class } : {}) };
    if (writeSlotSeed(consumer, seed.agent, seed.slot, change, { at, fields })) written.push(`${seed.agent}/${seed.slot}`);
  }
  return written;
}
