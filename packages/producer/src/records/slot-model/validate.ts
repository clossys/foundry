import { pinIssues } from "@clossys/director";
import { INTERACTIVE_BACKDROP_KIND, interactiveBackdropCandidateIssues } from "@clossys/designer/catalog";
import { checkPublicationOutputs } from "@clossys/publisher/content-map";
import { pinMapIssues, pinIssues as targetPinIssues } from "../pin.js";
import { parseFrontmatter } from "./frontmatter.js";
import { loadSchema, validateValue } from "../../pipeline/schema.js";
import { contractFixtureIssues } from "./contract-fixture.js";
import { RECORD_SCHEMA_IDS } from "../schemas.js";
import { validateSlotContract } from "../validate.js";
import {
  AGENT_KIND, CANDIDATE_NAME, CANDIDATE_STATUS_KEYS, DECIDED_BY, IA_SCHEMA, KIND_EXT, LEGACY_PROVENANCE_KEYS, MODEL_AGENTS, NODE_ID, PAGE_SCHEMA,
  PUBLICATION_SCHEMA, OPTION_COUNTS, VARY_ID, SEAT_AGENT, SEAT_PREFIX, SLOT_ID, SLOT_KINDS, SLOT_SCHEMA, SOURCE_KINDS, STANDARD_ID, NPM_SOURCE_REF, INSTANCE_KEY, WRITER_KEY_REF,
  seatStepOf, type IaDoc, type ModelAgent, type PinDoc, type SlotDoc, type SlotKind,
} from "./types.js";

/** Stable finding codes; `clossys migrate slots --check` and the mutation proofs name them. */
export type SlotModelCode =
  | "ia-invalid" | "slot-invalid" | "slot-mismatch" | "slot-missing" | "ia-path" | "orphan"
  | "pin-invalid" | "pin-candidate" | "pin-hash"
  | "candidate-name" | "candidate-invalid" | "candidate-source" | "candidate-status"
  | "ref-unknown" | "slot-state" | "retired-invalid";
export interface SlotModelIssue { readonly code: SlotModelCode; readonly path: string; readonly message: string }

const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(item => typeof item === "string");
const nonEmpty = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;

/**
 * One agent's ia.json. With `agent`, the seat namespace is checked too (D5): every Producer id is
 * `seat.<step-id>`, and no other agent places an id in the `seat.` namespace.
 */
export function validateIa(value: unknown, path = "ia.json", agent?: ModelAgent): SlotModelIssue[] {
  const issues: SlotModelIssue[] = [];
  const fail = (message: string) => issues.push({ code: "ia-invalid", path, message });
  if (!object(value)) { fail("expected an object"); return issues; }
  if (value.schema !== IA_SCHEMA) fail(`schema must be ${IA_SCHEMA}`);
  if (!nonEmpty(value.source) || !value.source.includes("#")) fail("source must be <package>#<leaf-freeze ref>");
  if (!strings(value.extensions)) fail("extensions must be a list of slot ids");
  if (!Array.isArray(value.nodes)) { fail("nodes must be a list"); return issues; }
  const seen = new Set<string>(), nodeIds = new Set<string>();
  for (const node of value.nodes) {
    if (!object(node) || !nonEmpty(node.id) || !NODE_ID.test(node.id) || !nonEmpty(node.label) || !Array.isArray(node.children)) { fail("invalid L1 node"); continue; }
    if (nodeIds.has(node.id)) fail(`duplicate L1 ${node.id}`);
    nodeIds.add(node.id);
    const childIds = new Set<string>();
    for (const child of node.children) {
      if (!object(child) || !nonEmpty(child.id) || !NODE_ID.test(child.id) || !nonEmpty(child.label) || !strings(child.slots)) { fail(`invalid L2 node under ${node.id}`); continue; }
      if (childIds.has(child.id)) fail(`duplicate L2 ${node.id}/${child.id}`);
      childIds.add(child.id);
      for (const slot of child.slots) {
        if (!SLOT_ID.test(slot)) fail(`invalid slot id ${slot}`);
        else if (agent === SEAT_AGENT && seatStepOf(slot) === undefined) fail(`producer slot id ${slot} must be ${SEAT_PREFIX}<step-id>`);
        else if (agent !== undefined && agent !== SEAT_AGENT && slot.startsWith(SEAT_PREFIX)) fail(`slot id ${slot} is in the producer seat namespace`);
        if (seen.has(slot)) fail(`slot ${slot} appears twice`);
        seen.add(slot);
      }
    }
  }
  if (strings(value.extensions)) for (const id of value.extensions) if (!seen.has(id)) fail(`extension ${id} is not placed in the IA`);
  if (value.layers !== undefined) validateLayers(value.layers, value.nodes, fail);
  // The declared axes (R01.7) and the owner-authorized change records (IA-V) are held to ia.schema.json itself.
  if (value.axes !== undefined || value.changes !== undefined) {
    const schema = loadSchema("ia");
    const part = { type: "object", $defs: schema.$defs, properties: { axes: schema.properties!.axes!, changes: schema.properties!.changes! } };
    for (const issue of validateValue({ ...(value.axes !== undefined ? { axes: value.axes } : {}), ...(value.changes !== undefined ? { changes: value.changes } : {}) }, part)) fail(`${issue.path.slice(1)} ${issue.message}`);
  }
  return issues;
}

