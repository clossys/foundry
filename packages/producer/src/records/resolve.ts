/**
 * Resolution of `<agent>/<slot-id>[#record]` (system.md 8), in this order:
 *
 * 1. The consumer `pin.json` (or the pin map record) when present, valid, and its `sha256` matches the
 *    candidate file bytes.
 * 2. The package default `<name>-v1.<ext>` under the installed package (`src/catalog/defaults/<slot-id>/`,
 *    Producer loops under `loops/<slot-id>/`), basis `package-default`, shown as "sample".
 * 3. Otherwise unresolved (`pins.resolve` fails).
 *
 * A pin that is present but broken (bad schema, missing candidate, digest mismatch) never resolves; resolution
 * continues at step 2 and the result carries `pinIssue`, which `pins.resolve` reports as a failure.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { CANDIDATE_NAME, SLOT_ID, TARGET_AGENTS, candidatePath, isAgentId, packageDefaultDir, parseCandidateName, slotDir } from "./candidate.js";
import { sha256Hex } from "./hash.js";
import { pinPath } from "./pin.js";
import { readPinFile, recordNamesHint, usesPinMap, type PinFile } from "./pin-map.js";
import { modelAlias } from "./slots.js";
import type { AgentId, CandidateName, PinRecord, Sha256, SlotId } from "./types.js";

export type Resolution =
  | {
    readonly state: "pinned"; readonly agent: AgentId; readonly slotId: SlotId; readonly record?: string;
    readonly candidate: CandidateName; readonly file: string; readonly sha256: Sha256;
    readonly pin: PinRecord; readonly status: "pinned" | "confirm";
  }
  | {
    readonly state: "sample"; readonly agent: AgentId; readonly slotId: SlotId; readonly record?: string;
    readonly candidate: CandidateName; readonly file: string; readonly sha256: Sha256;
    readonly basis: "package-default"; readonly pinIssue?: string;
  }
  | { readonly state: "unresolved"; readonly agent: AgentId; readonly slotId: SlotId; readonly record?: string; readonly reason: string; readonly pinIssue?: string };

/** The parsed form of a ref string `<agent>/<slot-id>[/<candidate>|/package:<candidate>][#<record>][:<Key>]` (system.md 5). */
export interface ParsedRef {
  readonly agent: AgentId;
  readonly slotId: SlotId;
  readonly candidate?: CandidateName;
  readonly packageDefault?: boolean;
  readonly record?: string;
  readonly key?: string;
}

