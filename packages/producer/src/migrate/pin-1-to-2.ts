/**
 * Migration `pin-1-to-2`: int2 pins (`{candidate, sha256, decidedBy, basis, at, confirmed?}`, no schema key) to
 * `clossys.pin/2` (system.md 6.3, 10), or to a `clossys.pin-map/1` record for a Writer Prose or Copy slot.
 *
 * Deterministic and idempotent: the output depends only on the pin/1 file and the slot kind (`createdAt` and
 * `updatedAt` are the pin's own `at`; `createdBy` is this migration with the installed Producer version), and a
 * pin that is already pin/2 or a pin map is never rewritten, so a second run writes nothing.
 *
 * Field mapping (KEEP names; nothing is invented):
 * - `candidate`, `sha256`, `basis` unchanged;
 * - `decidedBy`: `owner[:ref]`, `planner[:ref]`, `agent:<agent>` and `migrated` unchanged; int2 `migration[:ref]`
 *   becomes `migrated`; anything else is refused;
 * - `at` and `confirmed.at` normalized to UTC `...Z`; `confirmed.by` `owner:<ref>` becomes `owner` (its ref is
 *   already in `confirmed.ref`);
 * - `refs`: an `answers` ref only when decidedBy itself names the queue entry (`owner:queue.<kind>#<id>`).
 *
 * An owner basis (`picked`, `bulk`) is never given a queue answer it does not have: such a pin migrates as it is
 * and is listed in `needsOwnerAnswer`; `pins.resolve` keeps failing it until the owner answers.
 */
import { AGENT_LISTS } from "../agent-lists.generated.js";
import { CANDIDATE_NAME, parseCandidateName } from "../records/candidate.js";
import { buildPin, cliActor, OWNER_BASES, ownerAnswerRef, pinPath, pinRecordIssues, toIsoZ, writePinDoc, type Pin1Doc } from "../records/pin.js";
import { readPinFile, setPinMapRecord, usesPinMap } from "../records/pin-map.js";
import { listConsumerSlots, readSlotJson } from "../records/resolve.js";
import type { AgentId, Pin, PinMap, PinRecord, Ref, SlotId } from "../records/types.js";

export const PIN_MIGRATION = "pin-1-to-2";
const MIGRATION_CLI = `clossys migrate ${PIN_MIGRATION}`;
const DECIDED_BY_2 = new RegExp(String.raw`^(owner(:.+)?|planner(:.+)?|agent:(${AGENT_LISTS.live.join("|")})|migrated)$`);
const BASES = ["picked", "bulk", "planner", "agent"] as const;

export type PinConversion =
  | { readonly ok: true; readonly record: PinRecord; readonly refs: Ref[] }
  | { readonly ok: false; readonly issues: readonly string[] };

/** Converts one pin/1 document into a pin/2 record and its refs; refuses what pin/2 cannot hold. */
export function convertPin1(doc: Pin1Doc): PinConversion {
  const issues: string[] = [];
  if (typeof doc.candidate !== "string" || !CANDIDATE_NAME.test(doc.candidate)) issues.push(`candidate ${String(doc.candidate)} is not a candidate file name`);
  if (typeof doc.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(doc.sha256)) issues.push("sha256 is not 64 lowercase hex");
  if (!(BASES as readonly string[]).includes(doc.basis)) issues.push(`basis ${String(doc.basis)} is not picked, bulk, planner or agent`);
  const decidedBy = typeof doc.decidedBy === "string" && /^migration(:|$)/.test(doc.decidedBy) ? "migrated" : doc.decidedBy;
  if (typeof decidedBy !== "string" || !DECIDED_BY_2.test(decidedBy)) issues.push(`decidedBy ${String(doc.decidedBy)} has no pin/2 form`);
  const at = typeof doc.at === "string" ? toIsoZ(doc.at) : undefined;
  if (!at) issues.push(`at ${String(doc.at)} is not a timestamp`);
  let confirmed: PinRecord["confirmed"];
  if (doc.confirmed !== undefined) {
    const by = doc.confirmed.by, confirmedAt = typeof doc.confirmed.at === "string" ? toIsoZ(doc.confirmed.at) : undefined;
    if (typeof by !== "string" || !/^owner(:|$)/.test(by)) issues.push(`confirmed.by ${String(by)} is not the owner`);
    if (typeof doc.confirmed.ref !== "string" || !doc.confirmed.ref.trim()) issues.push("confirmed.ref is empty");
    if (!confirmedAt) issues.push(`confirmed.at ${String(doc.confirmed.at)} is not a timestamp`);
    if (!issues.length) confirmed = { by: "owner", ref: doc.confirmed.ref, at: confirmedAt! };
  }
  if (issues.length) return { ok: false, issues };
  const record: PinRecord = {
    candidate: doc.candidate, sha256: doc.sha256, decidedBy, basis: doc.basis as PinRecord["basis"], at: at!,
    ...(confirmed ? { confirmed } : {}),
  };
  const answer = ownerAnswerRef(decidedBy);
  return { ok: true, record, refs: answer ? [answer] : [] };
}