/** Layers must cover every L1 exactly once, either whole or as all of its L2 groups. */
function validateLayers(layers: unknown, nodes: unknown[], fail: (message: string) => void): void {
  if (!Array.isArray(layers)) { fail("layers must be a list"); return; }
  const groups = new Map<string, Set<string>>();
  for (const node of nodes) if (object(node) && nonEmpty(node.id) && Array.isArray(node.children)) groups.set(node.id, new Set(node.children.filter(object).map(child => String(child.id))));
  const ids = new Set<string>(), whole = new Set<string>(), parts = new Map<string, Set<string>>();
  for (const layer of layers) {
    if (!object(layer) || !nonEmpty(layer.id) || !NODE_ID.test(layer.id) || !nonEmpty(layer.label) || !strings(layer.nodes) || !layer.nodes.length) { fail("invalid layer"); continue; }
    if (ids.has(layer.id)) fail(`duplicate layer ${layer.id}`);
    ids.add(layer.id);
    for (const ref of layer.nodes) {
      const [l1 = "", l2, extra] = ref.split("/");
      const children = groups.get(l1);
      if (!children || extra !== undefined || (l2 !== undefined && !children.has(l2))) { fail(`layer ${layer.id} names unknown node ${ref}`); continue; }
      if (l2 === undefined) {
        if (whole.has(l1) || parts.has(l1)) fail(`layer node ${l1} appears twice`);
        whole.add(l1);
      } else {
        const seenParts = parts.get(l1) ?? new Set<string>();
        if (whole.has(l1) || seenParts.has(l2)) fail(`layer node ${ref} appears twice`);
        seenParts.add(l2); parts.set(l1, seenParts);
      }
    }
  }
  for (const [l1, children] of groups) {
    const seenParts = parts.get(l1);
    if (!whole.has(l1) && !seenParts) fail(`L1 ${l1} is in no layer`);
    else if (seenParts) for (const l2 of children) if (!seenParts.has(l2)) fail(`L2 ${l1}/${l2} is in no layer`);
  }
}

/** True when a `notNeeded` marker is not {reason, since, decidedBy} with a non-empty reason, an ISO date and who decided. */
export function notNeededIssue(marker: unknown): boolean {
  return !object(marker) || Object.keys(marker).some(key => key !== "reason" && key !== "since" && key !== "decidedBy") || !nonEmpty(marker.reason)
    || typeof marker.since !== "string" || !/^\d{4}-\d{2}-\d{2}/.test(marker.since) || Number.isNaN(Date.parse(marker.since))
    || typeof marker.decidedBy !== "string" || !DECIDED_BY.test(marker.decidedBy);
}

