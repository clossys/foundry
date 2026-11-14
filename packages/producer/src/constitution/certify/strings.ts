/**
 * The strings certifier (R05): a Writer candidate fits its slot when it holds every key the contract
 * fixture names in every locale the fixture names, and (unless the contract is open) no other key.
 */
import { isObject, stringList } from "../checks/shared.js";
import type { CandidateRecord, SlotRecord } from "../types.js";
import { writerRecords } from "./env.js";
import { reason, type Reason } from "./types.js";

const isOpen = (contract: Readonly<Record<string, unknown>>) => contract.open === true || contract.mode === "open";

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
  if (!isOpen(contract)) {
    const wanted = new Set(keys);
    const extra = [...new Set(read.rows.map(row => row.id))].filter(id => !wanted.has(id)).sort();
    if (extra.length) out.push(reason("fixture", `holds ${extra.length} key(s) the closed contract fixture does not name: ${extra.slice(0, 4).join(", ")}${extra.length > 4 ? ", ..." : ""}`));
  }
  return out;
}
