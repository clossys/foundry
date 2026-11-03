/**
 * Publisher's specimen transport over canonical Designer slots. Consumer roots
 * hold agents/designer/ia.json; no legacy library or selection store is read.
 * Publisher renders the validated inline registry item and its recorded preview.
 */
import { resolve } from "node:path";
import { recordStoreSource, type SpecimenElementVersion, type SpecimenRecordSource, type SpecimenRecordStore } from "@clossys/publisher/specimen";
import { listSlots, readCandidate, readSlot, readSlotEntry, type SlotEntry } from "../records/slots.js";
import { CANDIDATE_NAME, validateCandidate, validateSlotDoc } from "../records/slot-model/index.js";
import { RecordError } from "../records/validate.js";

const SEGMENT = /^[a-z0-9][a-z0-9.-]*$/;
export interface LibrarySourceOptions {
  /** Canonical consumer roots, searched in order. */
  readonly roots: readonly string[];
  readonly defaultTheme?: string;
}

function versions(entry: SlotEntry, element: string): { name: string; version: number }[] {
  return entry.candidates.flatMap(name => {
    const match = CANDIDATE_NAME.exec(name);
    return match?.[1] === element && match[3] === "json" ? [{ name, version: Number(match[2]) }] : [];
  });
}

function findLibraryElement(roots: readonly string[], id: string): { root: string; entry: SlotEntry; element: string } | undefined {
  const parts = id.split("/");
  if (parts.length > 2 || !parts.every(part => SEGMENT.test(part) && !part.includes(".."))) return undefined;
  const element = parts.at(-1)!;
  for (const root of roots) {
    // A slot-qualified id reads only its own slot folder: a full listing per load made every
    // specimen read O(slots) and a whole pass O(slots^2) synchronous filesystem work.
    if (parts.length === 2) {
      const entry = readSlotEntry(root, "designer", parts[0]!);
      if (entry && versions(entry, element).length) return { root, entry, element };
      continue;
    }
    const matches = listSlots(root, "designer").filter(entry => versions(entry, element).length);
    if (matches.length > 1) throw new Error(`element ${element} is in ${matches.length} slots (${matches.map(entry => entry.id).join(", ")}); name it as <slot>/${element}`);
    if (matches.length) return { root, entry: matches[0]!, element };
  }
  return undefined;
}

/** Locate only candidates placed in the Designer IA; a bare name must be unique. */
export function locateLibraryElement(roots: readonly string[], id: string): { root: string; slot: string; element: string } | undefined {
  const found = findLibraryElement(roots, id);
  return found && { root: found.root, slot: found.entry.id, element: found.element };
}

function pinnedVersionOf(entry: SlotEntry | undefined, element: string): number | undefined {
  const pin = entry?.pin;
  const match = pin && CANDIDATE_NAME.exec(pin.candidate);
  return match && match[1] === element ? Number(match[2]) : undefined;
}

/** A missing or invalid pin never selects the newest candidate. */
export function pinnedLibraryVersion(root: string, slot: string, element: string): number | undefined {
  return pinnedVersionOf(readSlotEntry(root, "designer", slot), element);
}

/** Every byte and the pin come from the common model reader. No store fallback. */
export function libraryRecordStore(rootsIn: readonly string[]): SpecimenRecordStore {
  const roots = rootsIn.map(root => resolve(root));
  return {
    async load(id, version) {
      const where = findLibraryElement(roots, id);
      if (!where) return undefined;
      const { root, entry, element } = where, slot = entry.id;
      const chosen = version ?? pinnedVersionOf(entry, element);
      if (chosen === undefined) return undefined;
      const candidate = versions(entry, element).find(candidate => candidate.version === chosen);
      if (!candidate) return undefined;
      const doc = readSlot(root, "designer", slot);
      const docIssues = validateSlotDoc(doc);
      if (docIssues.length) throw new RecordError(`slot ${slot}`, docIssues);
      if (doc.id !== slot || doc.agent !== "designer" || doc.kind !== "element" || doc.ia.l0 !== entry.position.l0 || doc.ia.l1 !== entry.position.l1 || doc.ia.l2 !== entry.position.l2 || doc.ia.order !== entry.position.order) docIssues.push({ code: "slot-mismatch", path: "slot.json", message: "slot identity or position differs from the IA" });
      if (docIssues.length) throw new RecordError(`slot ${slot}`, docIssues);
      const read = readCandidate(root, "designer", slot, candidate.name);
      const issues = validateCandidate("element", slot, candidate.name, read.bytes);
      if (entry.pin?.candidate === candidate.name && entry.pin.sha256 !== read.sha256) issues.push({ code: "pin-hash", path: "pin.json", message: "pinned candidate bytes do not match sha256" });
      if (issues.length) throw new RecordError(`candidate ${slot}/${candidate.name}`, issues);
      const item = JSON.parse(read.bytes);
      if (item.name !== element || (item.meta?.element?.id !== undefined && item.meta.element.id !== element) || (item.meta?.element?.slot !== undefined && item.meta.element.slot !== slot)) throw new Error(`candidate ${slot}/${candidate.name}: element identity differs from the candidate name or slot`);
      const row: SpecimenElementVersion = {
        id: `${slot}/${element}`, version: chosen, kind: item.type, layer: entry.position.l0 ?? slot.split(".")[0]!,
        files: [{ path: `${element}.json`, content: read.bytes }], preview: item.meta?.preview ?? {}, contentHash: read.sha256,
      };
      return row;
    },
  };
}

export function libraryRecordSource(options: LibrarySourceOptions): SpecimenRecordSource {
  return recordStoreSource(libraryRecordStore(options.roots), options.defaultTheme ? { defaultTheme: options.defaultTheme } : {});
}

/** Actual candidate identities, in IA slots only; first consumer wins a repeat. */
export function listLibraryElements(rootsIn: readonly string[]): string[] {
  const ids = new Set<string>();
  for (const root of rootsIn) for (const entry of listSlots(resolve(root), "designer")) for (const name of entry.candidates) {
    const match = CANDIDATE_NAME.exec(name);
    if (match?.[3] === "json") ids.add(`${entry.id}/${match[1]}`);
  }
  return [...ids].sort();
}
