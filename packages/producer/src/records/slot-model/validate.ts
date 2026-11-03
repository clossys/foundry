import { parseFrontmatter } from "./frontmatter.js";
import {
  AGENT_KIND, CANDIDATE_NAME, CANDIDATE_STATUS_KEYS, IA_SCHEMA, KIND_EXT, LEGACY_PROVENANCE_KEYS, NODE_ID, PAGE_SCHEMA,
  PUBLICATION_SCHEMA, SLOT_AGENTS, SLOT_ID, SLOT_KINDS, SLOT_SCHEMA, SOURCE_KINDS, INSTANCE_KEY, WRITER_KEY_REF,
  type IaDoc, type PinDoc, type SlotAgent, type SlotDoc, type SlotKind, type SourceDoc,
} from "./types.js";

/** Stable finding codes; `clossys migrate slots --check` and the mutation proofs name them. */
export type SlotModelCode =
  | "ia-invalid" | "slot-invalid" | "slot-mismatch" | "slot-missing" | "ia-path" | "orphan"
  | "pin-invalid" | "pin-candidate" | "pin-hash"
  | "candidate-name" | "candidate-invalid" | "candidate-source" | "candidate-status"
  | "ref-unknown" | "slot-state";
export interface SlotModelIssue { readonly code: SlotModelCode; readonly path: string; readonly message: string }

const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(item => typeof item === "string");
const nonEmpty = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;

export function validateIa(value: unknown, path = "ia.json"): SlotModelIssue[] {
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
        if (seen.has(slot)) fail(`slot ${slot} appears twice`);
        seen.add(slot);
      }
    }
  }
  if (strings(value.extensions)) for (const id of value.extensions) if (!seen.has(id)) fail(`extension ${id} is not placed in the IA`);
  if (value.layers !== undefined) validateLayers(value.layers, value.nodes, fail);
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

export function validateSlotDoc(value: unknown, path = "slot.json"): SlotModelIssue[] {
  const issues: SlotModelIssue[] = [];
  const fail = (message: string) => issues.push({ code: "slot-invalid", path, message });
  if (!object(value)) { fail("expected an object"); return issues; }
  const allowed = new Set(["schema", "id", "agent", "ia", "kind", "contract", "inputs", "uses", "notNeeded"]);
  for (const key of Object.keys(value)) if (!allowed.has(key)) fail(`unknown key ${key}${key === "usedBy" ? " (usedBy is computed, never stored)" : ""}`);
  if (value.schema !== SLOT_SCHEMA) fail(`schema must be ${SLOT_SCHEMA}`);
  if (!nonEmpty(value.id) || !SLOT_ID.test(value.id)) fail("id must be a slot id");
  if (!SLOT_AGENTS.includes(value.agent as SlotAgent)) fail("agent must be director, designer, writer or publisher");
  if (!SLOT_KINDS.includes(value.kind as SlotKind)) fail("kind must be brief, element, strings, page or publication");
  else if (SLOT_AGENTS.includes(value.agent as SlotAgent) && !AGENT_KIND[value.agent as SlotAgent].includes(value.kind as SlotKind)) fail(`kind ${String(value.kind)} does not belong to ${String(value.agent)}`);
  const ia = value.ia;
  if (!object(ia) || !nonEmpty(ia.l1) || !nonEmpty(ia.l2) || !Number.isSafeInteger(ia.order) || (ia.order as number) < 0 || (ia.l0 !== undefined && !nonEmpty(ia.l0))) fail("ia must be {l0?, l1, l2, order}");
  if (!object(value.contract)) fail("contract must be an object");
  for (const key of ["inputs", "uses"] as const) {
    if (!strings(value[key])) fail(`${key} must be a list of slot ids`);
    else for (const id of value[key] as string[]) if (!SLOT_ID.test(id)) fail(`${key} names an invalid slot id ${id}`);
  }
  if (value.notNeeded !== undefined) {
    const marker = value.notNeeded;
    if (!object(marker) || Object.keys(marker).some(key => key !== "reason" && key !== "since") || !nonEmpty(marker.reason)
      || typeof marker.since !== "string" || !/^\d{4}-\d{2}-\d{2}/.test(marker.since) || Number.isNaN(Date.parse(marker.since))) {
      fail("notNeeded must be {reason, since} with a non-empty reason and an ISO date");
    }
  }
  return issues;
}

export function validatePin(value: unknown, path = "pin.json"): SlotModelIssue[] {
  const issues: SlotModelIssue[] = [];
  const fail = (message: string) => issues.push({ code: "pin-invalid", path, message });
  if (!object(value)) { fail("expected an object"); return issues; }
  for (const key of Object.keys(value)) if (!["candidate", "sha256", "pinnedBy", "at"].includes(key)) fail(`unknown key ${key}`);
  if (!nonEmpty(value.candidate) || !CANDIDATE_NAME.test(value.candidate)) fail("candidate must be a candidate file name");
  if (typeof value.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(value.sha256)) fail("sha256 must be 64 lowercase hex");
  if (typeof value.pinnedBy !== "string" || !/^(owner:.+|migration:SLOT-MODEL)$/.test(value.pinnedBy)) fail("pinnedBy must be owner:<msg ref> or migration:SLOT-MODEL");
  if (typeof value.at !== "string" || Number.isNaN(Date.parse(value.at)) || !/^\d{4}-\d{2}-\d{2}T/.test(value.at)) fail("at must be an ISO timestamp");
  return issues;
}

export function validateSource(value: unknown, path: string): SlotModelIssue[] {
  const fail = (message: string): SlotModelIssue[] => [{ code: "candidate-source", path, message }];
  if (!object(value)) return fail("source must be {kind, ref, parts?, hash?, license?}");
  for (const key of Object.keys(value)) if (!["kind", "ref", "parts", "hash", "license"].includes(key)) return fail(`source has unknown key ${key}`);
  if (!SOURCE_KINDS.includes(value.kind as SourceDoc["kind"])) return fail("source.kind must be registry, derived, original or composition");
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
  else if (value.kind !== "original" && value.ref.length === 0) return fail(`source.kind ${value.kind} needs at least one ref`);
  if (value.hash !== undefined && typeof value.hash !== "string") return fail("source.hash must be a string");
  if (value.license !== undefined && typeof value.license !== "string") return fail("source.license must be a string");
  return [];
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
  for (const key of Object.keys(fields)) if (!["slot", "source", "feeds", "functions", "note"].includes(key) && !(CANDIDATE_STATUS_KEYS as readonly string[]).includes(key) && !(LEGACY_PROVENANCE_KEYS as readonly string[]).includes(key)) fail(`unknown frontmatter key ${key}`);
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
  for (const key of Object.keys(fields)) if (!["slot", "locales", "source"].includes(key) && !(CANDIDATE_STATUS_KEYS as readonly string[]).includes(key) && !(LEGACY_PROVENANCE_KEYS as readonly string[]).includes(key)) fail(`unknown frontmatter key ${key}`);
  if (fields.slot !== slot) fail(`slot must be ${slot}`);
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
  else issues.push(...validateSource(meta.source, path));
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
    return [...issues, ...(kind === "brief" ? validateBrief(fields, parsed.value.body, slot, path) : validateStrings(fields, parsed.value.body, slot, path))];
  }
  let value: unknown;
  try { value = JSON.parse(bytes); } catch { return [{ code: "candidate-invalid", path, message: "candidate is not JSON" }]; }
  if (!object(value)) return [{ code: "candidate-invalid", path, message: "candidate must be a JSON object" }];
  return validateJsonCandidate(kind, value, slot, path);
}

export type { IaDoc, PinDoc, SlotDoc };
