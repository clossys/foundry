/**
 * Designer pins through the one slot-model reader (packages/producer/src/records/slots.ts).
 * Designer checks never read pin.json, slot.json or candidate files by hand, and never read a
 * legacy selection store: a pin is what `listSlots` lists, its bytes are what `readCandidate` returns.
 *
 * The reader ships in @clossys/producer (`@clossys/producer/records/slots`), which depends on this
 * package, so it is resolved by its public specifier and only when a pin is read: importing a
 * shipped Designer check (`@clossys/designer/ref-verbatim`) needs no Producer, and reading pins
 * without one throws a named error instead of a module-not-found at import time.
 */
import { join } from "node:path";

const READER = "@clossys/producer/records/slots";
let reader;
let readerMissing;
let resolved;
// Only an unresolvable reader specifier means Producer is absent; once it resolves, any load error
// (a missing build, a broken dependency) is real and is thrown as is.
try { resolved = import.meta.resolve(READER); }
catch (error) {
  if (error?.code !== "ERR_MODULE_NOT_FOUND" && error?.code !== "ERR_PACKAGE_PATH_NOT_EXPORTED") throw error;
  readerMissing = error;
}
if (resolved) reader = await import(resolved);

/** The slot-model reader, or a named error when @clossys/producer is not installed beside this package. */
export function slotReader() {
  if (reader) return reader;
  throw new Error(`Designer pin checks read slots through ${READER}; install @clossys/producer (it could not be resolved: ${readerMissing?.message})`, { cause: readerMissing });
}

/**
 * Every Designer slot of a consumer root, by slot id: { dir, slotDoc, pinned }, where `pinned` is
 * { pin, item } for a pin whose sha256 matches its candidate bytes, else { error } saying why not.
 */
export function designerSlotRecords(root) {
  const { hasPinFile, isModelDir, listModelDir, listSlots, readCandidate, readSlot, readSlotRecordText } = slotReader();
  const records = new Map();
  for (const entry of listSlots(root, "designer")) {
    let slotDoc;
    try { slotDoc = readSlot(root, "designer", entry.id); } catch { slotDoc = undefined; }
    let pinned;
    if (!entry.pin) pinned = { error: hasPinFile(entry.dir) ? "has a pin.json the slot model rejects" : "is not pinned" };
    else {
      try {
        const candidate = readCandidate(root, "designer", entry.id, entry.pin.candidate);
        pinned = candidate.sha256 === entry.pin.sha256
          ? { pin: entry.pin, item: JSON.parse(candidate.bytes) }
          : { error: "has a pin sha256 that does not match its candidate" };
      } catch { pinned = { error: "pins a missing candidate" }; }
    }
    records.set(entry.id, { dir: entry.dir, slotDoc, pinned });
  }
  // A slot folder the IA does not place is invisible to the reader: report it, never skip it.
  const agentDir = join(root, "agents", "designer");
  for (const name of listModelDir(agentDir)) {
    const dir = join(agentDir, name);
    if (records.has(name) || !isModelDir(dir)) continue;
    if (readSlotRecordText(dir, "slot.json") === undefined && readSlotRecordText(dir, "pin.json") === undefined) continue;
    records.set(name, { dir, slotDoc: undefined, pinned: { error: "is a slot folder the Designer ia.json does not place" } });
  }
  return records;
}

/**
 * Every pinned Designer slot of a consumer root (`<consumer>/clossys`), in IA order.
 * Each entry is { slot, pin, candidate: { name, bytes, sha256 }, item, slotDoc, error }:
 * `error` names why the pinned candidate or slot record could not be read (item is then null).
 */
export function designerPins(root, { all = false } = {}) {
  const { listSlots, readCandidate, readSlot } = slotReader();
  const out = [];
  for (const entry of listSlots(root, "designer")) {
    const names = all ? entry.candidates : entry.pin ? [entry.pin.candidate] : [];
    let slotDoc;
    try { slotDoc = readSlot(root, "designer", entry.id); } catch { slotDoc = undefined; }
    for (const name of names) {
      const pinned = entry.pin?.candidate === name;
      try {
        const candidate = readCandidate(root, "designer", entry.id, name);
        out.push({ slot: entry.id, pin: pinned ? entry.pin : null, candidate, item: JSON.parse(candidate.bytes), slotDoc, error: undefined });
      } catch (error) {
        out.push({ slot: entry.id, pin: pinned ? entry.pin : null, candidate: { name }, item: null, slotDoc, error: error.message });
      }
    }
  }
  return out;
}

/** `<slot>/<candidate>` label for one entry. */
export const pinLabel = entry => `${entry.slot}/${entry.candidate.name}`;