export function validateSlotDoc(value: unknown, path = "slot.json"): SlotModelIssue[] {
  const issues: SlotModelIssue[] = [];
  const fail = (message: string) => issues.push({ code: "slot-invalid", path, message });
  if (!object(value)) { fail("expected an object"); return issues; }
  const allowed = new Set(["schema", "id", "agent", "ia", "kind", "standard", "contract", "inputs", "uses", "notNeeded", "options", "varyOn", "extension"]);
  for (const key of Object.keys(value)) if (!allowed.has(key)) fail(`unknown key ${key}${key === "usedBy" ? " (usedBy is computed, never stored)" : ""}`);
  if (value.schema !== SLOT_SCHEMA) fail(`schema must be ${SLOT_SCHEMA}`);
  if (!nonEmpty(value.id) || !SLOT_ID.test(value.id)) fail("id must be a slot id");
  const agent = MODEL_AGENTS.includes(value.agent as ModelAgent) ? value.agent as ModelAgent : undefined;
  if (!agent) fail("agent must be director, designer, writer, publisher or producer");
  if (!SLOT_KINDS.includes(value.kind as SlotKind)) fail(`kind must be ${SLOT_KINDS.join(", ")}`);
  else if (agent && !AGENT_KIND[agent].includes(value.kind as SlotKind)) fail(`kind ${String(value.kind)} does not belong to ${String(value.agent)}`);
  if (nonEmpty(value.id) && agent === SEAT_AGENT && seatStepOf(value.id) === undefined) fail(`producer slot id must be ${SEAT_PREFIX}<step-id>`);
  if (value.standard !== undefined && (typeof value.standard !== "string" || !STANDARD_ID.test(value.standard))) fail("standard must be a standard id such as element.button");
  if (value.extension !== undefined && typeof value.extension !== "boolean") fail("extension must be true or false");
  const ia = value.ia;
  if (!object(ia) || !nonEmpty(ia.l1) || !nonEmpty(ia.l2) || !Number.isSafeInteger(ia.order) || (ia.order as number) < 0 || (ia.l0 !== undefined && !nonEmpty(ia.l0))) fail("ia must be {l0?, l1, l2, order}");
  if (!object(value.contract)) fail("contract must be an object");
  else issues.push(...contractIssues(value.kind as SlotKind, value.contract, typeof value.id === "string" ? value.id : "", path));
  for (const key of ["inputs", "uses"] as const) {
    if (!strings(value[key])) fail(`${key} must be a list of slot ids`);
    else for (const id of value[key] as string[]) if (!SLOT_ID.test(id)) fail(`${key} names an invalid slot id ${id}`);
  }
  if (value.notNeeded !== undefined && notNeededIssue(value.notNeeded)) fail("notNeeded must be {reason, since, decidedBy} with a non-empty reason, an ISO date and who decided");
  issues.push(...optionIssues(value, path));
  return issues;
}

/**
 * The options rules of a slot in either format: options is 1, 2 or 3; varyOn is an axis id; varyOn is required
 * when options > 1. validateSlotDoc applies them to a slot/1 document, slotReadIssues to a slot/2 one.
 */
export function optionIssues(value: Readonly<Record<string, unknown>>, path = "slot.json"): SlotModelIssue[] {
  const issues: SlotModelIssue[] = [];
  const fail = (message: string) => issues.push({ code: "slot-invalid", path, message });
  if (value.options !== undefined && !(OPTION_COUNTS as readonly unknown[]).includes(value.options)) fail("options must be 1, 2 or 3");
  if (value.varyOn !== undefined && (typeof value.varyOn !== "string" || !VARY_ID.test(value.varyOn))) fail("varyOn must be an axis id such as tone");
  if (typeof value.options === "number" && value.options > 1 && value.varyOn === undefined) fail("varyOn is required when options > 1");
  return issues;
}

/**
 * A kind's contract, beyond the object shape: the seat contract against contract-seat.schema.json,
 * a contract declaring `clossys.slot-contract/1` against the slot contract schema (naming this slot),
 * every kind's fixture by its shape. validateSlotDoc applies it to a slot/1 document, slotReadIssues to a
 * slot/2 one by its kind family.
 */
