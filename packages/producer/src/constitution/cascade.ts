/**
 * The cascade by certification key (R07.5, foundry-build-0048 U6 CASCADE). A pinned candidate's verdict holds for the
 * pinSet it was given on (certify/index.ts pinSetOf: the pins of everything the candidate reads, through the slot's
 * `inputs`/`uses`, its fixture inputs, its `@/` imports, a page's frame, sections and copy, a brief's citations). A
 * repin upstream changes that pinSet, and the verdict no longer holds until the candidate is judged again.
 *
 * Where a verdict is recorded:
 * - the pin's scorecard (`clossys/.state/checks/<agent>/<slot>/scorecard.json`, pin-gate.ts), whose row for the pinned
 *   candidate carries the pinSet the pin gate judged it on;
 * - a re-verdict (`clossys/.state/checks/<agent>/<slot>/cascade.json`, `clossys.reverdict/1`), which loop.cascade writes
 *   when it judges the pinned candidate again. It is read before the scorecard; a new pin clears it.
 *
 * Each pinned candidate is then
 * - `fresh`: its recorded pinSet is the pinSet now and the verdict passed;
 * - `stale`: its recorded pinSet is not the pinSet now (a repin upstream nobody re-verdicted);
 * - `failed`: judged on the pinSet now and not certified;
 * - `legacy`: no recorded pinSet (a pin from before the pin gate recorded one). loop.cascade marks a legacy
 *   dependant needs-refresh when its upstream repins, as before; R07.5 does not report it.
 *
 * R07.5 reports every stale or failed pin on a slot not marked `needs-refresh`: either the cascade did not run
 * after a repin, or it ran and the slot was not flagged. Release refuses any `needs-refresh` slot (release/gates.ts).
 */
import { refuseLegacyState, statePath } from "../engine/state-dir.js";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { certify, certifyEnv, pinSetOf, type CertifyEnv } from "./certify/index.js";
import { pinnedOf, pinnedRecordsOf } from "./certify/env.js";
import type { Reason } from "./certify/types.js";
import { focusedLiveSlots, isObject, row } from "./checks/shared.js";
import { submitOf } from "./rules/r03.js";
import type { CandidateRecord, ConstitutionContext, Row, SlotRecord } from "./types.js";

export const REVERDICT_SCHEMA = "clossys.reverdict/1";
/** The finding check loop.cascade routes a failed re-verdict under. */
export const CASCADE_REVERDICT = "cascade.reverdict";
export const NEEDS_REFRESH = "needs-refresh";

export interface PinVerdict {
  readonly candidate: string;
  readonly sha256: string;
  /** The pin-map record the candidate is pinned for (a Writer copy slot), if any. */
  readonly record?: string;
  readonly pinSet: string;
  readonly certified: boolean;
  readonly reasons: readonly Reason[];
}
export interface Reverdict {
  readonly schema: typeof REVERDICT_SCHEMA;
  readonly slot: string;
  readonly at: string;
  /** The slot whose repin started the cascade, when one did. */
  readonly cause?: string;
  readonly verdicts: readonly PinVerdict[];
}

export type PinState = "fresh" | "stale" | "failed" | "legacy";
export interface PinCheck {
  readonly slot: SlotRecord;
  readonly candidate: CandidateRecord;
  readonly record?: string;
  readonly state: PinState;
  /** The pinSet the recorded verdict was given on (absent: legacy). */
  readonly recorded?: string;
  readonly current: string;
  /** Where the recorded verdict is. */
  readonly from?: "cascade" | "scorecard";
  /** Legacy only: a verdict is recorded for this candidate name on other bytes (the file changed after it was judged). */
  readonly bytesChanged?: true;
}

const checksDir = (root: string, agent: string, slotId: string) => statePath(root, "checks", agent, slotId);
export const reverdictPath = (root: string, agent: string, slotId: string) => join(checksDir(root, agent, slotId), "cascade.json");
export const scorecardPath = (root: string, agent: string, slotId: string) => join(checksDir(root, agent, slotId), "scorecard.json");

function readJson(file: string): Record<string, unknown> | undefined {
  if (!existsSync(file)) return undefined;
  try { const value = JSON.parse(readFileSync(file, "utf8")) as unknown; return isObject(value) ? value : undefined; } catch { return undefined; }
}

export function readReverdict(root: string, agent: string, slotId: string): Reverdict | undefined {
  const doc = readJson(reverdictPath(root, agent, slotId));
  return doc?.schema === REVERDICT_SCHEMA && Array.isArray(doc.verdicts) ? doc as unknown as Reverdict : undefined;
}

export function writeReverdict(root: string, agent: string, slotId: string, doc: Reverdict): string {
  refuseLegacyState(root);
  mkdirSync(checksDir(root, agent, slotId), { recursive: true });
  const file = reverdictPath(root, agent, slotId);
  writeFileSync(file, `${JSON.stringify(doc, null, 2)}\n`);
  return file;
}

/** A new pin supersedes every re-verdict of the slot: its scorecard holds the verdict the pin gate gave. */
export function clearReverdict(root: string, agent: string, slotId: string): void {
  rmSync(reverdictPath(root, agent, slotId), { force: true });
}

/** The slot's status as stored (a slot/2 `status`), if any. */
export function slotStatus(slot: Pick<SlotRecord, "slot">): string | undefined {
  const value = slot.slot?.value;
  return isObject(value) && typeof value.status === "string" ? value.status : undefined;
}

