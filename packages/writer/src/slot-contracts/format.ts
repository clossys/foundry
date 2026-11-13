/**
 * Writer slot contracts: one per L3 Writer slot (key group), text-native.
 *
 * The record shape follows the shared slot-contract field list (purpose,
 * inputs, limits, references[], check suite id, specimen kind).
 * `adaptSlotContract` validates the native contract (nested field limits and
 * guide exemplars the suite reads); `toSlotContractRecord` projects it onto the
 * shared `clossys.slot-contract/1` record, which Producer validates with the
 * slot engine's own schema. Writer never imports Producer.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { WriterLayer } from "../catalog-core/ids.js";

export const WRITER_CHECK_SUITE_ID = "writer.copy.v1" as const;
export const WRITER_SLOT_LAYERS: readonly WriterLayer[] = ["lexicon", "strings", "patterns", "passages", "narratives"];

export interface WriterFieldLimit {
  required: boolean;
  maxChars: number;
  maxWords?: number;
  minChars?: number;
  minWords?: number;
  /** Explicit line breaks allowed; set where the target Designer slot implies a line count. */
  maxLines?: number;
}
export interface WriterLimits {
  /** Per key: string text, pattern part id or passage copy field key. */
  fields: Record<string, WriterFieldLimit>;
  /** Source-locale text must leave this share of maxChars for translation (0.3 = 30%). */
  translationHeadroom: number;
  /** Text must not repeat verbatim on another page. */
  unique: boolean;
  /** Numbers and superlatives need a claim or evidence reference. */
  claims: boolean;
  recordKind?: string;
  requiredProperties?: string[];
  shape?: "page" | "chrome" | "long-form";
  countKey?: string;
  minCount?: number;
  maxCount?: number;
  designerSection?: string;
}
export type WriterExemplar =
  | { fields: Record<string, string | string[]> }
  | { note: string }
  | { outline: string[] };
export type WriterGuideReference = { id: string; kind: "guide"; guide: string; exemplars: WriterExemplar[] };
export interface WriterSlotContract {
  id: string;
  package: "writer";
  layer: WriterLayer;
  purpose: string;
  /** Director cells this slot cites, as `director:<cell id>`. */
  inputs: string[];
  limits: WriterLimits;
  references: WriterGuideReference[];
  checkSuiteId: typeof WRITER_CHECK_SUITE_ID;
  specimenKind: "text";
}
export interface WriterCompositionReference {
  id: string; kind: "composition"; guide: string;
  levels: Array<{ level: string; layer: string; slots: string[]; rule: string }>;
  arc: string[]; inputs: string[];
}
export interface WriterContracts { slots: WriterSlotContract[]; composition: WriterCompositionReference[] }

const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every(x => typeof x === "string");
const text = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const count = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;

function fieldLimit(raw: unknown, at: string): WriterFieldLimit {
  if (!object(raw) || typeof raw.required !== "boolean" || !count(raw.maxChars) || raw.maxChars === 0) throw new Error(`${at}: field limit needs required and maxChars`);
  const out: WriterFieldLimit = { required: raw.required, maxChars: raw.maxChars };
  for (const key of ["maxWords", "minChars", "minWords", "maxLines"] as const) {
    if (raw[key] === undefined) continue;
    if (!count(raw[key])) throw new Error(`${at}: ${key} must be a non-negative integer`);
    out[key] = raw[key] as number;
  }
  return out;
}