export function contractIssues(kind: SlotKind, contract: Record<string, unknown>, id: string, path: string): SlotModelIssue[] {
  if (kind === "seat") return seatContractIssues(contract, id, path);
  const issues = contract.schema === RECORD_SCHEMA_IDS.slotContract ? slotContractIssues(contract, id, path) : [];
  if (!SLOT_KINDS.includes(kind) || contract.fixture === undefined) return issues;
  return [...issues, ...fixtureShapeIssues(kind, contract).map(message => ({ code: "slot-invalid" as const, path, message: `contract.fixture ${message}` }))];
}

/** A `clossys.slot-contract/1` contract: the slot contract schema and its semantics (records/validate.ts), and `slot` naming this slot. */
export function slotContractIssues(contract: Readonly<Record<string, unknown>>, id: string, path = "slot.json"): SlotModelIssue[] {
  const result = validateSlotContract(contract);
  const issues: SlotModelIssue[] = result.ok ? [] : result.issues.map(issue => ({ code: "slot-invalid", path, message: `contract${issue.path === "$" || issue.path === "/" ? "" : ` ${issue.path}`} ${issue.message} (${RECORD_SCHEMA_IDS.slotContract})` }));
  if (id && contract.slot !== id) issues.push({ code: "slot-invalid", path, message: `contract.slot must be ${id}, the slot's own id` });
  return issues;
}

/** A seat slot's contract: `{step, fixture: {step}}`, the step being the id after `seat.`; the sample seat is package data (pipeline/seats.json). */
export function seatContractIssues(contract: unknown, id: string, path = "slot.json"): SlotModelIssue[] {
  const issues: SlotModelIssue[] = validateValue(contract, loadSchema("contract-seat")).map(issue => ({ code: "slot-invalid", path, message: `contract${issue.path === "/" ? "" : issue.path} ${issue.message}` }));
  if (!object(contract)) return issues;
  const step = seatStepOf(id);
  if (step !== undefined && contract.step !== step) issues.push({ code: "slot-invalid", path, message: `contract.step must be ${step}` });
  if (object(contract.fixture) && contract.fixture.step !== contract.step) issues.push({ code: "slot-invalid", path, message: "contract.fixture.step must equal contract.step" });
  return issues;
}

/**
 * The fixture a contract carries (R01.3), by kind. element: a `clossys.element-preview/1` preview with
 * `fixtures {file, export, props}` (contract-fixture.ts); brief: the required `headings`; strings:
 * the required `keys` and `locales`; page and publication: a sample `route` entry `{path}`; seat:
 * the `step` id only (the sample seat is package data). Empty when the fixture has the kind's shape.
 */
export function fixtureShapeIssues(kind: SlotKind, contract: Readonly<Record<string, unknown>>): string[] {
  const fixture = contract.fixture;
  if (fixture === undefined) return ["is missing"];
  if (!object(fixture)) return ["must be an object"];
  const list = (key: string) => (Array.isArray(fixture[key]) && (fixture[key] as unknown[]).length > 0 && (fixture[key] as unknown[]).every(nonEmpty) ? [] : [`${key} must be a non-empty list of strings`]);
  switch (kind) {
    case "element": return contractFixtureIssues(contract).map(issue => issue.message.replace(/^contract\.fixture /, ""));
    case "brief": return list("headings");
    case "strings": return [...list("keys"), ...list("locales")];
    case "page": case "publication": return object(fixture.route) && typeof fixture.route.path === "string" && fixture.route.path.startsWith("/") ? [] : ["route must be a sample route entry {path: \"/...\"}"];
    case "seat": {
      // The sample seat is the package default (pipeline/seats.json, checked against seat.schema.json by
      // check:pipeline-seats); a consumer contract that carries one redefines package data.
      const issues = nonEmpty(fixture.step) ? [] : ["step must be the step id"];
      if (Object.hasOwn(fixture, "seat")) issues.push("seat is package data (@clossys/producer pipeline/seats.json): the contract fixture names the step only");
      return issues;
    }
  }
}

