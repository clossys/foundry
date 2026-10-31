/**
 * Director slot contracts: one per L3 strategy cell.
 *
 * The record shape follows the shared slot-contract field list (purpose,
 * inputs, limits, references[], check suite id, specimen kind). Until the
 * shared producer type lands, `adaptSlotContract` is the single place that
 * validates and normalizes a contract, so a later switch is one function.
 */
import { readFileSync } from "node:fs";

export const DIRECTOR_CHECK_SUITE_ID = "director.cell.v1" as const;
export type SpecimenKind = "text";

/** The shared field list, kept structural so it maps 1:1 onto the producer type. */
export interface SlotContractRecord<L> {
  id: string;
  package: string;
  layer: string;
  purpose: string;
  /** Cited upstream cells as `<agent>:<cell id>`. */
  inputs: string[];
  limits: L;
  references: Array<{ id: string; kind: string } & Record<string, unknown>>;
  checkSuiteId: string;
  specimenKind: SpecimenKind;
}

export interface DirectorLimits {
  /** Direction keys that must be present and filled (the catalog's mustContain). */
  requiredKeys: string[];
  /** A filled value has at least this many words. */
  minWordsPerKey: number;
  /** Keys whose value is one token by nature, such as a date or a name. */
  singleTokenKeys: string[];
}
export type DirectorFrameworkReference = {
  id: string;
  kind: "framework";
  /** What the field means in the brand-platform framework. */
  meaning: string;
  /** Good Direction bullets, `Key: value`. */
  good: string[];
  /** Bad Direction bullets, `Key: value`; each set must fail the suite. */
  bad: string[];
  whyBad: string;
};
export interface DirectorSlotContract extends SlotContractRecord<DirectorLimits> {
  package: "director";
  layer: "strategy";
  references: DirectorFrameworkReference[];
  /** Writer slots whose contracts cite this cell; computed from Writer inputs. */
  feeds: string[];
}
export interface DirectorFramework {
  id: string; kind: "framework"; meaning: string; layers: string[]; good: string[]; bad: string[];
}
export interface DirectorContracts { framework: DirectorFramework; slots: DirectorSlotContract[] }
/** `negativeKeys` bullets (Never, Avoid, ...) may name filler on purpose and are exempt. */
export interface Specificity { filler: string[]; placeholders: string[]; negativeKeys: string[] }

const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every(x => typeof x === "string");
const text = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;

/** Validate one contract against the shared field list; throws with the slot id and field. */
export function adaptSlotContract<L>(value: unknown, where: string, limits: (raw: unknown, where: string) => L): SlotContractRecord<L> {
  if (!object(value)) throw new Error(`${where}: contract must be an object`);
  const id = value.id;
  const at = `${where}:${typeof id === "string" ? id : "?"}`;
  if (!text(id)) throw new Error(`${at}: id is required`);
  for (const key of ["package", "layer", "purpose", "checkSuiteId"] as const) if (!text(value[key])) throw new Error(`${at}: ${key} is required`);
  if (!strings(value.inputs) || value.inputs.some(i => !/^[a-z][a-z0-9-]*:[a-z][a-z0-9.-]*$/.test(i))) throw new Error(`${at}: inputs must be agent:cell references`);
  if (!Array.isArray(value.references) || value.references.length === 0) throw new Error(`${at}: at least one reference is required`);
  for (const ref of value.references) if (!object(ref) || !text(ref.id) || !text(ref.kind)) throw new Error(`${at}: references need id and kind`);
  if (value.specimenKind !== "text") throw new Error(`${at}: specimenKind must be text`);
  return {
    id, package: value.package as string, layer: value.layer as string, purpose: value.purpose as string,
    inputs: [...value.inputs], limits: limits(value.limits, at),
    references: value.references as SlotContractRecord<L>["references"],
    checkSuiteId: value.checkSuiteId as string, specimenKind: "text",
  };
}

function directorLimits(raw: unknown, at: string): DirectorLimits {
  if (!object(raw) || !strings(raw.requiredKeys) || raw.requiredKeys.length === 0) throw new Error(`${at}: limits.requiredKeys is required`);
  if (typeof raw.minWordsPerKey !== "number" || !Number.isInteger(raw.minWordsPerKey) || raw.minWordsPerKey < 1) throw new Error(`${at}: limits.minWordsPerKey must be a positive integer`);
  const single = raw.singleTokenKeys ?? [];
  if (!strings(single) || single.some(k => !(raw.requiredKeys as string[]).includes(k))) throw new Error(`${at}: limits.singleTokenKeys must name required keys`);
  return { requiredKeys: [...raw.requiredKeys], minWordsPerKey: raw.minWordsPerKey, singleTokenKeys: [...single] };
}

export function adaptDirectorContract(value: unknown, where = "director"): DirectorSlotContract {
  const base = adaptSlotContract(value, where, directorLimits);
  const raw = value as Record<string, unknown>;
  if (base.package !== "director" || base.layer !== "strategy") throw new Error(`${where}:${base.id}: expected a director strategy contract`);
  if (base.checkSuiteId !== DIRECTOR_CHECK_SUITE_ID) throw new Error(`${where}:${base.id}: unknown check suite ${base.checkSuiteId}`);
  if (!strings(raw.feeds)) throw new Error(`${where}:${base.id}: feeds must be a list`);
  for (const ref of base.references) {
    if (ref.kind !== "framework" || !text(ref.meaning) || !strings(ref.good) || !strings(ref.bad) || !text(ref.whyBad)) throw new Error(`${where}:${base.id}: framework reference needs meaning, good, bad and whyBad`);
  }
  return { ...base, package: "director", layer: "strategy", references: base.references as unknown as DirectorFrameworkReference[], feeds: [...raw.feeds] };
}

const readJson = (name: string): unknown => JSON.parse(readFileSync(new URL(`../../src/slot-contracts/${name}`, import.meta.url), "utf8"));

let cached: DirectorContracts | undefined;
export function loadDirectorContracts(): DirectorContracts {
  if (cached) return cached;
  const raw = readJson("contracts.json");
  if (!object(raw) || raw.schemaVersion !== 1 || !Array.isArray(raw.slots) || !object(raw.framework)) throw new Error("director contracts: unexpected file shape");
  const slots = raw.slots.map(s => adaptDirectorContract(s, "contracts.json"));
  const ids = new Set<string>();
  for (const s of slots) { if (ids.has(s.id)) throw new Error(`contracts.json: duplicate ${s.id}`); ids.add(s.id); }
  cached = { framework: raw.framework as unknown as DirectorFramework, slots };
  return cached;
}

let cachedSpecificity: Specificity | undefined;
export function loadSpecificity(): Specificity {
  if (cachedSpecificity) return cachedSpecificity;
  const raw = readJson("specificity.json");
  const lexicon = JSON.parse(readFileSync(new URL("../../src/catalog/lexicon.json", import.meta.url), "utf8")) as { banned?: unknown; negativeKeys?: unknown };
  if (!object(raw) || !strings(raw.filler) || !strings(raw.placeholders)) throw new Error("specificity.json: unexpected shape");
  const banned = strings(lexicon.banned) ? lexicon.banned : [];
  cachedSpecificity = { filler: [...new Set([...banned, ...raw.filler].map(p => p.toLowerCase()))], placeholders: raw.placeholders.map(p => p.toLowerCase()), negativeKeys: strings(lexicon.negativeKeys) ? [...lexicon.negativeKeys] : [] };
  return cachedSpecificity;
}
