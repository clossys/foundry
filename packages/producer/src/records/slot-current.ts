/**
 * The current slot format (`clossys.slot/2`) as the slot-model reader and `clossys check` see it
 * (foundry-build-0031). A slot/2 document is validated against schemas/slot.json and read through a view
 * with the reader's own terms: its kind family, the slot ids its `input` and `uses` refs name, its
 * `contract.notNeeded` marker, and whether its slash-path `ia` is the one its ia.json position names.
 * `clossys check` judges the current format only: a `clossys.slot/1` file is one finding that names
 * `clossys migrate recut`.
 */
import { candidateHeaderIssues, parseCandidateName } from "./candidate.js";
import { positionIa, sameJson, SLOT_SCHEMA, SLOT_V1_SCHEMA, validateSlot } from "./slot.js";
import type { AgentId, Slot, SlotId, TargetSlotKind } from "./types.js";
import { notNeededIssue, validateCandidate, validateSlotDoc, type SlotModelIssue } from "./slot-model/validate.js";
import { PAGE_SCHEMA, type ModelAgent, type NotNeeded, type SlotDoc, type SlotKind, type SlotPosition } from "./slot-model/types.js";

/** The finding `clossys check` gives a slot.json still in the old format. */
export const OLD_SLOT_FORMAT = `slot.json is ${SLOT_V1_SCHEMA}, an old format: run clossys migrate recut`;

/** The reader's kind family of each current kind (loop, queue and ledger are Producer kinds the reader does not hold). */
const FAMILY: Readonly<Partial<Record<TargetSlotKind, SlotKind>>> = {
  brief: "brief",
  "element/token": "element", "element/asset": "element", "element/component": "element", "element/section": "element", "element/frame": "element",
  voice: "strings", prose: "strings", copy: "strings",
  page: "page", layout: "page", chrome: "page", release: "publication",
};
/** The current kinds each slot-model agent holds. */
export const CURRENT_AGENT_KINDS: Readonly<Record<ModelAgent, readonly TargetSlotKind[]>> = {
  director: ["brief"],
  designer: ["element/token", "element/asset", "element/component", "element/section", "element/frame"],
  writer: ["voice", "prose", "copy"],
  publisher: ["page", "layout", "chrome", "release"],
  producer: ["loop", "queue", "ledger"],
};

const object = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const SLOT_REF = /^(director|designer|writer|publisher|producer)\/([a-z][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*){1,3})$/;

/** A slot.json as the reader holds it: the reader's view, and the current document when it is one. */
export interface SlotRead { readonly doc: SlotDoc; readonly current?: Slot }

export const isCurrentSlot = (value: unknown): value is { schema: typeof SLOT_SCHEMA } => object(value) && value.schema === SLOT_SCHEMA;
export const isOldSlot = (value: unknown): boolean => object(value) && value.schema === SLOT_V1_SCHEMA;

/** The slot ids a current slot's refs of one rel name (`<agent>/<slot id>` refs only), in order, once each. */
export function refIds(slot: Pick<Slot, "refs">, rel: "input" | "uses"): string[] {
  const out: string[] = [];
  for (const ref of slot.refs) {
    const id = ref.rel === rel ? SLOT_REF.exec(ref.to)?.[2] : undefined;
    if (id !== undefined && !out.includes(id)) out.push(id);
  }
  return out;
}

/** The reader's view of a valid current slot. Its `ia` is the slash-path ia as written. */
export function currentView(slot: Slot): SlotDoc {
  const notNeeded = object(slot.contract) ? slot.contract.notNeeded : undefined;
  return {
    schema: SLOT_SCHEMA as unknown as SlotDoc["schema"],
    id: slot.id, agent: slot.agent as ModelAgent,
    ia: { l0: slot.ia.l0, l1: slot.ia.l1, l2: slot.ia.l2, order: slot.ia.order },
    kind: (FAMILY[slot.kind] ?? slot.kind) as SlotKind,
    standard: slot.standard,
    contract: slot.contract,
    inputs: refIds(slot, "input"), uses: refIds(slot, "uses"),
    ...(notNeeded !== undefined ? { notNeeded: notNeeded as NotNeeded } : {}),
    ...(slot.options !== undefined ? { options: slot.options } : {}),
    ...(slot.varyOn !== undefined ? { varyOn: slot.varyOn } : {}),
  };
}