/** pin.json against the one pin schema (planner R9): @clossys/director pinIssues, the same verdict Director's parseSlotPin and scripts/check-decisions.mjs give. */
/**
 * A slot's pin.json in any format a store holds: the int2 pin (pin/1, no schema key), the target `clossys.pin/2`
 * or a Writer Prose or Copy slot's `clossys.pin-map/1`. Each is judged by its own schema and rules; readers then
 * take the pinned record(s) through pinRecords / pinView, never the raw document.
 */
export function validatePin(value: unknown, path = "pin.json"): SlotModelIssue[] {
  const schema = object(value) ? value.schema : undefined;
  const found = schema === PIN2_SCHEMA ? targetPinIssues(value) : schema === PIN_MAP_SCHEMA ? pinMapIssues(value) : pinIssues(value);
  return found.map(message => ({ code: "pin-invalid", path, message }));
}

const PIN2_SCHEMA = "clossys.pin/2", PIN_MAP_SCHEMA = "clossys.pin-map/1";
const PIN_RECORD_KEYS = ["candidate", "sha256", "decidedBy", "basis", "at", "confirmed"] as const;

/** The int2 PinDoc fields of one pinned record; a pin/2's COMMON block is dropped. */
function recordView(record: Record<string, unknown>): PinDoc {
  const out: Record<string, unknown> = {};
  for (const key of PIN_RECORD_KEYS) if (record[key] !== undefined) out[key] = record[key];
  return out as unknown as PinDoc;
}

/** Every pinned record of a pin.json that validatePin passed: pin/1 as it is, a pin/2's record, a pin map's records in record order. */
export function pinRecords(value: unknown): PinDoc[] {
  if (!object(value)) return [];
  if (value.schema === PIN_MAP_SCHEMA) {
    const records = object(value.records) ? value.records : {};
    return Object.keys(records).sort().flatMap(key => object(records[key]) ? [recordView(records[key] as Record<string, unknown>)] : []);
  }
  return [recordView(value)];
}

/** The slot's pin as one record (a pin map's first record in record order); undefined when nothing is pinned. */
export function pinView(value: unknown): PinDoc | undefined {
  return pinRecords(value)[0];
}

/** The source kinds a candidate carries: the int2 kinds and the candidate/1 header's `package-default` (a package template adopted as it is). */
const CANDIDATE_SOURCE_KINDS: readonly string[] = [...SOURCE_KINDS, "package-default"];

export function validateSource(value: unknown, path: string): SlotModelIssue[] {
  const fail = (message: string): SlotModelIssue[] => [{ code: "candidate-source", path, message }];
  if (!object(value)) return fail("source must be {kind, ref, parts?, hash?, license?}");
  for (const key of Object.keys(value)) if (!["kind", "ref", "parts", "hash", "license"].includes(key)) return fail(`source has unknown key ${key}`);
  if (!CANDIDATE_SOURCE_KINDS.includes(value.kind as string)) return fail("source.kind must be registry, derived, original, composition, npm, interactive-backdrop or package-default");
  if (!strings(value.ref)) return fail("source.ref must be a list");
  if (value.kind === "composition") {
    // A composition cites no reference of its own: its proof is the parts list, checked by ref-verbatim.
    if (!Array.isArray(value.parts) || value.parts.length === 0) return fail("source.kind composition needs a non-empty parts list");
    const seen = new Set<string>();
    for (const part of value.parts) {
      if (!object(part) || Object.keys(part).some(key => key !== "slot" && key !== "files")) return fail("each source part must be {slot, files}");
      if (typeof part.slot !== "string" || !SLOT_ID.test(part.slot) || seen.has(part.slot)) return fail("each source part names one distinct slot id");
      if (!strings(part.files) || part.files.length === 0 || part.files.some(file => !file)) return fail(`source part ${part.slot} needs its vendored reference paths`);
      seen.add(part.slot);
    }
  } else if (value.parts !== undefined) return fail(`source.kind ${value.kind} takes no parts`);
  else if (value.kind === "npm" && (value.ref.length !== 1 || !NPM_SOURCE_REF.test(value.ref[0]!))) return fail("source.kind npm needs exactly one ref npm/<package>@<exact version>");
  else if (value.kind === INTERACTIVE_BACKDROP_KIND) { if (value.ref.length !== 0) return fail(`source.kind ${INTERACTIVE_BACKDROP_KIND} cites nothing: source.ref must be []`); }
  else if (value.kind !== "original" && value.kind !== "package-default" && value.ref.length === 0) return fail(`source.kind ${value.kind} needs at least one ref`);
  if (value.hash !== undefined && typeof value.hash !== "string") return fail("source.hash must be a string");
  if (value.license !== undefined && typeof value.license !== "string") return fail("source.license must be a string");
  return [];
}

