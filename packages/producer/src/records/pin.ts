/**
 * Target pins (system.md 4, 6.3, 7, 8): `clossys.pin/2`, one pointer per slot at one candidate by content hash.
 *
 * KEEP from int2: `candidate`, `sha256`, `decidedBy`, `basis`, `at`, `confirmed`. NEW: the COMMON block.
 * A pin is replaced in place and only ever written by the CLI. `package-default` is never written: it is the
 * absence of a pin (resolve.ts step 2).
 *
 * Rules a schema cannot state, shared with pin-map records (pinRecordIssues):
 * - basis `agent` iff decidedBy `agent:<id>`; basis `planner` iff decidedBy `planner[:<ref>]`;
 * - basis `picked` or `bulk` is the owner's: decidedBy `owner[:<ref>]` (or `migrated`), and the pin carries an
 *   `answers` ref to the queue entry that holds the owner's answer. An owner basis is never invented: a
 *   migrated pin keeps decidedBy `migrated` instead;
 * - `confirmed` only on a basis `agent` pick.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ISO, slotDir, targetSchema } from "./candidate.js";
import { validateAgainst } from "./schema.js";
import type { Actor, AgentId, Iso, Pin, PinMap, PinRecord, Ref, SlotId } from "./types.js";

export const PIN_FILE = "pin.json";
export type PinBasis2 = PinRecord["basis"];
export const PIN2_BASES: readonly PinBasis2[] = ["picked", "bulk", "planner", "agent"];
export const OWNER_BASES: readonly PinBasis2[] = ["picked", "bulk"];

/** `owner:queue.<kind>#<entry-id>`: the owner's answer to one queue entry (flows.md N10). */
export const OWNER_QUEUE_ANSWER = /^owner:(queue\.(?:pick|approve|clarify|fix))#([0-9]{8}T[0-9]{4}Z-[a-z0-9][a-z0-9-]*)$/;

/** The int2 pin (`clossys.pin/1` in migrate/pin-1-to-2.ts): the same five fields and `confirmed`, no COMMON block. */
export interface Pin1Doc {
  readonly candidate: string;
  readonly sha256: string;
  readonly decidedBy: string;
  readonly basis: string;
  readonly at: string;
  readonly confirmed?: { readonly by: string; readonly ref: string; readonly at: string };
}

const PRODUCER_PACKAGE_JSON = fileURLToPath(new URL("../../package.json", import.meta.url));

/** The `createdBy` of a pin the CLI writes: this Producer package's installed version (system.md 14.6). */
export function cliActor(cli: string): Extract<Actor, { actor: "code" }> {
  const version = (JSON.parse(readFileSync(PRODUCER_PACKAGE_JSON, "utf8")) as { version: string }).version;
  return { actor: "code", cli, version };
}

export const pinPath = (root: string, agent: AgentId, slotId: SlotId): string => join(slotDir(root, agent, slotId), PIN_FILE);

/** `pinned` for an owner pick or a confirmed pick; anything else waits for the owner (`confirm`). */
export function pinRecordStatus(record: Pick<PinRecord, "basis" | "confirmed">): Pin["status"] {
  return record.basis === "picked" || record.confirmed ? "pinned" : "confirm";
}

/** The queue `answers` ref named by an `owner:queue.<kind>#<id>` decider, if it is one. */
export function ownerAnswerRef(decidedBy: string): Ref | undefined {
  const match = OWNER_QUEUE_ANSWER.exec(decidedBy);
  return match ? { to: `producer/${match[1]}`, record: match[2]!, rel: "answers" } : undefined;
}

const isQueueAnswer = (ref: Ref): boolean => ref.rel === "answers" && /^producer\/queue\.[a-z]+$/.test(ref.to) && typeof ref.record === "string" && ref.record.length > 0;

