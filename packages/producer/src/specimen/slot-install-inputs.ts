/** Runtime specimen inputs: canonical Designer slots; a consumer without the slot model has none. */
import { createHash } from "node:crypto";
import type { InstallPins } from "@clossys/publisher/install";
import { hasPinFile, hasSlotModel, listSlots, readCandidate, readSlot } from "../records/slots.js";
import { CANDIDATE_NAME, validateCandidate, validateSlotDoc } from "../records/slot-model/index.js";

/** One recorded candidate of a slot, by element and version (its file is `<element>-v<version>.json`). */
export interface SlotOption { readonly element: string; readonly version: number }
export interface SlotInstallInputs {
  readonly pins: InstallPins;
  /**
   * Every other valid candidate of each slot: a preview only. Pages install `pins` alone; the
   * specimen route renders an option's own bytes when Studio asks for that (slot, candidate).
   */
  readonly options: ReadonlyMap<string, readonly SlotOption[]>;
  readonly unpinned: InstallPins;
  /** Includes actual valid candidate bytes, not just names or declared pin hashes. */
  readonly fingerprint: string;
}
type MutablePins = Record<string, { element: string; version: number }>;
const fingerprint = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

export function slotInstallInputs(consumer: string): SlotInstallInputs | undefined {
  if (!hasSlotModel(consumer)) return undefined;
  const pins: MutablePins = {}, unpinned: MutablePins = {};
  const options = new Map<string, SlotOption[]>();
  const evidence: unknown[] = [];
  for (const entry of listSlots(consumer, "designer")) {
    const fail = (reason: string): never => { throw new Error(`Specimen slot ${entry.id}: ${reason}`); };
    const pinPresent = hasPinFile(entry.dir);
    if (pinPresent && !entry.pin) fail("invalid native pin");
    let doc: ReturnType<typeof readSlot>;
    try { doc = readSlot(consumer, "designer", entry.id); }
    catch { if (pinPresent) throw new Error(`Specimen slot ${entry.id}: missing or invalid slot`); continue; }
    if (validateSlotDoc(doc).length || doc.id !== entry.id || doc.agent !== "designer" || doc.kind !== "element"
      || doc.ia.l0 !== entry.position.l0 || doc.ia.l1 !== entry.position.l1 || doc.ia.l2 !== entry.position.l2 || doc.ia.order !== entry.position.order) {
      if (pinPresent) fail("slot identity or position differs from IA");
      continue;
    }
    const valid = new Map<string, { element: string; version: number; sha256: string }>();
    for (const name of entry.candidates) {
      try {
        const match = CANDIDATE_NAME.exec(name)!;
        const candidate = readCandidate(consumer, "designer", entry.id, name);
        if (validateCandidate("element", entry.id, name, candidate.bytes).length) continue;
        const item = JSON.parse(candidate.bytes);
        const element = match[1]!, version = Number(match[2]);
        if (!Number.isSafeInteger(version) || element.includes("..") || item.name !== element
          || (item.meta?.element?.id !== undefined && item.meta.element.id !== element)
          || (item.meta?.element?.slot !== undefined && item.meta.element.slot !== entry.id)) continue;
        valid.set(name, { element, version, sha256: candidate.sha256 });
      } catch { /* Invalid drafts cannot join an option pass. A pin to one fails below. */ }
    }
    evidence.push([entry.id, doc, entry.pin, [...valid]]);
    if (entry.pin) {
      const chosen = valid.get(entry.pin.candidate);
      if (!chosen) throw new Error(`Specimen slot ${entry.id}: missing or invalid pinned candidate`);
      if (chosen.sha256 !== entry.pin.sha256) fail("native pin hash drift");
      pins[entry.id] = { element: chosen.element, version: chosen.version };
      const others = [...valid].filter(([name]) => name !== entry.pin!.candidate).map(([, row]) => ({ element: row.element, version: row.version }));
      if (others.length) options.set(entry.id, others);
    } else {
      if (valid.size) options.set(entry.id, [...valid.values()].map(row => ({ element: row.element, version: row.version })));
      const elements = new Set([...valid.values()].map(row => row.element));
      if (elements.size === 1) {
        const newest = [...valid.values()].at(-1)!;
        unpinned[entry.id] = { element: newest.element, version: newest.version };
      }
    }
  }
  return { pins, options, unpinned, fingerprint: fingerprint(evidence) };
}