/** The pin/2 (or pin map) document one pin/1 file becomes; pure. */
export function migratePinDoc(doc: Pin1Doc, slot: { agent: AgentId; slotId: SlotId; kind?: string }): { ok: true; doc: Pin | PinMap } | { ok: false; issues: readonly string[] } {
  const converted = convertPin1(doc);
  if (!converted.ok) return converted;
  const createdBy = cliActor(MIGRATION_CLI);
  if (usesPinMap(slot.agent, slot.kind)) {
    const record = parseCandidateName(converted.record.candidate)!.name;
    const map = setPinMapRecord(undefined, { agent: slot.agent, slotId: slot.slotId, record, pin: converted.record, refs: converted.refs, createdBy, at: converted.record.at });
    return { ok: true, doc: map! };
  }
  return { ok: true, doc: buildPin({ agent: slot.agent, slotId: slot.slotId, record: converted.record, refs: converted.refs, createdBy }) };
}

export interface PinMigrationRow {
  readonly slot: string;
  readonly outcome: "migrated" | "already-2" | "refused";
  readonly issues?: readonly string[];
}

export interface PinMigrationReport {
  readonly migration: typeof PIN_MIGRATION;
  readonly rows: readonly PinMigrationRow[];
  readonly written: number;
  /** Owner-basis pins that carry no queue answer ref: migrated as they are, still failing pins.resolve. */
  readonly needsOwnerAnswer: readonly string[];
}

/** Migrates every pin/1 under `<root>/clossys/agents/`; `dryRun` plans without writing. */
export function migratePins(root: string, options: { readonly dryRun?: boolean } = {}): PinMigrationReport {
  const rows: PinMigrationRow[] = [];
  const needsOwnerAnswer: string[] = [];
  let written = 0;
  for (const { agent, slotId } of listConsumerSlots(root)) {
    const file = pinPath(root, agent, slotId);
    const pin = readPinFile(file);
    const slot = `${agent}/${slotId}`;
    if (pin.kind === "none") continue;
    if (pin.kind === "pin" || pin.kind === "pin-map") { rows.push({ slot, outcome: "already-2" }); continue; }
    if (pin.kind === "invalid") { rows.push({ slot, outcome: "refused", issues: pin.issues }); continue; }
    const result = migratePinDoc(pin.doc, { agent, slotId, kind: readSlotJson(root, agent, slotId)?.kind });
    if (!result.ok) { rows.push({ slot, outcome: "refused", issues: result.issues }); continue; }
    const records = result.doc.kind === "pin-map" ? Object.values(result.doc.records) : [result.doc];
    if (records.some(record => OWNER_BASES.includes(record.basis) && pinRecordIssues(record, result.doc.refs).some(issue => issue.includes("no answers ref")))) {
      needsOwnerAnswer.push(slot);
    }
    if (!options.dryRun) { writePinDoc(file, result.doc); written++; }
    rows.push({ slot, outcome: "migrated" });
  }
  return { migration: PIN_MIGRATION, rows, written, needsOwnerAnswer };
}