function writerLimits(raw: unknown, at: string): WriterLimits {
  if (!object(raw) || !object(raw.fields)) throw new Error(`${at}: limits.fields is required`);
  if (typeof raw.translationHeadroom !== "number" || raw.translationHeadroom < 0 || raw.translationHeadroom >= 1) throw new Error(`${at}: translationHeadroom must be in [0, 1)`);
  if (typeof raw.unique !== "boolean" || typeof raw.claims !== "boolean") throw new Error(`${at}: unique and claims must be booleans`);
  const fields: Record<string, WriterFieldLimit> = {};
  for (const [key, value] of Object.entries(raw.fields)) fields[key] = fieldLimit(value, `${at}:${key}`);
  const out: WriterLimits = { fields, translationHeadroom: raw.translationHeadroom, unique: raw.unique, claims: raw.claims };
  if (raw.recordKind !== undefined) { if (!text(raw.recordKind)) throw new Error(`${at}: recordKind`); out.recordKind = raw.recordKind; }
  if (raw.requiredProperties !== undefined) { if (!strings(raw.requiredProperties)) throw new Error(`${at}: requiredProperties`); out.requiredProperties = [...raw.requiredProperties]; }
  if (raw.shape !== undefined) { if (!["page", "chrome", "long-form"].includes(String(raw.shape))) throw new Error(`${at}: shape`); out.shape = raw.shape as WriterLimits["shape"]; }
  if (raw.countKey !== undefined) { if (!text(raw.countKey)) throw new Error(`${at}: countKey`); out.countKey = raw.countKey; }
  for (const key of ["minCount", "maxCount"] as const) if (raw[key] !== undefined) { if (!count(raw[key])) throw new Error(`${at}: ${key}`); out[key] = raw[key] as number; }
  if (raw.designerSection !== undefined) { if (!text(raw.designerSection)) throw new Error(`${at}: designerSection`); out.designerSection = raw.designerSection; }
  return out;
}

function exemplar(raw: unknown, at: string): WriterExemplar {
  if (!object(raw)) throw new Error(`${at}: exemplar must be an object`);
  if (object(raw.fields)) {
    for (const [k, v] of Object.entries(raw.fields)) if (!text(v) && !(strings(v) && v.length && v.every(text))) throw new Error(`${at}: exemplar field ${k} must be text`);
    return { fields: raw.fields as Record<string, string | string[]> };
  }
  if (text(raw.note)) return { note: raw.note };
  if (strings(raw.outline) && raw.outline.length) return { outline: [...raw.outline] };
  throw new Error(`${at}: exemplar needs fields, note or outline`);
}

/** Validate one contract against the shared field list; throws with the slot id and field. */
export function adaptSlotContract(value: unknown, where = "writer"): WriterSlotContract {
  if (!object(value)) throw new Error(`${where}: contract must be an object`);
  const at = `${where}:${typeof value.id === "string" ? value.id : "?"}`;
  if (!text(value.id)) throw new Error(`${at}: id is required`);
  for (const key of ["package", "layer", "purpose", "checkSuiteId"] as const) if (!text(value[key])) throw new Error(`${at}: ${key} is required`);
  if (value.package !== "writer" || !WRITER_SLOT_LAYERS.includes(value.layer as WriterLayer) || !value.id.startsWith(`${value.layer as string}.`)) throw new Error(`${at}: expected a writer slot in its layer`);
  if (value.checkSuiteId !== WRITER_CHECK_SUITE_ID) throw new Error(`${at}: unknown check suite ${String(value.checkSuiteId)}`);
  if (!strings(value.inputs) || value.inputs.some(i => !/^director:[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*){2}$/.test(i))) throw new Error(`${at}: inputs must be director:<cell> references`);
  if (!Array.isArray(value.references) || value.references.length === 0) throw new Error(`${at}: at least one reference is required`);
  const references = value.references.map((ref, i): WriterGuideReference => {
    if (!object(ref) || !text(ref.id) || ref.kind !== "guide" || !text(ref.guide) || !Array.isArray(ref.exemplars)) throw new Error(`${at}: reference ${i} needs id, kind guide, guide and exemplars`);
    return { id: ref.id, kind: "guide", guide: ref.guide, exemplars: ref.exemplars.map((e, j) => exemplar(e, `${at}:exemplar ${j}`)) };
  });
  if (value.specimenKind !== "text") throw new Error(`${at}: specimenKind must be text`);
  return {
    id: value.id, package: "writer", layer: value.layer as WriterLayer, purpose: value.purpose as string,
    inputs: [...value.inputs], limits: writerLimits(value.limits, at), references,
    checkSuiteId: WRITER_CHECK_SUITE_ID, specimenKind: "text",
  };
}

