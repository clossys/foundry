/**
 * The strings certifier (R05): a Writer candidate fits its slot when it holds every key the contract
 * fixture names in every locale the fixture names, and (unless the contract is open) no other key.
 * A copy contract (`contract.copy.fields`, foundry-build-0048 U3) is the closed key set: a candidate may
 * hold any of its field keys (the fixture names the required ones), every required field in every
 * fixture locale, and no value past the field's `maxLength` for its locale; each breach names the key.
 */
import { isObject, stringList } from "../checks/shared.js";
import type { CandidateRecord, SlotRecord } from "../types.js";
import { writerRecords } from "./env.js";
import { reason, type Reason } from "./types.js";

const isOpen = (contract: Readonly<Record<string, unknown>>) => contract.open === true || contract.mode === "open";

interface CopyField { readonly key: string; readonly required: boolean; readonly maxLength: Readonly<Record<string, number>>; readonly match: RegExp }
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** A copy field key as a pattern: `items[].name` matches `items[0].name` and `items.0.name`. */
const keyPattern = (key: string) => new RegExp(`^${key.split("[]").map(escape).join("(?:\\[\\d+\\]|\\.\\d+)")}$`);

/** The copy contract's fields, undefined when the contract carries none. */
export function copyFields(contract: Readonly<Record<string, unknown>>): CopyField[] | undefined {
  const copy = contract.copy;
  if (!isObject(copy) || !Array.isArray(copy.fields)) return undefined;
  const out: CopyField[] = [];
  for (const field of copy.fields) {
    if (!isObject(field) || typeof field.key !== "string" || !field.key) continue;
    const limits: Record<string, number> = {};
    if (isObject(field.maxLength)) for (const [locale, max] of Object.entries(field.maxLength)) if (typeof max === "number") limits[locale] = max;
    out.push({ key: field.key, required: field.required === true, maxLength: limits, match: keyPattern(field.key) });
  }
  return out.length ? out : undefined;
}
const list = (items: readonly string[]) => `${items.slice(0, 4).join(", ")}${items.length > 4 ? ", ..." : ""}`;

export function certifyStrings(slot: SlotRecord, candidate: CandidateRecord, contract: Readonly<Record<string, unknown>>): Reason[] {
  if (contract.fixture === undefined) return [reason("no-fixture", `slot ${slot.id} declares no contract fixture (slot.json contract.fixture)`)];
  const fixture = isObject(contract.fixture) ? contract.fixture : {};
  const read = writerRecords(candidate);
  if ("error" in read) return [reason("invalid", read.error)];
  const keys = stringList(fixture.keys), locales = stringList(fixture.locales);
  const held = new Map<string, Set<string>>();
  for (const row of read.rows) {
    let set = held.get(row.locale);
    if (!set) held.set(row.locale, set = new Set());
    set.add(row.id);
  }
  const out: Reason[] = [];
  for (const locale of locales) {
    const have = held.get(locale);
    if (!have) { out.push(reason("fixture", `has no ${locale} records, which the contract fixture requires`)); continue; }
    const missing = keys.filter(key => !have.has(key));
    if (missing.length) out.push(reason("fixture", `${locale} lacks ${missing.length} fixture key(s): ${missing.slice(0, 4).join(", ")}${missing.length > 4 ? ", ..." : ""}`));
  }
  const fields = copyFields(contract);
  if (fields) {
    for (const locale of locales) {
      const have = held.get(locale);
      if (!have) continue;
      const missing = fields.filter(field => field.required && !have.has(field.key) && !keys.includes(field.key)).map(field => field.key);
      if (missing.length) out.push(reason("fixture", `${locale} lacks ${missing.length} required copy field(s): ${list(missing)}`));
    }
    const fieldOf = (id: string) => fields.find(field => field.match.test(id));
    const unknown = [...new Set(read.rows.map(row => row.id))].filter(id => !fieldOf(id)).sort();
    if (unknown.length && !isOpen(contract)) out.push(reason("fixture", `holds ${unknown.length} key(s) the copy contract does not name: ${list(unknown)}`));
    for (const row of read.rows) {
      const max = row.text === undefined ? undefined : fieldOf(row.id)?.maxLength[row.locale];
      if (max !== undefined && [...row.text!].length > max) out.push(reason("limit", `${row.locale} ${row.id} is ${[...row.text!].length} characters, past the copy contract's maxLength ${max}`));
    }
    return out;
  }
  if (!isOpen(contract)) {
    const wanted = new Set(keys);
    const extra = [...new Set(read.rows.map(row => row.id))].filter(id => !wanted.has(id)).sort();
    if (extra.length) out.push(reason("fixture", `holds ${extra.length} key(s) the closed contract fixture does not name: ${list(extra)}`));
  }
  return out;
}
