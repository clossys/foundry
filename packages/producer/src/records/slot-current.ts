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
import { buildCandidateHeader, candidateHeaderIssues, parseCandidateName, serializeCandidate } from "./candidate.js";
import { sha256Hex } from "./hash.js";
import { sourceKindOf } from "./source-kind.js";
import { parseYamlSubset, readRecordHeader } from "./schema.js";
import { parseFrontmatter } from "./slot-model/frontmatter.js";
import { canonical } from "./slot-model/layout.js";
import { positionIa, sameJson, SLOT_SCHEMA, SLOT_V1_SCHEMA, validateSlot } from "./slot.js";
import type { Actor, AgentId, CandidateHeader, Iso, Slot, SlotId, TargetSlotKind } from "./types.js";
import { contractIssues, notNeededIssue, optionIssues, validateCandidate, validateSlotDoc, validateSource, type SlotModelIssue } from "./slot-model/validate.js";
import { CANDIDATE_STATUS_KEYS, KIND_EXT, LEGACY_PROVENANCE_KEYS, PAGE_SCHEMA, PUBLICATION_SCHEMA, type ModelAgent, type NotNeeded, type SlotDoc, type SlotKind, type SlotPosition } from "./slot-model/types.js";

/** The finding `clossys check` gives a slot.json still in the old format. */
export const OLD_SLOT_FORMAT = `slot.json is ${SLOT_V1_SCHEMA}, an old format: run clossys migrate recut`;

/** The reader's kind family of each current kind (loop, queue and ledger are Producer kinds the reader does not hold). */
const FAMILY: Readonly<Partial<Record<TargetSlotKind, SlotKind>>> = {
  brief: "brief",
  "element/token": "element", "element/asset": "element", "element/component": "element", "element/section": "element", "element/frame": "element",
  voice: "strings", prose: "strings", copy: "strings",
  page: "page", layout: "page", chrome: "page", publication: "publication", release: "publication",
  seat: "seat",
};
/** The reader's kind family of a current kind (`copy` is `strings`), or the value itself when it names none. */
export const slotFamily = (kind: unknown): unknown => typeof kind === "string" ? FAMILY[kind as TargetSlotKind] ?? kind : kind;

/** A release slot id, `release.<publication>` (release/paths.ts RELEASE_SLOT, which records cannot import). */
const RELEASE_SLOT_ID = /^release\.[a-z0-9][a-z0-9-]*$/;
/**
 * True for a release slot: a Publisher clossys.slot/2 slot of target kind `release`, or one named `release.<pub>` whatever
 * kind it declares. A release slot holds the manifests `clossys release <pub> --manifest` writes, so the publication
 * family's record rules never make a page/1 or publication/1 record fit there.
 */
export const isReleaseSlot = (agent: string, id: string, kind: unknown): boolean => agent === "publisher" && (kind === "release" || RELEASE_SLOT_ID.test(id));

/** True when candidate bytes are a Publisher page/1 or publication/1 record, bare or as a clossys.candidate/1 content. */
function publisherRecord(name: string, bytes: string): boolean {
  if (!name.endsWith(".json")) return false;
  try {
    const doc = JSON.parse(bytes) as unknown;
    const record = object(doc) && object(doc.content) ? doc.content : doc;
    return object(record) && (record.schema === PAGE_SCHEMA || record.schema === PUBLICATION_SCHEMA);
  } catch { return false; }
}
/** The current kinds each slot-model agent holds (each content agent holds its own loop slots, loop/agent-loops.ts). */
export const CURRENT_AGENT_KINDS: Readonly<Record<ModelAgent, readonly TargetSlotKind[]>> = {
  director: ["brief", "loop"],
  designer: ["element/token", "element/asset", "element/component", "element/section", "element/frame", "loop"],
  writer: ["voice", "prose", "copy", "loop"],
  publisher: ["page", "layout", "chrome", "publication", "release", "loop"],
  producer: ["loop", "queue", "ledger", "seat"],
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
    ...(slot.family !== undefined ? { family: slot.family } : {}),
  };
}