/** The verdict recorded for a pinned candidate: its re-verdict, else its scorecard row (pinSet recorded only). */
export function recordedVerdict(root: string, slot: Pick<SlotRecord, "agent" | "id">, candidate: Pick<CandidateRecord, "name" | "sha256">): { pinSet: string; certified: boolean; from: "cascade" | "scorecard" } | undefined {
  const same = (item: unknown): item is { pinSet: string; certified: boolean } =>
    isObject(item) && item.candidate === candidate.name && item.sha256 === candidate.sha256 && typeof item.pinSet === "string" && typeof item.certified === "boolean";
  const reverdict = readReverdict(root, slot.agent, slot.id)?.verdicts.find(same);
  if (reverdict) return { pinSet: reverdict.pinSet, certified: reverdict.certified, from: "cascade" };
  const scorecard = readJson(scorecardPath(root, slot.agent, slot.id));
  const rows = Array.isArray(scorecard?.candidates) ? scorecard!.candidates as unknown[] : [];
  const scored = rows.find(same);
  return scored ? { pinSet: scored.pinSet, certified: scored.certified, from: "scorecard" } : undefined;
}

/** Whether a verdict is recorded for the candidate's name with a different sha256: its bytes changed after the verdict. */
export function verdictOnOtherBytes(root: string, slot: Pick<SlotRecord, "agent" | "id">, candidate: Pick<CandidateRecord, "name" | "sha256">): boolean {
  const scorecard = readJson(scorecardPath(root, slot.agent, slot.id));
  const rows = [...(readReverdict(root, slot.agent, slot.id)?.verdicts ?? []), ...(Array.isArray(scorecard?.candidates) ? scorecard!.candidates as unknown[] : [])];
  return rows.some(item => isObject(item) && item.candidate === candidate.name && typeof item.sha256 === "string" && item.sha256 !== candidate.sha256);
}

/** The pinned candidates of a slot: its single pin, or each record of its pin map. */
export function pinnedEntries(slot: SlotRecord): { candidate: CandidateRecord; record?: string }[] {
  const single = pinnedOf(slot);
  if (single) return [{ candidate: single }];
  return [...pinnedRecordsOf(slot)].map(([record, candidate]) => ({ candidate, record }));
}

/** Every pinned candidate of `slots` (default: the live slots in focus), judged against its recorded verdict. */
export function pinChecks(ctx: ConstitutionContext, env: CertifyEnv = certifyEnv(ctx), slots: Iterable<SlotRecord> = focusedLiveSlots(ctx)): PinCheck[] {
  const out: PinCheck[] = [];
  for (const slot of slots) {
    if (slot.agent === "producer") continue;
    for (const { candidate, record } of pinnedEntries(slot)) {
      const current = pinSetOf({ slot, candidate }, env);
      const recorded = recordedVerdict(ctx.root, slot, candidate);
      const state: PinState = !recorded ? "legacy" : recorded.pinSet !== current ? "stale" : recorded.certified ? "fresh" : "failed";
      const bytesChanged = !recorded && verdictOnOtherBytes(ctx.root, slot, candidate);
      out.push({ slot, candidate, ...(record !== undefined ? { record } : {}), state, current, ...(recorded ? { recorded: recorded.pinSet, from: recorded.from } : {}), ...(bytesChanged ? { bytesChanged: true as const } : {}) });
    }
  }
  return out;
}

/** Re-judges one pinned candidate on the pinSet now. */
export function reverdictOf(check: Pick<PinCheck, "slot" | "candidate" | "record">, env: CertifyEnv): PinVerdict {
  const pinSet = pinSetOf({ slot: check.slot, candidate: check.candidate }, env);
  const { certified, reasons } = certify({ slot: check.slot, candidate: check.candidate }, env, pinSet);
  return { candidate: check.candidate.name, sha256: check.candidate.sha256, ...(check.record !== undefined ? { record: check.record } : {}), pinSet, certified, reasons };
}

/** The other submitted candidates of a slot that certify on the pinSet now: CHOOSE can repin one of them. */
export function certifiedAlternatives(slot: SlotRecord, pinned: readonly string[], env: CertifyEnv): string[] {
  return slot.candidates.filter(candidate => {
    if (pinned.includes(candidate.name)) return false;
    const { submit } = submitOf(slot, candidate.name);
    return !!submit && submit.sha256 === candidate.sha256 && certify({ slot, candidate }, env).certified;
  }).map(candidate => candidate.name);
}

/** R07.5: a stale or failed pin on a slot not marked needs-refresh. */
export function staleRows(ctx: ConstitutionContext): Row[] {
  const rows: Row[] = [];
  for (const check of pinChecks(ctx)) {
    if (check.state !== "stale" && check.state !== "failed") continue;
    if (slotStatus(check.slot) === NEEDS_REFRESH) continue;
    const pin = check.slot.pin?.path ?? check.slot.dir;
    const what = check.state === "stale"
      ? `pinned ${check.candidate.name}${check.record ? ` (#${check.record})` : ""} was judged on pinSet ${check.recorded!.slice(0, 12)}, not the pinSet now ${check.current.slice(0, 12)}: a repin upstream was not re-verdicted (run clossys run loop.cascade)`
      : `pinned ${check.candidate.name}${check.record ? ` (#${check.record})` : ""} fails its re-verdict on the pinSet now, but the slot is not marked needs-refresh`;
    rows.push(row("R07", "R07.5", check.slot, what, pin, check.candidate.name));
  }
  return rows;
}