const REF_STRING = /^([a-z]+)\/([a-z][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*){1,3})(?:\/(package:)?([a-z0-9][a-z0-9.-]*-v[1-9][0-9]*\.(?:md|json|svg)))?(?:#([a-z0-9][a-z0-9.-]*))?(?::([A-Za-z][A-Za-z0-9 ._-]*))?$/;

/** Parses a ref string; undefined when it is not one. */
export function parseRefString(ref: string): ParsedRef | undefined {
  const match = REF_STRING.exec(ref);
  if (!match || !isAgentId(match[1]!) || !SLOT_ID.test(match[2]!)) return undefined;
  return {
    agent: match[1], slotId: match[2]!,
    ...(match[4] ? { candidate: match[4] } : {}),
    ...(match[3] ? { packageDefault: true } : {}),
    ...(match[5] ? { record: match[5] } : {}),
    ...(match[6] ? { key: match[6] } : {}),
  };
}

/** The slot.json of a consumer slot, parsed, or undefined when absent or not JSON. */
export function readSlotJson(root: string, agent: AgentId, slotId: SlotId): { kind?: string; status?: string } | undefined {
  const file = join(slotDir(root, agent, slotId), "slot.json");
  if (!existsSync(file)) return undefined;
  try { return JSON.parse(readFileSync(file, "utf8")) as { kind?: string; status?: string }; } catch { return undefined; }
}

const isDir = (path: string): boolean => existsSync(path) && statSync(path).isDirectory();

/** Every consumer slot folder (one holding slot.json), by agent then id. */
export function listConsumerSlots(root: string): { agent: AgentId; slotId: SlotId }[] {
  const out: { agent: AgentId; slotId: SlotId }[] = [];
  for (const agent of TARGET_AGENTS) {
    const dir = join(root, "clossys", "agents", agent);
    if (!isDir(dir)) continue;
    for (const slotId of readdirSync(dir).sort()) {
      if (SLOT_ID.test(slotId) && existsSync(join(dir, slotId, "slot.json"))) out.push({ agent, slotId });
    }
  }
  return out;
}

/** Consumer candidate file names of a slot, sorted. */
export function consumerCandidates(root: string, agent: AgentId, slotId: SlotId): CandidateName[] {
  const dir = join(slotDir(root, agent, slotId), "candidates");
  return isDir(dir) ? readdirSync(dir).filter(name => CANDIDATE_NAME.test(name)).sort() : [];
}

/** Package default file names (`<name>-v1.<ext>`) of a slot as installed, sorted. */
export function packageDefaults(root: string, agent: AgentId, slotId: SlotId): CandidateName[] {
  const dir = packageDefaultDir(root, agent, slotId);
  return isDir(dir) ? readdirSync(dir).filter(name => parseCandidateName(name)?.version === 1).sort() : [];
}

/** Whether a slot pins per record (a Writer Prose or Copy slot, or one whose pin.json is already a map). */
export function isRecordSlot(root: string, agent: AgentId, slotId: SlotId, pin?: PinFile): boolean {
  const file = pin ?? readPinFile(pinPath(root, agent, slotId));
  return file.kind === "pin-map" || usesPinMap(agent, readSlotJson(root, agent, slotId)?.kind);
}

/** Every record key a record slot knows: pin map keys, consumer candidate names and package default names. */
export function slotRecords(root: string, agent: AgentId, slotId: SlotId): string[] {
  const records = new Set<string>();
  const pin = readPinFile(pinPath(root, agent, slotId));
  if (pin.kind === "pin-map") for (const key of Object.keys(pin.doc.records)) records.add(key);
  for (const name of [...consumerCandidates(root, agent, slotId), ...packageDefaults(root, agent, slotId)]) records.add(parseCandidateName(name)!.name);
  return [...records].sort();
}

function fromPin(root: string, agent: AgentId, slotId: SlotId, record: string | undefined, pinFile: PinFile): { pin: PinRecord; status: "pinned" | "confirm" } | { issue: string } | undefined {
  if (pinFile.kind === "none") return undefined;
  if (pinFile.kind === "invalid" || pinFile.kind === "pin/1") return { issue: pinFile.issues.join("; ") };
  if (pinFile.issues.length) return { issue: pinFile.issues.join("; ") };
  if (pinFile.kind === "pin") {
    if (record !== undefined) return { issue: `${agent}/${slotId} has a single pin, not a pin map with record ${record}` };
    return { pin: pinFile.doc, status: pinFile.doc.status };
  }
  if (record === undefined) return { issue: `${agent}/${slotId} pins per record: name one (#<record>); ${recordNamesHint(root, agent, slotId, slotRecords(root, agent, slotId))}` };
  const pin = pinFile.doc.records[record];
  if (!pin) return undefined;
  return { pin, status: pin.basis === "picked" || pin.confirmed ? "pinned" : "confirm" };
}

/** Resolves one slot (or one record of a record slot) by the two-step order. Never throws on bad data. */
export function resolveSlot(root: string, agent: AgentId, slotId: SlotId, record?: string): Resolution {
  const base = { agent, slotId, ...(record !== undefined ? { record } : {}) };
  // The model reader (records/slots.ts) refuses aliases; so does the resolver, or a pin it cannot judge would ship.
  const pinned = modelAlias(pinPath(root, agent, slotId))
    ? { issue: `${agent}/${slotId} pin.json is a symbolic link, or sits under one: aliases are not followed` }
    : fromPin(root, agent, slotId, record, readPinFile(pinPath(root, agent, slotId), { agent, slotId }));
  let pinIssue: string | undefined;
  if (pinned && "issue" in pinned) pinIssue = pinned.issue;
  else if (pinned) {
    const file = candidatePath(root, agent, slotId, pinned.pin.candidate);
    if (modelAlias(file)) pinIssue = `pin names ${pinned.pin.candidate}, which is a symbolic link, or sits under one: aliases are not followed`;
    else if (!existsSync(file)) pinIssue = `pin names ${pinned.pin.candidate}, which is not in ${agent}/${slotId}/candidates/`;
    else {
      const sha256 = sha256Hex(readFileSync(file));
      if (sha256 !== pinned.pin.sha256) pinIssue = `pin sha256 ${pinned.pin.sha256.slice(0, 12)} does not match ${pinned.pin.candidate} (${sha256.slice(0, 12)}): the candidate changed after it was pinned`;
      else return { state: "pinned", ...base, candidate: pinned.pin.candidate, file, sha256, pin: pinned.pin, status: pinned.status };
    }
  }
  const extra = pinIssue !== undefined ? { pinIssue } : {};
  const defaults = packageDefaults(root, agent, slotId).filter(name => record === undefined || parseCandidateName(name)!.name === record);
  if (defaults.length === 1) {
    const file = join(packageDefaultDir(root, agent, slotId), defaults[0]!);
    return { state: "sample", ...base, candidate: defaults[0]!, file, sha256: sha256Hex(readFileSync(file)), basis: "package-default", ...extra };
  }
  if (defaults.length > 1) return { state: "unresolved", ...base, reason: `${defaults.length} package defaults (${defaults.join(", ")}): name a record`, ...extra };
  return { state: "unresolved", ...base, reason: pinIssue ?? "no pin and no package default", ...extra };
}

/** Resolves a ref string (`designer/sections.hero`, `writer/sections.hero.copy#home.hero`). */
export function resolveRef(root: string, ref: string): Resolution | { readonly state: "invalid"; readonly reason: string } {
  const parsed = parseRefString(ref);
  if (!parsed) return { state: "invalid", reason: `${ref} is not a ref (<agent>/<slot-id>[#<record>])` };
  if (parsed.candidate) return { state: "invalid", reason: `${ref} names a candidate; resolve takes a slot or a record` };
  return resolveSlot(root, parsed.agent, parsed.slotId, parsed.record);
}