/** Issues of a slot.json in either format, as the reader judges it (the check adds the old-format finding). */
export function slotReadIssues(value: unknown, path: string): SlotModelIssue[] {
  if (!isCurrentSlot(value)) return validateSlotDoc(value, path);
  const issues: SlotModelIssue[] = validateSlot(value).map(issue => ({ code: "slot-invalid", path, message: `${issue.path} ${issue.message}` }));
  const contract = (value as Record<string, unknown>).contract;
  const notNeeded = object(contract) ? contract.notNeeded : undefined;
  if (notNeeded !== undefined && notNeededIssue(notNeeded)) issues.push({ code: "slot-invalid", path, message: "contract.notNeeded must be {reason, since, decidedBy} with a non-empty reason, an ISO date and who decided" });
  // The slot/1 rules the schema does not hold, unrelaxed: the options rules, and the contract semantics of the
  // kind family (a clossys.slot-contract/1 contract, the fixture shape).
  const slot = value as Record<string, unknown>;
  issues.push(...optionIssues(slot, path));
  const family = typeof slot.kind === "string" ? FAMILY[slot.kind as TargetSlotKind] : undefined;
  if (family && object(contract)) issues.push(...contractIssues(family, contract, typeof slot.id === "string" ? slot.id : "", path));
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

/**
 * U37: the bytes a create-path writer (`clossys next --submit` for a Director slot/2 brief) writes for an int2
 * Markdown candidate: a new clossys.candidate/1 header (status submitted, `createdBy` the submitting actor) with the
 * front matter `source` moved into it, every other front matter field kept beside it and the body byte for byte, as
 * `clossys migrate recut` would write it. `candidateView` of the result is the int2 document the kind rules judged.
 * Throws on a candidate that is not int2 Markdown with a `source`: nothing is guessed. `record` and `briefSha256` are the
 * header's content fields a reissue carries from the file it supersedes.
 */
export function headeredMarkdown(name: string, int2: string, input: { readonly agent: AgentId; readonly slotId: SlotId; readonly createdBy: Actor; readonly createdAt: Iso; readonly record?: string; readonly briefSha256?: string }): string {
  if (!name.endsWith(".md")) throw new Error(`${name}: a clossys.candidate/1 header is written here for a Markdown candidate only`);
  const parsed = parseFrontmatter(int2);
  if (!parsed.ok) throw new Error(`${name}: its front matter cannot be read, so no header is written`);
  const { source, ...rest } = parsed.value.fields;
  if (Object.hasOwn(rest, "clossys")) throw new Error(`${name}: already carries a clossys front matter key`);
  if (source === undefined) throw new Error(`${name}: has no front matter source to move into the header`);
  const header = buildCandidateHeader({
    agent: input.agent, slotId: input.slotId, name, status: "submitted", createdBy: input.createdBy, createdAt: input.createdAt, source: source as CandidateHeader["source"],
    ...(input.record !== undefined ? { record: input.record } : {}), ...(input.briefSha256 !== undefined ? { briefSha256: input.briefSha256 } : {}),
  });
  return serializeCandidate(name, header, parsed.value.body, rest);
}

export { sourceKindOf };

/**
 * The source kind of a candidate's view (readCandidateText `view`): a JSON view's `meta.source.kind`, a Markdown view's
 * front matter `source.kind`. The one reader of a candidate's kind: the write guard (through the context's parsed view)
 * and `next --submit`'s recipe check read this same field.
 */
export function viewSourceKind(name: string, view: string): string | undefined {
  if (name.endsWith(".json")) { try { return sourceKindOf(JSON.parse(view)); } catch { return undefined; } }
  if (!name.endsWith(".md")) return undefined;
  const parsed = parseFrontmatter(view);
  const source = parsed.ok ? parsed.value.fields.source : undefined;
  return object(source) && typeof source.kind === "string" ? source.kind : undefined;
}

/**
 * Every place a submitted JSON candidate carries a source, with its kind: the `clossys.candidate/1` header's
 * `clossys.source`, the body's `content.meta.source` and a top-level `meta.source` (beside a `content` wrapper or as
 * the body itself). `next --submit` refuses a submission whose kinds disagree (source-kind-mismatch): a reader must
 * never be able to pick one kind while the guard reads another.
 */
export function submissionSources(content: unknown): { readonly at: string; readonly kind: string | undefined }[] {
  if (!object(content)) return [];
  const out: { at: string; kind: string | undefined }[] = [];
  const add = (at: string, source: unknown) => { if (source !== undefined) out.push({ at, kind: object(source) && typeof source.kind === "string" ? source.kind : undefined }); };
  if (object(content.clossys)) add("clossys.source", content.clossys.source);
  if (object(content.content) && object(content.content.meta)) add("content.meta.source", content.content.meta.source);
  if (object(content.meta)) add("meta.source", content.meta.source);
  return out;
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
 * The header issues of a clossys.candidate/1 file under a current slot, as `candidateIssues` judges them: the header
 * against schemas/candidate.json with its id, agent and slot naming where the file sits, and no second source beside
 * the header's. The pin gate's certifier judges a headered candidate's header by this, then its body by every rule of
 * its kind over its view (constitution/certify/index.ts judgedCandidate), so the gate and the readers read one format.
 */
export function candidateHeaderReadIssues(agent: ModelAgent, id: string, name: string, bytes: string, path = name): SlotModelIssue[] {
  return [
    ...candidateHeaderIssues(name, bytes, { agent: agent as AgentId, slotId: id as SlotId }).map(message => ({ code: "candidate-invalid" as const, path, message })),
    ...secondSource(name, bytes, path),
  ];
}

/** The kind families whose clossys.candidate/1 candidates are read through their view (loop, queue and ledger are not; a seat is read as its content). */
const VIEWED_FAMILIES: ReadonlySet<unknown> = new Set<SlotKind>(["brief", "element", "strings", "page", "publication"]);
/** Header fields that say who made a file, when and why: per-file provenance, never content (the content digest leaves them out). */
export const HEADER_PROVENANCE = ["id", "slot", "agent", "status", "createdBy", "createdAt", "refs", "rationale"] as const;
/**
 * Header fields the content digest also leaves out: `schema` and `kind` are constants schemas/candidate.json fixes for
 * every header (so they say only that a header is present, not what the candidate holds), and `source` is already in
 * the view the digest reads. Every other header field (`record`, `briefSha256`, `updatedAt`) is digested.
 */
const HEADER_UNDIGESTED: ReadonlySet<string> = new Set<string>([...HEADER_PROVENANCE, "schema", "kind", "source"]);

/** One candidate file as every reader reads it (foundry-build-0048 U37c): its bytes, its view, its header and its content digest. */
export interface CandidateText {
  /** The file's bytes, as written: what the raw sha256 (pins, the ledger, R08, R14) and the certify cache key read. */
  readonly raw: string;
  /** What the kind rules read: `candidateView` of a viewed candidate (see `viewsCandidate`), a seat's content (`seatContent`), else the raw bytes. */
  readonly view: string;
  /** The clossys.candidate/1 header of a viewed candidate or a seat. */
  readonly header?: Readonly<Record<string, unknown>>;
  /** The header's issues where the file sits (`candidateHeaderReadIssues`); empty when no header is viewed. */
  readonly headerIssues: readonly SlotModelIssue[];
  /** `contentDigest` of the view and the header. */
  readonly contentDigest: string;
}

/**
 * True when the candidates of a slot.json value are read through their view: a clossys.slot/2 document whose kind is
 * one of the viewed families (brief, element, strings, page, publication). A loop, queue or ledger slot keeps its raw
 * bytes (../constitution/certify/loop.ts reads the loop header itself), as does every clossys.slot/1 slot. The slot need not be valid:
 * the rules still read an invalid slot's candidates with their source, and R01 reports the slot.
 */
export function viewsCandidate(slotValue: unknown): boolean {
  return isCurrentSlot(slotValue) && VIEWED_FAMILIES.has(slotFamily((slotValue as Record<string, unknown>).kind));
}

/** True when a slot.json value is a Producer seat (kind seat, clossys.slot/2 or, in a store not yet converted, slot/1). */
const isSeatSlot = (slotValue: unknown): boolean => object(slotValue) && slotFamily(slotValue.kind) === "seat";

/**
 * A headered seat candidate's content (U13 r4): a seat is read as the `content` of its {clossys, content} JSON, as
 * two-space JSON text (records/candidate-codec.ts parse, records/slots.ts seatTextAt). Bytes of any other form are viewed.
 */
function seatContent(name: string, bytes: string): string {
  if (!name.endsWith(".json")) return candidateView(name, bytes);
  return `${JSON.stringify((JSON.parse(bytes) as { content?: unknown }).content ?? null, null, 2)}\n`;
}

/**
 * The content identity of a candidate (R03.2 verbatim adopt, R06.6 identical content, `clossys next --submit`'s identity
 * refusal): the sha256 of the canonical JSON of what the kind rules read plus the header's non-provenance fields.
 * Markdown: every front matter field value of the view (with `source`, keys sorted) and the exact body bytes. JSON: the
 * parsed view, keys sorted. The header's provenance (`HEADER_PROVENANCE`) is left out, so the same content under two
 * headers, or under a header and as an int2 file, has one digest; every body byte and every field value counts. Bytes
 * the format cannot parse (an SVG, broken JSON or front matter) are identified by the sha256 of the view itself.
 */
export function contentDigest(name: string, view: string, header?: Readonly<Record<string, unknown>>): string {
  let content: Record<string, unknown> | undefined;
  if (name.endsWith(".md")) {
    const parsed = parseFrontmatter(view);
    if (parsed.ok) content = { format: "md", fields: parsed.value.fields, body: parsed.value.body };
  } else if (name.endsWith(".json")) {
    try { content = { format: "json", json: JSON.parse(view) as unknown }; } catch { content = undefined; }
  }
  if (!content) return sha256Hex(view);
  const residue = header ? Object.fromEntries(Object.entries(header).filter(([key]) => !HEADER_UNDIGESTED.has(key))) : {};
  return sha256Hex(JSON.stringify(canonical({ digest: "clossys.content-digest/1", ...content, header: residue })));
}

/**
 * The one candidate reader (foundry-build-0048 U37c): the constitution context, the certifier, the write guard, the
 * slot readers, Studio, publish and `clossys next` read a candidate through this, so the header never hides `source`
 * from a rule and its per-file provenance never changes a content identity. `slotValue` is the slot's parsed slot.json.
 */
export function readCandidateText(slotValue: unknown, agent: ModelAgent, id: string, name: string, bytes: string, path = name): CandidateText {
  const seat = isSeatSlot(slotValue);
  const header = seat || viewsCandidate(slotValue) ? candidateHeaderOf(name, bytes) : undefined;
  if (!header) return { raw: bytes, view: bytes, headerIssues: [], contentDigest: contentDigest(name, bytes) };
  const view = seat ? seatContent(name, bytes) : candidateView(name, bytes);
  return { raw: bytes, view, header, headerIssues: candidateHeaderReadIssues(agent, id, name, bytes, path), contentDigest: contentDigest(name, view, header) };
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
 * by the target rules. A Publisher page or publication record goes by its kind's rules. Producer kinds (loop,
 * queue, ledger) have no kind rules beyond the header.
 */
export function candidateIssues(read: SlotRead, agent: ModelAgent, id: string, name: string, bytes: string, path = name): SlotModelIssue[] {
  // A release slot holds the release manifest, never a Publisher page or publication record, headered or bare.
  if (read.current && isReleaseSlot(agent, id, read.current.kind) && publisherRecord(name, bytes)) {
    return [{ code: "candidate-invalid", path, message: `${agent}/${id} is a release slot: it holds the manifest clossys release <pub> --manifest writes, not a page or publication record` }];
  }
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
