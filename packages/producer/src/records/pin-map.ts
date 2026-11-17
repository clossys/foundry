/**
 * Writer pin maps (system.md 3 row 5, 4; writer.md 9): `clossys.pin-map/1`, one pin record per record key
 * for Writer Prose and Copy slots, in the slot's `pin.json`. Each record follows the same rules as a pin
 * (pin.ts pinRecordIssues) against the map's `refs`. This module also reads a slot's `pin.json` in either shape.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { candidatePath, parseCandidateName, readCandidateFile, slotDir } from "./candidate.js";
import { buildPin, pinIssues, pinMapIssues, pinPath, pinRecordIssues, pinRecordStatus, writePinDoc, type Pin1Doc } from "./pin.js";
import { candidateIssues, readSlotValue } from "./slot-current.js";
import { validateCandidate } from "./slot-model/validate.js";
import type { Actor, AgentId, Pin, PinMap, PinRecord, Ref, SlotId, TargetSlotKind } from "./types.js";

/** Writer slot kinds whose pin is a map keyed by record (Voice keeps a single pin). */
export const PIN_MAP_KINDS: readonly TargetSlotKind[] = ["prose", "copy"];
export const usesPinMap = (agent: AgentId, kind: string | undefined): boolean =>
  agent === "writer" && kind !== undefined && (PIN_MAP_KINDS as readonly string[]).includes(kind);

export { pinMapIssues } from "./pin.js";

export type PinFile =
  | { readonly kind: "none" }
  | { readonly kind: "pin"; readonly doc: Pin; readonly issues: readonly string[] }
  | { readonly kind: "pin-map"; readonly doc: PinMap; readonly issues: readonly string[] }
  | { readonly kind: "pin/1"; readonly doc: Pin1Doc; readonly issues: readonly string[] }
  | { readonly kind: "invalid"; readonly issues: readonly string[] };

/** Reads a slot's `pin.json` as a pin/2, a pin map, or an int2 pin/1 (to migrate); never throws on bad data. */
export function readPinFile(file: string, expect?: { agent: AgentId; slotId: SlotId }): PinFile {
  if (!existsSync(file)) return { kind: "none" };
  let doc: unknown;
  try { doc = JSON.parse(readFileSync(file, "utf8")); } catch (error) {
    return { kind: "invalid", issues: [`pin.json is not JSON: ${error instanceof Error ? error.message : String(error)}`] };
  }
  if (typeof doc !== "object" || doc === null || Array.isArray(doc)) return { kind: "invalid", issues: ["pin.json is not an object"] };
  const schema = (doc as { schema?: unknown }).schema;
  if (schema === "clossys.pin/2") return { kind: "pin", doc: doc as Pin, issues: pinIssues(doc, expect) };
  if (schema === "clossys.pin-map/1") return { kind: "pin-map", doc: doc as PinMap, issues: pinMapIssues(doc, expect) };
  if (schema === undefined && "candidate" in doc) return { kind: "pin/1", doc: doc as Pin1Doc, issues: ["pin.json is an int2 pin (pin/1): run the pin-1-to-2 migration"] };
  return { kind: "invalid", issues: [`pin.json has an unknown schema ${String(schema)}`] };
}

const sameRef = (a: Ref, b: Ref): boolean => a.to === b.to && a.rel === b.rel && a.record === b.record && a.key === b.key && a.sha256 === b.sha256;

/** Adds refs not already present, keeping order. */
export function mergeRefs(existing: readonly Ref[], added: readonly Ref[]): Ref[] {
  const out = [...existing];
  for (const ref of added) if (!out.some(have => sameRef(have, ref))) out.push(ref);
  return out;
}

export interface PinMapUpdate {
  readonly agent: AgentId;
  readonly slotId: SlotId;
  readonly record: string;
  /** The new pin of `record`, or null to clear it (back to the package default). */
  readonly pin: PinRecord | null;
  readonly refs?: readonly Ref[];
  readonly createdBy: Actor;
  readonly at: string;
}