/** A candidate's variation tag: exactly one `{"<axis>": "<value>"}` pair (CANDIDATE-OPTIONS). */
export function validVary(value: unknown): value is Record<string, string> {
  if (!object(value)) return false;
  const entries = Object.entries(value);
  return entries.length === 1 && VARY_ID.test(entries[0]![0]) && typeof entries[0]![1] === "string" && VARY_ID.test(entries[0]![1]);
}

/** Pin state and legacy provenance keys never appear on the candidate's own record level. */
function candidateKeys(record: Record<string, unknown>, path: string, where: string): SlotModelIssue[] {
  const issues: SlotModelIssue[] = [];
  for (const key of Object.keys(record)) {
    if ((CANDIDATE_STATUS_KEYS as readonly string[]).includes(key)) issues.push({ code: "candidate-status", path, message: `${where}${key} is pin state; pinning lives only in pin.json` });
    if ((LEGACY_PROVENANCE_KEYS as readonly string[]).includes(key)) issues.push({ code: "candidate-source", path, message: `${where}${key} is replaced by the single source key` });
  }
  return issues;
}

const REGISTRY_TYPES = new Set(["registry:ui", "registry:block", "registry:component", "registry:lib", "registry:hook", "registry:page", "registry:file", "registry:style", "registry:theme", "registry:item", "registry:base", "registry:font"]);

function validateBrief(fields: Record<string, unknown>, body: string, slot: string, path: string): SlotModelIssue[] {
  const issues: SlotModelIssue[] = [];
  const fail = (message: string) => issues.push({ code: "candidate-invalid", path, message });
  for (const key of Object.keys(fields)) if (!["slot", "source", "feeds", "functions", "note", "vary"].includes(key) && !(CANDIDATE_STATUS_KEYS as readonly string[]).includes(key) && !(LEGACY_PROVENANCE_KEYS as readonly string[]).includes(key)) fail(`unknown frontmatter key ${key}`);
  if (fields.slot !== slot) fail(`slot must be ${slot}`);
  if (!strings(fields.feeds) || !strings(fields.functions)) fail("feeds and functions must be lists");
  if (fields.note !== undefined && typeof fields.note !== "string") fail("note must be a string");
  const headings = body.split("\n").filter(line => line.startsWith("## ")).map(line => line.slice(3));
  if (headings.join("|") !== "Direction|Because|Watch") fail("body must be ## Direction, ## Because, ## Watch");
  return issues;
}