/** The shared `clossys.slot-contract/1` record (structural; Producer owns the schema). */
export interface SharedSlotContractRecord {
  schema: "clossys.slot-contract/1";
  slot: string;
  package: string;
  layer: string;
  purpose: string;
  inputs: Array<{ name: string; kind: "cell"; required: boolean }>;
  limits: Record<string, number | string | boolean>;
  references: Array<{ registry: string; item: string; version: string; hash: string }>;
  checkSuite: string;
  specimenKind: "text";
}

/** JSON with sorted keys, so a reference's hash names its content and nothing else. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
const contentHash = (value: unknown) => `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;

/**
 * Flatten Writer limits onto the shared record's scalar map: per-field limits
 * become `fields.<key>.<limit>`, lists are comma-joined. Nothing is dropped.
 */
export function flattenWriterLimits(limits: WriterLimits): Record<string, number | string | boolean> {
  const out: Record<string, number | string | boolean> = {};
  for (const [key, field] of Object.entries(limits.fields)) for (const [name, value] of Object.entries(field)) out[`fields.${key}.${name}`] = value as number | boolean;
  for (const [name, value] of Object.entries(limits)) {
    if (name === "fields" || value === undefined) continue;
    out[name] = Array.isArray(value) ? value.join(",") : value as number | string | boolean;
  }
  return out;
}

/** Project one Writer contract onto the shared slot-contract record. Pure. */
export function toSlotContractRecord(contract: WriterSlotContract): SharedSlotContractRecord {
  return {
    schema: "clossys.slot-contract/1",
    slot: contract.id, package: contract.package, layer: contract.layer, purpose: contract.purpose,
    inputs: contract.inputs.map(name => ({ name, kind: "cell", required: true })),
    limits: flattenWriterLimits(contract.limits),
    references: contract.references.map(ref => ({ registry: contract.package, item: ref.id, version: "1", hash: contentHash(ref) })),
    checkSuite: contract.checkSuiteId, specimenKind: contract.specimenKind,
  };
}

const readJson = (name: string): unknown => JSON.parse(readFileSync(new URL(`../../src/slot-contracts/contracts/${name}`, import.meta.url), "utf8"));

let cached: WriterContracts | undefined;
export function loadWriterContracts(): WriterContracts {
  if (cached) return cached;
  const slots: WriterSlotContract[] = []; const seen = new Set<string>();
  for (const layer of WRITER_SLOT_LAYERS) {
    const raw = readJson(`${layer}.json`);
    if (!object(raw) || raw.schemaVersion !== 1 || raw.layer !== layer || !Array.isArray(raw.slots)) throw new Error(`${layer}.json: unexpected file shape`);
    for (const s of raw.slots) {
      const contract = adaptSlotContract(s, `${layer}.json`);
      if (contract.layer !== layer || seen.has(contract.id)) throw new Error(`${layer}.json:${contract.id}: wrong layer or duplicate`);
      seen.add(contract.id); slots.push(contract);
    }
  }
  const composition = readJson("composition.json");
  if (!object(composition) || !Array.isArray(composition.references)) throw new Error("composition.json: unexpected file shape");
  cached = { slots, composition: composition.references as WriterCompositionReference[] };
  return cached;
}

/** Every exemplar string with at least `minWords` words, for the originality check. */
export function exemplarTexts(contracts: WriterContracts = loadWriterContracts()): Array<{ slot: string; text: string }> {
  const out: Array<{ slot: string; text: string }> = [];
  for (const slot of contracts.slots) for (const ref of slot.references) for (const ex of ref.exemplars) {
    if (!("fields" in ex)) continue;
    for (const value of Object.values(ex.fields)) for (const t of Array.isArray(value) ? value : [value]) out.push({ slot: slot.id, text: t });
  }
  return out;
}
