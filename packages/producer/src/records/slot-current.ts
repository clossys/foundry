/**
 * The current slot format (`clossys.slot/2`) as the slot-model reader and `clossys check` see it
 * (foundry-build-0031). A slot/2 document is validated against schemas/slot.json and read through a view
 * with the reader's own terms: its kind family, the slot ids its `input` and `uses` refs name, its
 * `contract.notNeeded` marker, and whether its slash-path `ia` is the one its ia.json position names.
 * `clossys check` judges the current format only: a `clossys.slot/1` file is one finding that names
 * `clossys migrate recut`.
 *
 * A clossys.candidate/1 candidate is judged by its header and by every rule of its kind (validateCandidate),
 * read through its view (`candidateView`): the candidate without the header, with the header's `source`
 * where the kind rules read it. The format moves the source; it relaxes no rule.
 */
import { candidateHeaderIssues, parseCandidateName } from "./candidate.js";
import { readRecordHeader } from "./schema.js";
import { parseFrontmatter } from "./slot-model/frontmatter.js";
import { positionIa, sameJson, SLOT_SCHEMA, SLOT_V1_SCHEMA, validateSlot } from "./slot.js";
import type { AgentId, Slot, SlotId, TargetSlotKind } from "./types.js";
import { notNeededIssue, validateCandidate, validateSlotDoc, type SlotModelIssue } from "./slot-model/validate.js";
import { KIND_EXT, PAGE_SCHEMA, PUBLICATION_SCHEMA, type ModelAgent, type NotNeeded, type SlotDoc, type SlotKind, type SlotPosition } from "./slot-model/types.js";

/** The finding `clossys check` gives a slot.json still in the old format. */
export const OLD_SLOT_FORMAT = `slot.json is ${SLOT_V1_SCHEMA}, an old format: run clossys migrate recut`;