function validateStrings(fields: Record<string, unknown>, body: string, slot: string, path: string): SlotModelIssue[] {
  const issues: SlotModelIssue[] = [];
  const fail = (message: string) => issues.push({ code: "candidate-invalid", path, message });
  for (const key of Object.keys(fields)) if (!["slot", "locales", "source", "vary", "reason"].includes(key) && !(CANDIDATE_STATUS_KEYS as readonly string[]).includes(key) && !(LEGACY_PROVENANCE_KEYS as readonly string[]).includes(key)) fail(`unknown frontmatter key ${key}`);
  if (fields.slot !== slot) fail(`slot must be ${slot}`);
  // The Writer equivalent of meta.element.reason: the pinned Director slot the copy realises (R20, records/director-trace.ts).
  if (fields.reason !== undefined && (typeof fields.reason !== "string" || !fields.reason.trim())) fail("reason must be a non-empty string");
  if (!strings(fields.locales) || !fields.locales.length) { fail("locales must be a non-empty list"); return issues; }
  const lines = body.split(/\r?\n/);
  const seen: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.startsWith("## ")) { seen.push(line.slice(3)); continue; }
    if (!line.startsWith("### ")) continue;
    const meta = /^<!-- (.+) -->$/.exec(lines[i + 1] ?? "");
    if (!meta) { fail(`record ${line.slice(4)} needs one <!-- {"id","bindings"} --> line`); continue; }
    let record: unknown;
    try { record = JSON.parse(meta[1]!); } catch { fail(`record ${line.slice(4)} metadata is not JSON`); continue; }
    if (!object(record) || typeof record.id !== "string" || !Array.isArray(record.bindings)) { fail(`record ${line.slice(4)} metadata needs id and bindings`); continue; }
    if (Object.hasOwn(record, "leaf")) fail(`record ${line.slice(4)} carries leaf; the slot is the leaf`);
    issues.push(...candidateKeys(record, path, `record ${line.slice(4)}: `));
  }
  if (seen.join("\0") !== (fields.locales as string[]).join("\0")) fail("## <locale> sections must match locales in order");
  return issues;
}

function validateJsonCandidate(kind: SlotKind, value: Record<string, unknown>, slot: string, path: string): SlotModelIssue[] {
  const issues: SlotModelIssue[] = [];
  const fail = (message: string) => issues.push({ code: "candidate-invalid", path, message });
  const meta = value.meta;
  if (!object(meta)) { issues.push({ code: "candidate-source", path, message: "meta.source is required" }); return issues; }
  issues.push(...candidateKeys(value, path, ""), ...candidateKeys(meta, path, "meta."));
  if (!Object.hasOwn(meta, "source")) issues.push({ code: "candidate-source", path, message: "meta.source is required" });
  if (meta.vary !== undefined && !validVary(meta.vary)) fail('meta.vary must be {"<axis>": "<value>"} with one axis');
  else issues.push(...validateSource(meta.source, path));
  // An interactive backdrop (foundry-build-0048 A4) is a Designer element that is only a descriptor over a Foundry component.
  const sourceKind = object(meta.source) ? meta.source.kind : undefined;
  if (Object.hasOwn(meta, "backdrop") && sourceKind !== INTERACTIVE_BACKDROP_KIND) issues.push({ code: "candidate-source", path, message: `meta.backdrop is only for source.kind ${INTERACTIVE_BACKDROP_KIND}, not ${String(sourceKind ?? "(none)")}` });
  if (sourceKind === INTERACTIVE_BACKDROP_KIND) {
    if (kind !== "element") issues.push({ code: "candidate-source", path, message: `source.kind ${INTERACTIVE_BACKDROP_KIND} is a Designer element kind, not a ${kind} candidate` });
    else issues.push(...interactiveBackdropCandidateIssues(value).map(message => ({ code: "candidate-source" as const, path, message })));
  }
  if (kind === "element") {
    if (typeof value.name !== "string" || !value.name) fail("registry-item name is required");
    if (!REGISTRY_TYPES.has(value.type as string)) fail("registry-item type must be a registry:* type");
    if (!Array.isArray(value.files) || value.files.some(file => !object(file) || typeof file.path !== "string" || typeof file.type !== "string" || typeof file.content !== "string")) fail("files[] must carry path, type and inline content");
    if (value.registryDependencies !== undefined && !strings(value.registryDependencies)) fail("registryDependencies must be a list");
    if (value.type === "registry:theme" && value.cssVars !== undefined && !object(value.cssVars)) fail("cssVars must be an object");
    if (meta.slot !== undefined && meta.slot !== slot) fail(`meta.slot must be ${slot}`);
  } else if (kind === "page") {
    if (value.schema !== PAGE_SCHEMA) fail(`schema must be ${PAGE_SCHEMA}`);
    if (typeof value.title !== "string" || !value.title) fail("title is required");
    if ((typeof value.path === "string") === (typeof value.slug === "string")) fail("exactly one of path or slug is required");
    if (value.frame !== null && (typeof value.frame !== "string" || !SLOT_ID.test(value.frame))) fail("frame must be a slot id or null");
    if (!strings(value.sections) || value.sections.some(target => !SLOT_ID.test(target))) fail("sections must be a list of slot ids");
    const refs = (copy: unknown) => object(copy) && Object.values(copy).every(target => typeof target === "string" && WRITER_KEY_REF.test(target));
    if (!refs(value.copy)) fail("copy must map copy slots to Writer keys (<writer slot>#<key>)");
    if (value.bindings !== undefined && (!object(value.bindings) || Object.entries(value.bindings).some(([key, binding]) => !INSTANCE_KEY.test(key) || !object(binding) || binding.copy !== undefined && !refs(binding.copy)))) {
      fail("bindings must map section instance keys (<slot>[#n]) to copy slot to Writer key bindings");
    }
  } else if (kind === "publication") {
    if (value.schema !== PUBLICATION_SCHEMA) fail(`schema must be ${PUBLICATION_SCHEMA}`);
    if (typeof value.format !== "string" || !value.format) fail("format is required");
    if (!strings(value.entryOrder)) fail("entryOrder must be a list");
    if (value.routePack !== undefined && !object(value.routePack)) fail("routePack must be an object");
    // The install outputs: the one shared check (unknown keys, https origin, forms, locales), refused at submit and pin, not at read.
    if (value.outputs !== undefined) for (const issue of checkPublicationOutputs(value.outputs)) fail(issue);
  }
  return issues;
}