/**
 * The pin map after replacing (or clearing) one record. Other records are kept as they are; record keys are
 * sorted so the file is stable. Returns null when the last record is cleared (no pin map left).
 */
export function setPinMapRecord(previous: PinMap | undefined, update: PinMapUpdate): PinMap | null {
  const records: Record<string, PinRecord> = { ...(previous?.records ?? {}) };
  if (update.pin) records[update.record] = update.pin;
  else delete records[update.record];
  const keys = Object.keys(records).sort();
  if (keys.length === 0) return null;
  const sorted: Record<string, PinRecord> = {};
  for (const key of keys) sorted[key] = records[key]!;
  const status = keys.some(key => pinRecordStatus(sorted[key]!) === "confirm") ? "confirm" : "pinned";
  return {
    schema: "clossys.pin-map/1",
    id: `${update.agent}/${update.slotId}/pin`,
    agent: update.agent,
    kind: "pin-map",
    status,
    createdBy: update.createdBy,
    createdAt: previous?.createdAt ?? update.at,
    updatedAt: update.at,
    refs: mergeRefs(previous?.refs ?? [], update.refs ?? []),
    records: sorted,
  };
}

export interface TargetPinInput {
  readonly agent: AgentId;
  readonly slotId: SlotId;
  /** Required for a record slot (Writer Prose or Copy), refused otherwise. */
  readonly record?: string;
  readonly candidate: string;
  readonly decidedBy: string;
  readonly basis: PinRecord["basis"];
  readonly at: string;
  readonly refs?: readonly Ref[];
  readonly createdBy: Actor;
}

/**
 * Writes the pin/2 (or the pin map record) for one consumer candidate: the candidate must exist with a valid
 * header for this slot (and record), its sha256 is read from the file, and the result must pass the pin rules
 * (pinRecordIssues) before anything is written. Throws with the reason on any refusal; returns the document written.
 */
export function writeTargetPin(root: string, input: TargetPinInput): Pin | PinMap {
  const { agent, slotId } = input;
  const slot = readSlotKind(root, agent, slotId);
  if (slot === undefined) throw new Error(`unknown slot ${agent}/${slotId} (no slot.json)`);
  const file = pinPath(root, agent, slotId);
  const previous = readPinFile(file, { agent, slotId });
  if (previous.kind === "pin/1" || previous.kind === "invalid") throw new Error(`${agent}/${slotId}/pin.json: ${previous.issues.join("; ")}`);
  const recordSlot = previous.kind === "pin-map" || usesPinMap(agent, slot);
  if (recordSlot && input.record === undefined) throw new Error(`${agent}/${slotId} pins per record: name one (${agent}/${slotId}#<record>)`);
  if (!recordSlot && input.record !== undefined) throw new Error(`${agent}/${slotId} has a single pin; it takes no #${input.record}`);
  const parts = parseCandidateName(input.candidate);
  if (!parts) throw new Error(`${input.candidate} is not a candidate file name`);
  if (input.record !== undefined && parts.name !== input.record) throw new Error(`${input.candidate} is not a candidate of record ${input.record}`);
  const path = candidatePath(root, agent, slotId, input.candidate);
  if (!existsSync(path)) throw new Error(`${agent}/${slotId} has no candidate ${input.candidate}`);
  const candidate = readCandidateFile(path, { agent, slotId });
  // A Publisher page/1 or publication/1 record carries no candidate/1 header: recut keeps it as it is, and it is
  // judged by its kind's rules under the slot as stored (slot-current.ts candidateIssues), never by the header rule.
  const record = pageRecordIssues(root, agent, slotId, input.candidate, path) ?? slotBodyIssues(root, agent, slotId, input.candidate, path, candidate.header);
  const issues = record ?? candidate.issues;
  if (issues.length) throw new Error(`${input.candidate}: ${issues.join("; ")}`);
  if (input.record !== undefined && candidate.header?.record !== undefined && candidate.header.record !== input.record) {
    throw new Error(`${input.candidate} header record ${candidate.header!.record} is not ${input.record}`);
  }
  const pinRecord: PinRecord = { candidate: input.candidate, sha256: candidate.sha256, decidedBy: input.decidedBy, basis: input.basis, at: input.at };
  const refs = [...(input.refs ?? [])];
  if (recordSlot) {
    const map = setPinMapRecord(previous.kind === "pin-map" ? previous.doc : undefined, { agent, slotId, record: input.record!, pin: pinRecord, refs, createdBy: input.createdBy, at: input.at })!;
    const mapIssues = pinMapIssues(map, { agent, slotId });
    if (mapIssues.length) throw new Error(mapIssues.join("; "));
    writePinDoc(file, map);
    return map;
  }
  const pin = buildPin({ agent, slotId, record: pinRecord, refs, createdBy: input.createdBy, ...(previous.kind === "pin" ? { previous: previous.doc } : {}) });
  const pinIssueList = pinIssues(pin, { agent, slotId });
  if (pinIssueList.length) throw new Error(pinIssueList.join("; "));
  writePinDoc(file, pin);
  return pin;
}

