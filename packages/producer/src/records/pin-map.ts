/**
 * Writer pin maps (system.md 3 row 5, 4; writer.md 9): `clossys.pin-map/1`, one pin record per record key
 * for Writer Prose and Copy slots, in the slot's `pin.json`. Each record follows the same rules as a pin
 * (pin.ts pinRecordIssues) against the map's `refs`. This module also reads a slot's `pin.json` in either shape.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { candidatePath, parseCandidateName, readCandidateFile, slotDir, targetSchema } from "./candidate.js";
import { buildPin, pinIssues, pinPath, pinRecordIssues, pinRecordStatus, writePinDoc, type Pin1Doc } from "./pin.js";
import { validateAgainst } from "./schema.js";
import type { Actor, AgentId, Pin, PinMap, PinRecord, Ref, SlotId, TargetSlotKind } from "./types.js";

/** Writer slot kinds whose pin is a map keyed by record (Voice keeps a single pin). */
export const PIN_MAP_KINDS: readonly TargetSlotKind[] = ["prose", "copy"];
export const usesPinMap = (agent: AgentId, kind: string | undefined): boolean =>
  agent === "writer" && kind !== undefined && (PIN_MAP_KINDS as readonly string[]).includes(kind);

/** Every issue of a `clossys.pin-map/1` document, expected at `<agent>/<slot-id>`. */
export function pinMapIssues(doc: unknown, expect?: { agent: AgentId; slotId: SlotId }): string[] {
  const issues = validateAgainst(targetSchema("pin-map"), doc).map(issue => `pin-map ${issue.path}: ${issue.message}`);
  if (issues.length) return issues;
  const map = doc as PinMap;
  if (expect) {
    if (map.agent !== expect.agent) issues.push(`pin-map agent ${map.agent} is not ${expect.agent}`);
    if (map.id !== `${expect.agent}/${expect.slotId}/pin`) issues.push(`pin-map id ${map.id} is not ${expect.agent}/${expect.slotId}/pin`);
  }
  for (const [record, pin] of Object.entries(map.records)) {
    if (parseCandidateName(pin.candidate)?.name !== record) issues.push(`pin-map record ${record}: candidate ${pin.candidate} is not a file of record ${record} (<record>-v<n>)`);
    issues.push(...pinRecordIssues(pin, map.refs, `pin-map record ${record}`));
  }
  return issues;
}

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
  if (candidate.issues.length) throw new Error(`${input.candidate}: ${candidate.issues.join("; ")}`);
  if (input.record !== undefined && candidate.header!.record !== undefined && candidate.header!.record !== input.record) {
    throw new Error(`${input.candidate} header record ${candidate.header!.record} is not ${input.record}`);
  }
  const record: PinRecord = { candidate: input.candidate, sha256: candidate.sha256, decidedBy: input.decidedBy, basis: input.basis, at: input.at };
  const refs = [...(input.refs ?? [])];
  if (recordSlot) {
    const map = setPinMapRecord(previous.kind === "pin-map" ? previous.doc : undefined, { agent, slotId, record: input.record!, pin: record, refs, createdBy: input.createdBy, at: input.at })!;
    const issues = pinMapIssues(map, { agent, slotId });
    if (issues.length) throw new Error(issues.join("; "));
    writePinDoc(file, map);
    return map;
  }
  const pin = buildPin({ agent, slotId, record, refs, createdBy: input.createdBy, ...(previous.kind === "pin" ? { previous: previous.doc } : {}) });
  const issues = pinIssues(pin, { agent, slotId });
  if (issues.length) throw new Error(issues.join("; "));
  writePinDoc(file, pin);
  return pin;
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