/** Validate one candidate's bytes for its slot kind. */
export function validateCandidate(kind: SlotKind, slot: string, name: string, bytes: string, path = name): SlotModelIssue[] {
  const match = CANDIDATE_NAME.exec(name);
  if (!match) return [{ code: "candidate-name", path, message: "candidate file name must be <name>-v<n>.<ext>" }];
  if (match[3] !== KIND_EXT[kind]) return [{ code: "candidate-name", path, message: `${kind} candidates are .${KIND_EXT[kind]}` }];
  if (KIND_EXT[kind] === "md") {
    const parsed = parseFrontmatter(bytes);
    if (!parsed.ok) return [{ code: "candidate-invalid", path, message: parsed.message }];
    const fields = parsed.value.fields as Record<string, unknown>;
    const issues = candidateKeys(fields, path, "frontmatter ");
    if (!Object.hasOwn(fields, "source")) issues.push({ code: "candidate-source", path, message: "frontmatter source is required" });
    else issues.push(...validateSource(fields.source, path));
    if (object(fields.source) && fields.source.kind === INTERACTIVE_BACKDROP_KIND) issues.push({ code: "candidate-source", path, message: `source.kind ${INTERACTIVE_BACKDROP_KIND} is a Designer element kind, not a ${kind} candidate` });
    if (fields.vary !== undefined && !validVary(fields.vary)) issues.push({ code: "candidate-invalid", path, message: 'vary must be {"<axis>": "<value>"} with one axis' });
    return [...issues, ...(kind === "brief" ? validateBrief(fields, parsed.value.body, slot, path) : validateStrings(fields, parsed.value.body, slot, path))];
  }
  let value: unknown;
  try { value = JSON.parse(bytes); } catch { return [{ code: "candidate-invalid", path, message: "candidate is not JSON" }]; }
  if (!object(value)) return [{ code: "candidate-invalid", path, message: "candidate must be a JSON object" }];
  // A seat candidate is the seat itself (seat.schema.json): who decides the step, no source metadata.
  if (kind === "seat") return validateValue(value, loadSchema("seat")).map(issue => ({ code: "candidate-invalid", path, message: `${issue.path} ${issue.message}` }));
  return validateJsonCandidate(kind, value, slot, path);
}

export type { IaDoc, PinDoc, SlotDoc };