/**
 * The kind-rule issues of a Publisher `clossys.page/1` or `clossys.publication/1` record under its slot.json, or
 * undefined when the candidate is not such a record (it then goes by its candidate/1 header).
 */
function pageRecordIssues(root: string, agent: AgentId, slotId: SlotId, name: string, path: string): string[] | undefined {
  if (agent !== "publisher" || !name.endsWith(".json")) return undefined;
  const bytes = readFileSync(path, "utf8");
  let schema: unknown;
  try { schema = (JSON.parse(bytes) as { schema?: unknown }).schema; } catch { return undefined; }
  if (schema !== "clossys.page/1" && schema !== "clossys.publication/1") return undefined;
  const slotPath = join(slotDir(root, agent, slotId), "slot.json");
  let read: ReturnType<typeof readSlotValue>;
  try { read = readSlotValue(JSON.parse(readFileSync(slotPath, "utf8")), slotPath); } catch { read = undefined; }
  if (!read) return [`${agent}/${slotId}/slot.json is not a valid slot`];
  return candidateIssues(read, agent, slotId, name, bytes).map(issue => issue.message);
}

/**
 * The kind-rule issues of a slot-body candidate (no `clossys` header: the format the slot/2 candidates verb
 * writes, `writeCandidate` in slot-write.ts) under a clossys.slot/2 slot, or undefined when the file has a header
 * or the slot is not slot/2 (it then goes by its candidate/1 header). These are the rules its submit applied;
 * that it came in through that verb at these bytes is the CHOOSE gate's check (constitution/pin-gate.ts).
 */
function slotBodyIssues(root: string, agent: AgentId, slotId: SlotId, name: string, path: string, header: unknown): string[] | undefined {
  if (header !== undefined) return undefined;
  const slotPath = join(slotDir(root, agent, slotId), "slot.json");
  let value: unknown;
  try { value = JSON.parse(readFileSync(slotPath, "utf8")); } catch { return undefined; }
  if ((value as { schema?: unknown } | null)?.schema !== "clossys.slot/2") return undefined;
  let read: ReturnType<typeof readSlotValue>;
  try { read = readSlotValue(value, slotPath); } catch { read = undefined; }
  if (!read) return undefined;
  // The slot view's kind (copy reads as strings), as the candidates verb judged it.
  return validateCandidate(read.doc.kind, slotId, name, readFileSync(path, "utf8")).map(issue => issue.message);
}

/** The `kind` of a consumer slot.json, "" when it has none, undefined when there is no slot.json. */
function readSlotKind(root: string, agent: AgentId, slotId: SlotId): string | undefined {
  const file = join(slotDir(root, agent, slotId), "slot.json");
  if (!existsSync(file)) return undefined;
  try {
    const kind = (JSON.parse(readFileSync(file, "utf8")) as { kind?: unknown }).kind;
    return typeof kind === "string" ? kind : "";
  } catch { return ""; }
}
