/**
 * The current slot format (`clossys.slot/2`) as the slot-model reader and `clossys check` see it
 * (foundry-build-0031). A slot/2 document is validated against schemas/slot.json and read through a view
 * with the reader's own terms: its kind family, the slot ids its `input` and `uses` refs name, its
 * `contract.notNeeded` marker, and whether its slash-path `ia` is the one its ia.json position names.
 * `clossys check` judges the current format only: a `clossys.slot/1` file is one finding that names
 * `clossys migrate recut`.
 *
 * A clossys.candidate/1 candidate is judged by its header, its kind's target extensions, and, when it still carries
 * an int2-shaped document (`int2Shaped`), by every rule of its kind (validateCandidate), read through its view
 * (`candidateView`): the candidate without the header, with the header's `source` where the kind rules read it.
 * The format moves the source; it relaxes no rule. A target-format document the int2 rules were never written
 * for (a release manifest, a Designer SVG, a Writer JSON record, a Director brief with only its header) is judged
 * by the target rules alone (`targetIssues`).
 */
import { candidateHeaderIssues, parseCandidateName } from "./candidate.js";
import { parseYamlSubset, readRecordHeader } from "./schema.js";
import { parseFrontmatter } from "./slot-model/frontmatter.js";
import { positionIa, sameJson, SLOT_SCHEMA, SLOT_V1_SCHEMA, validateSlot } from "./slot.js";
import type { AgentId, Slot, SlotId, TargetSlotKind } from "./types.js";
import { notNeededIssue, validateCandidate, validateSlotDoc, validateSource, type SlotModelIssue } from "./slot-model/validate.js";
import { CANDIDATE_STATUS_KEYS, KIND_EXT, LEGACY_PROVENANCE_KEYS, PAGE_SCHEMA, PUBLICATION_SCHEMA, type ModelAgent, type NotNeeded, type SlotDoc, type SlotKind, type SlotPosition } from "./slot-model/types.js";

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

/** The extensions a target-format candidate of each kind family takes (the int2 rules hold the int2 extension). */
export const TARGET_EXT: Readonly<Record<Exclude<SlotKind, "seat">, readonly ("md" | "json" | "svg")[]>> = {
  brief: ["md"], element: ["json", "svg"], strings: ["md", "json"], page: ["json"], publication: ["json"],
};

/** A Markdown candidate's front matter fields beside the `clossys` header (int2 `key: <JSON>` lines, else the YAML subset). */
function frontBeside(bytes: string): Record<string, unknown> {
  const exact = parseFrontmatter(bytes);
  let fields: unknown = exact.ok ? exact.value.fields : undefined;
  if (!exact.ok) try { fields = parseYamlSubset(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(bytes)?.[1] ?? ""); } catch { fields = undefined; }
  const { clossys: _header, ...beside } = object(fields) ? fields : {};
  return beside;
}

/**
 * True when a clossys.candidate/1 file still carries an int2-shaped document, the shape the int2 kind rules judge:
 * Markdown with front matter fields beside the header (recut keeps the int2 front there); JSON whose content keeps
 * int2 `meta`, or names the int2 record schema of its kind (page/1, publication/1); an element that claims a registry
 * item (a registry:* type or a registry source). Anything else (an SVG, a release manifest, a Writer JSON record,
 * a brief with only its header) is a target-format document.
 */
export function int2Shaped(kind: SlotKind, name: string, bytes: string, header: Record<string, unknown>): boolean {
  if (name.endsWith(".md")) return Object.keys(frontBeside(bytes)).length > 0;
  if (!name.endsWith(".json")) return false;
  const doc = JSON.parse(bytes) as Record<string, unknown>;
  const content = Object.hasOwn(doc, "content") ? doc.content : undefined;
  if (!object(content)) return false;
  if (Object.hasOwn(content, "meta")) return true;
  if (kind === "page") return content.schema === PAGE_SCHEMA;
  if (kind === "publication") return content.schema === PUBLICATION_SCHEMA;
  if (kind === "element") return (typeof content.type === "string" && content.type.startsWith("registry:")) || (object(header.source) && header.source.kind === "registry");
  return false;
}

/**
 * The target rules of a target-format candidate: its kind's extensions, the header source's semantics, and the
 * candidate's own level (JSON keys beside `clossys` and `content`, Markdown front matter beside the header), where
 * pin state and legacy provenance keys never sit. The content itself is the target writer's (release manifest,
 * Writer record, SVG, brief body), checked by that writer's own rules.
 */
function targetIssues(kind: Exclude<SlotKind, "seat">, name: string, bytes: string, header: Record<string, unknown>, path: string): SlotModelIssue[] {
  const ext = parseCandidateName(name)!.ext;
  if (!TARGET_EXT[kind].includes(ext)) return [{ code: "candidate-name", path, message: `${kind} candidates are .${TARGET_EXT[kind].join(" or .")}` }];
  const issues: SlotModelIssue[] = header.source === undefined ? [] : validateSource(header.source, path);
  const own = ext === "json" ? Object.fromEntries(Object.entries(JSON.parse(bytes) as Record<string, unknown>).filter(([key]) => key !== "clossys" && key !== "content")) : {};
  for (const key of Object.keys(own)) {
    if ((CANDIDATE_STATUS_KEYS as readonly string[]).includes(key)) issues.push({ code: "candidate-status", path, message: `${key} is pin state; pinning lives only in pin.json` });
    else if ((LEGACY_PROVENANCE_KEYS as readonly string[]).includes(key)) issues.push({ code: "candidate-source", path, message: `${key} is replaced by the single source key` });
    else issues.push({ code: "candidate-invalid", path, message: `${key} sits beside the clossys header and content` });
  }
  return issues;
}

/**
 * A candidate's issues under its slot: an old-format slot's candidates by the old candidate rules; a current
 * slot's by the clossys.candidate/1 header (schema, and id, agent and slot naming where the file sits), then: an
 * int2-shaped document by every rule of its kind over its view (kind to extension, sections, locales and records,
 * registry item, pin state and legacy provenance keys, vary, source) and a second source; a target-format document
 * by the target rules. A Publisher page record goes by the page rules. Producer kinds (loop, queue, ledger) have no
 * kind rules beyond the header.
 */
export function candidateIssues(read: SlotRead, agent: ModelAgent, id: string, name: string, bytes: string, path = name): SlotModelIssue[] {
  if (!read.current || pageRecord(agent, name, bytes)) return validateCandidate(read.doc.kind, id, name, bytes, path);
  if (!parseCandidateName(name)) return [{ code: "candidate-name", path, message: "candidate file name must be <name>-v<n>.<ext>" }];
  const issues: SlotModelIssue[] = candidateHeaderIssues(name, bytes, { agent: agent as AgentId, slotId: id as SlotId }).map(message => ({ code: "candidate-invalid", path, message }));
  const kind = read.doc.kind;
  const header = candidateHeaderOf(name, bytes);
  if (!Object.hasOwn(KIND_EXT, kind) || kind === "seat") return issues;
  // No candidate/1 header: int2 bytes under a current slot, judged by the int2 rules as they are.
  if (!header) issues.push(...validateCandidate(kind, id, name, bytes, path));
  else if (int2Shaped(kind, name, bytes, header)) issues.push(...validateCandidate(kind, id, name, candidateView(name, bytes), path), ...secondSource(name, bytes, path));
  else issues.push(...targetIssues(kind, name, bytes, header, path));
  return issues;
}