/** Issues of a slot.json in either format, as the reader judges it (the check adds the old-format finding). */
export function slotReadIssues(value: unknown, path: string): SlotModelIssue[] {
  if (!isCurrentSlot(value)) return validateSlotDoc(value, path);
  const issues: SlotModelIssue[] = validateSlot(value).map(issue => ({ code: "slot-invalid", path, message: `${issue.path} ${issue.message}` }));
  const contract = (value as Record<string, unknown>).contract;
  const notNeeded = object(contract) ? contract.notNeeded : undefined;
  if (notNeeded !== undefined && notNeededIssue(notNeeded)) issues.push({ code: "slot-invalid", path, message: "contract.notNeeded must be {reason, since, decidedBy} with a non-empty reason, an ISO date and who decided" });
  return issues;
}

/** The reader's view of a slot.json in either format, or undefined when it is not valid. */
export function readSlotValue(value: unknown, path = "slot.json"): SlotRead | undefined {
  if (slotReadIssues(value, path).length) return undefined;
  if (!isCurrentSlot(value)) return { doc: value as SlotDoc };
  const current = value as unknown as Slot;
  return { doc: currentView(current), current };
}

/** True when the slot is the one its IA position names: same id and agent, and the position's ia. */
export function placedAt(read: SlotRead, id: string, agent: ModelAgent, position: SlotPosition): boolean {
  if (read.doc.id !== id || read.doc.agent !== agent) return false;
  if (read.current) return sameJson(read.current.ia, positionIa(id, position));
  const ia = read.doc.ia;
  return ia.l0 === position.l0 && ia.l1 === position.l1 && ia.l2 === position.l2 && ia.order === position.order;
}

/** True when the bytes are a Publisher `clossys.page/1` record (recut passes these through as they are). */
function pageRecord(agent: ModelAgent, name: string, bytes: string): boolean {
  if (agent !== "publisher" || !name.endsWith(".json")) return false;
  try { const doc = JSON.parse(bytes) as unknown; return object(doc) && doc.schema === PAGE_SCHEMA; } catch { return false; }
}

/**
 * A candidate's issues under its slot: an old-format slot's candidates by the old candidate rules; a current
 * slot's by the clossys.candidate/1 header (schema, and id, agent and slot naming where the file sits), a
 * Publisher page record by the page rules.
 */
export function candidateIssues(read: SlotRead, agent: ModelAgent, id: string, name: string, bytes: string, path = name): SlotModelIssue[] {
  if (!read.current || pageRecord(agent, name, bytes)) return validateCandidate(read.doc.kind, id, name, bytes, path);
  if (!parseCandidateName(name)) return [{ code: "candidate-name", path, message: "candidate file name must be <name>-v<n>.<ext>" }];
  return candidateHeaderIssues(name, bytes, { agent: agent as AgentId, slotId: id as SlotId }).map(message => ({ code: "candidate-invalid", path, message }));
}

/**
 * A clossys.candidate/1 `source` as the slot resolve reads it: a trailing `{"hash": ...}` ref (how
 * `clossys migrate recut` carries an int2 source hash inside the closed candidate/1 source) is the hash.
 */
export function sourceView(source: unknown): Record<string, unknown> | undefined {
  if (!object(source) || !Array.isArray(source.ref)) return object(source) ? { ...source } : undefined;
  const ref: unknown[] = [];
  let hash: string | undefined;
  for (const item of source.ref) {
    let parsed: unknown;
    if (typeof item === "string" && item.startsWith("{")) try { parsed = JSON.parse(item); } catch { parsed = undefined; }
    if (object(parsed) && Object.keys(parsed).length === 1 && typeof parsed.hash === "string" && hash === undefined) hash = parsed.hash;
    else ref.push(item);
  }
  return { ...source, ref, ...(hash !== undefined ? { hash } : {}) };
}