/** The reader's kind family of each current kind (loop, queue and ledger are Producer kinds the reader does not hold). */
const FAMILY: Readonly<Partial<Record<TargetSlotKind, SlotKind>>> = {
  brief: "brief",
  "element/token": "element", "element/asset": "element", "element/component": "element", "element/section": "element", "element/frame": "element",
  voice: "strings", prose: "strings", copy: "strings",
  page: "page", layout: "page", chrome: "page", publication: "publication", release: "publication",
};
/** The current kinds each slot-model agent holds. */
export const CURRENT_AGENT_KINDS: Readonly<Record<ModelAgent, readonly TargetSlotKind[]>> = {
  director: ["brief"],
  designer: ["element/token", "element/asset", "element/component", "element/section", "element/frame"],
  writer: ["voice", "prose", "copy"],
  publisher: ["page", "layout", "chrome", "publication", "release"],
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

/**
 * Issues of a reader view (what `readSlot` and `inspectSlot` return) for a caller that re-judges it: none for a
 * current-format view, which readSlotValue only builds from a document schemas/slot.json and the notNeeded rule
 * passed; an old-format view by validateSlotDoc, as before.
 */
export function viewIssues(doc: SlotDoc, path = "slot.json"): SlotModelIssue[] {
  return (doc.schema as string) === SLOT_SCHEMA ? [] : validateSlotDoc(doc, path);
}

/** True when a reader view is a valid slot its IA position names: same id and agent, and the position's ia in its format. */
export function viewPlacedAt(doc: SlotDoc, id: string, agent: ModelAgent, position: SlotPosition): boolean {
  if (viewIssues(doc).length || doc.id !== id || doc.agent !== agent) return false;
  if ((doc.schema as string) === SLOT_SCHEMA) return sameJson(doc.ia, positionIa(id, position));
  return doc.ia.l0 === position.l0 && doc.ia.l1 === position.l1 && doc.ia.l2 === position.l2 && doc.ia.order === position.order;
}

/** True when the bytes are a Publisher `clossys.page/1` or `clossys.publication/1` record (recut passes these through as they are). */
function pageRecord(agent: ModelAgent, name: string, bytes: string): boolean {
  if (agent !== "publisher" || !name.endsWith(".json")) return false;
  try { const doc = JSON.parse(bytes) as unknown; return object(doc) && (doc.schema === PAGE_SCHEMA || doc.schema === PUBLICATION_SCHEMA); } catch { return false; }
}

const CANDIDATE_SCHEMA = "clossys.candidate/1";
const FRONT = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/;

/** The clossys.candidate/1 header of candidate bytes, or undefined when they carry none (an int2 candidate, a page/1 record). */
export function candidateHeaderOf(name: string, bytes: string): Record<string, unknown> | undefined {
  try {
    const header = readRecordHeader(name, bytes);
    return object(header) && header.schema === CANDIDATE_SCHEMA ? header : undefined;
  } catch { return undefined; }
}

/**
 * The document a candidate's kind rules read (validateCandidate, the slot resolve, Designer's ref-verbatim through
 * `@clossys/producer/records/slots`): for a clossys.candidate/1 file, the candidate without its header and with the
 * header's `source` where those rules read it. JSON: the `content` object (keys beside `clossys` and `content`
 * kept, so pin state there is still seen) with `meta.source`; Markdown: the candidate's own front matter fields
 * with `source`, and its body. Any other bytes (an int2 candidate, a page/1 record, an SVG) are returned as they are.
 */
export function candidateView(name: string, bytes: string): string {
  const header = candidateHeaderOf(name, bytes);
  if (!header) return bytes;
  const source = header.source;
  if (name.endsWith(".json")) {
    const { clossys: _header, ...rest } = JSON.parse(bytes) as Record<string, unknown>;
    const wrapped = Object.hasOwn(rest, "content");
    const { content, ...beside } = rest;
    const body = wrapped ? content : rest;
    if (!object(body)) return JSON.stringify(body ?? null);
    const meta = body.meta === undefined ? { source } : object(body.meta) ? { ...body.meta, source } : body.meta;
    return JSON.stringify({ ...(wrapped ? beside : {}), ...body, meta });
  }
  if (name.endsWith(".md")) {
    const parsed = parseFrontmatter(bytes);
    const { clossys: _header, ...fields } = parsed.ok ? parsed.value.fields : {};
    const body = parsed.ok ? parsed.value.body : bytes.replace(FRONT, "");
    const lines = Object.entries({ ...fields, source }).map(([key, value]) => `${key}: ${JSON.stringify(value)}`);
    return `---\n${lines.join("\n")}\n---\n${body}`;
  }
  return bytes;
}

/** A second source beside the header's: a candidate/1 file's JSON `meta.source` or Markdown front matter `source`. */
function secondSource(name: string, bytes: string, path: string): SlotModelIssue[] {
  if (!candidateHeaderOf(name, bytes)) return [];
  let second = false;
  if (name.endsWith(".json")) {
    const doc = JSON.parse(bytes) as Record<string, unknown>;
    const body = Object.hasOwn(doc, "content") ? doc.content : doc;
    second = object(body) && object(body.meta) && Object.hasOwn(body.meta, "source");
  } else if (name.endsWith(".md")) {
    const parsed = parseFrontmatter(bytes);
    second = parsed.ok && Object.hasOwn(parsed.value.fields, "source");
  }
  return second ? [{ code: "candidate-source", path, message: "source is the clossys header's; the candidate carries a second one" }] : [];
}

/**
 * A candidate's issues under its slot: an old-format slot's candidates by the old candidate rules; a current
 * slot's by the clossys.candidate/1 header (schema, and id, agent and slot naming where the file sits) and by
 * every rule of its kind over its view (kind to extension, sections, locales and records, registry item, pin
 * state and legacy provenance keys, vary, source); a Publisher page or publication record by its kind's rules. Producer kinds
 * (loop, queue, ledger) have no kind rules beyond the header.
 */
export function candidateIssues(read: SlotRead, agent: ModelAgent, id: string, name: string, bytes: string, path = name): SlotModelIssue[] {
  if (!read.current || pageRecord(agent, name, bytes)) return validateCandidate(read.doc.kind, id, name, bytes, path);
  if (!parseCandidateName(name)) return [{ code: "candidate-name", path, message: "candidate file name must be <name>-v<n>.<ext>" }];
  const issues: SlotModelIssue[] = candidateHeaderIssues(name, bytes, { agent: agent as AgentId, slotId: id as SlotId }).map(message => ({ code: "candidate-invalid", path, message }));
  if (Object.hasOwn(KIND_EXT, read.doc.kind)) issues.push(...validateCandidate(read.doc.kind, id, name, candidateView(name, bytes), path), ...secondSource(name, bytes, path));
  return issues;
}