/** The pairing and provenance rules of one pin record (a pin, or one record of a pin map); `refs` are the file's refs. */
export function pinRecordIssues(record: PinRecord, refs: readonly Ref[], where = "pin"): string[] {
  const issues: string[] = [];
  const by = record.decidedBy;
  if (record.basis === "agent" && !/^agent:/.test(by)) issues.push(`${where}: basis agent needs decidedBy agent:<id>, got ${by}`);
  if (record.basis !== "agent" && /^agent:/.test(by)) issues.push(`${where}: decidedBy ${by} is an agent pick, so its basis is agent, not ${record.basis}`);
  if (record.basis === "planner" && !/^planner(:|$)/.test(by)) issues.push(`${where}: basis planner needs decidedBy planner[:<ref>], got ${by}`);
  if (record.basis !== "planner" && /^planner(:|$)/.test(by)) issues.push(`${where}: decidedBy ${by} is a planner pin, so its basis is planner, not ${record.basis}`);
  if (OWNER_BASES.includes(record.basis)) {
    if (by !== "migrated" && !/^owner(:|$)/.test(by)) issues.push(`${where}: basis ${record.basis} is the owner's, but decidedBy is ${by}`);
    if (/^owner(:|$)/.test(by)) {
      const answers = refs.filter(isQueueAnswer);
      if (answers.length === 0) issues.push(`${where}: basis ${record.basis} (decidedBy ${by}) has no answers ref to the queue entry holding the owner's answer`);
      const named = ownerAnswerRef(by);
      if (named && answers.length && !answers.some(ref => ref.to === named.to && ref.record === named.record)) {
        issues.push(`${where}: decidedBy ${by} names ${named.to}#${named.record}, which no answers ref lists`);
      }
    }
  }
  if (record.confirmed && record.basis !== "agent") issues.push(`${where}: confirmed is only for a basis agent pick, not ${record.basis}`);
  if (record.confirmed && Date.parse(record.confirmed.at) < Date.parse(record.at)) issues.push(`${where}: confirmed.at is before the pick (${record.at})`);
  return issues;
}

/** Every issue of a `clossys.pin/2` document, expected at `<agent>/<slot-id>`. */
export function pinIssues(doc: unknown, expect?: { agent: AgentId; slotId: SlotId }): string[] {
  const issues = validateAgainst(targetSchema("pin"), doc).map(issue => `pin ${issue.path}: ${issue.message}`);
  if (issues.length) return issues;
  const pin = doc as Pin;
  if (expect) {
    if (pin.agent !== expect.agent) issues.push(`pin agent ${pin.agent} is not ${expect.agent}`);
    if (pin.id !== `${expect.agent}/${expect.slotId}/pin`) issues.push(`pin id ${pin.id} is not ${expect.agent}/${expect.slotId}/pin`);
  }
  return [...issues, ...pinRecordIssues(pin, pin.refs)];
}

export interface NewPin {
  readonly agent: AgentId;
  readonly slotId: SlotId;
  readonly record: PinRecord;
  readonly refs?: readonly Ref[];
  readonly createdBy: Actor;
  /** The pin it replaces: its createdAt is kept (a pin is replaced in place). */
  readonly previous?: Pick<Pin, "createdAt">;
}

/** A complete `clossys.pin/2` document, in schema key order. */
export function buildPin(input: NewPin): Pin {
  const { record } = input;
  return {
    schema: "clossys.pin/2",
    id: `${input.agent}/${input.slotId}/pin`,
    agent: input.agent,
    kind: "pin",
    status: pinRecordStatus(record),
    createdBy: input.createdBy,
    createdAt: input.previous?.createdAt ?? record.at,
    updatedAt: record.at,
    refs: [...(input.refs ?? [])],
    candidate: record.candidate,
    sha256: record.sha256,
    decidedBy: record.decidedBy,
    basis: record.basis,
    at: record.at,
    ...(record.confirmed ? { confirmed: record.confirmed } : {}),
  };
}

/** Writes a pin or pin map document atomically (temp file, then rename). */
export function writePinDoc(file: string, doc: Pin | PinMap): void {
  mkdirSync(dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify(doc, null, 2)}\n`);
  renameSync(temp, file);
}

/** Normalizes a timestamp to the target `...Z` form; undefined when it is not a date. */
export function toIsoZ(value: string): Iso | undefined {
  if (ISO.test(value) && !/\.0+Z$/.test(value)) return value;
  const ms = Date.parse(value);
  if (!/^\d{4}-\d{2}-\d{2}T/.test(value) || Number.isNaN(ms)) return undefined;
  return new Date(ms).toISOString().replace(/\.000Z$/, "Z");
}

