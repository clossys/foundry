/** Pure projection of a pinned publication from slot records the one slot-model
 * reader supplies (Producer `records/slots.ts`). Publisher opens no files: the
 * source hands it raw record text and the reader's sha256 of each candidate.
 * A pin is data, never serving approval. */
import { checkContentMap } from "./check.js";
import type { ContentMap } from "./contract.js";
import { PAGE_ID, pageId } from "./page-identity.js";

/** Raw slot records for one consumer's `agents/publisher`, as the slot-model reader reads them.
 * Each returns `undefined` when the record is absent; aliases and irregular files throw. */
export interface PinnedPublicationSource {
  /** `agents/publisher/ia.json` text. */
  ia(): string | undefined;
  /** One slot folder's `slot.json` or `pin.json` text. */
  record(slotId: string, file: "slot.json" | "pin.json"): string | undefined;
  /** One candidate's text and the reader's sha256 of its bytes. */
  candidate(slotId: string, name: string): { readonly bytes: string; readonly sha256: string } | undefined;
}

type JsonObject = Record<string, any>;
interface Position { l1: string; l2: string; order: number }
export interface PinnedPublication {
  readonly map: ContentMap;
  readonly routePack?: Record<string, unknown>;
}
const object = (value: unknown): value is JsonObject => value !== null && typeof value === "object" && !Array.isArray(value);
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(item => typeof item === "string");
const text = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const NODE_ID = /^[a-z0-9][a-z0-9.-]*$/;
const SLOT_ID = /^[a-z][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*){1,3}$/;
const CANDIDATE = /^[a-z0-9][a-z0-9.-]*-v[1-9][0-9]*\.json$/;
function fail(path: string, message: string): never { throw new TypeError(`${path}: ${message}`); }
function keys(value: JsonObject, allowed: readonly string[], path: string) {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) fail(path, `Unknown key ${key}`);
}
function safeSegment(value: unknown, pattern: RegExp, path: string): asserts value is string {
  if (typeof value !== "string" || !pattern.test(value) || value.includes("..")) fail(path, "Unsafe identity or path");
}
function present<T>(value: T | undefined, path: string): T {
  if (value === undefined) fail(path, "Missing native record (no legacy fallback)");
  return value;
}
function parse(source: string, path: string): JsonObject {
  let value: unknown;
  try { value = JSON.parse(source); } catch { fail(path, "Malformed JSON"); }
  if (!object(value)) fail(path, "Expected an object");
  return value;
}
function positions(records: PinnedPublicationSource): Map<string, Position> {
  const ia = parse(present(records.ia(), "ia.json"), "ia.json");
  if (ia.schema !== "clossys.ia/1" || !text(ia.source) || !ia.source.includes("#") || !strings(ia.extensions) || !Array.isArray(ia.nodes)) fail("ia.json", "Invalid Publisher IA");
  const result = new Map<string, Position>(), nodes = new Set<string>();
  let order = 0;
  for (const node of ia.nodes) {
    if (!object(node) || !text(node.label) || !Array.isArray(node.children)) fail("ia.json", "Invalid L1 node");
    safeSegment(node.id, NODE_ID, "ia.json");
    if (nodes.has(node.id)) fail(node.id, "Duplicate L1 identity"); nodes.add(node.id);
    const children = new Set<string>();
    for (const child of node.children) {
      if (!object(child) || !text(child.label) || !strings(child.slots)) fail(node.id, "Invalid L2 node");
      safeSegment(child.id, NODE_ID, "ia.json");
      if (children.has(child.id)) fail(child.id, "Duplicate L2 identity"); children.add(child.id);
      for (const id of child.slots) {
        safeSegment(id, SLOT_ID, "ia.json");
        if (result.has(id)) fail(id, "Duplicate IA slot");
        result.set(id, { l1: node.id, l2: child.id, order: order++ });
      }
    }
  }
  for (const id of ia.extensions) if (!result.has(id)) fail(id, "Unplaced IA extension");
  return result;
}
function source(value: unknown, path: string) {
  if (!object(value) || !["registry", "derived", "original"].includes(value.kind) || !strings(value.ref) || value.kind !== "original" && !value.ref.length) fail(path, "Invalid meta.source");
  keys(value, ["kind", "ref", "hash", "license"], path);
  for (const key of ["hash", "license"]) if (value[key] !== undefined && typeof value[key] !== "string") fail(path, `Invalid source.${key}`);
}
function candidate(value: JsonObject, kind: "page" | "publication", path: string) {
  if (value.schema !== `clossys.${kind}/1` || !object(value.meta)) fail(path, `Invalid native ${kind} schema`);
  source(value.meta.source, path);
  for (const record of [value, value.meta]) for (const key of ["status", "active", "confirmed", "pinned", "lineage", "cites", "links", "sources", "originKinds", "origin", "original"]) {
    if (Object.hasOwn(record, key)) fail(path, `Invalid candidate key ${key}`);
  }
  if (kind === "publication") {
    if (!text(value.format) || !strings(value.entryOrder) || value.routePack !== undefined && !object(value.routePack)) fail(path, "Invalid publication contract");
  } else {
    if (!text(value.title) || (typeof value.path === "string") === (typeof value.slug === "string")
      || value.path !== undefined && typeof value.path !== "string" || value.slug !== undefined && typeof value.slug !== "string"
      || value.frame !== null && typeof value.frame !== "string" || !strings(value.sections)
      || !object(value.copy) || Object.values(value.copy).some(ref => typeof ref !== "string" || !/^[^#\s]+#[^#\s]+$/.test(ref))) fail(path, "Invalid page contract");
  }
}
function pinned(records: PinnedPublicationSource, index: Map<string, Position>, id: string, kind: "page" | "publication") {
  const position = index.get(id); if (!position) fail(id, "Slot is not declared in Publisher IA");
  // Flat layout: agents/publisher/<slot-id>; grouping lives only in ia.json + slot.json ia.
  const dir = id, slotPath = `${dir}/slot.json`;
  const slot = parse(present(records.record(id, "slot.json"), slotPath), slotPath);
  keys(slot, ["schema", "id", "agent", "ia", "kind", "contract", "inputs", "uses"], slotPath);
  if (slot.schema !== "clossys.slot/1" || slot.id !== id || slot.agent !== "publisher" || slot.kind !== kind || !object(slot.ia)
    || slot.ia.l1 !== position.l1 || slot.ia.l2 !== position.l2 || slot.ia.order !== position.order || slot.ia.l0 !== undefined
    || !object(slot.contract) || !strings(slot.inputs) || !strings(slot.uses)
    || [...slot.inputs, ...slot.uses].some(ref => !SLOT_ID.test(ref))) fail(slotPath, "Invalid slot identity, kind or IA position");
  keys(slot.ia, ["l1", "l2", "order"], slotPath);
  const pinPath = `${dir}/pin.json`, pin = parse(present(records.record(id, "pin.json"), pinPath), pinPath);
  keys(pin, ["candidate", "sha256", "decidedBy", "basis", "at", "recited"], pinPath);
  // A pointer-only re-cite (`clossys migrate recite`): the slot-model reader validates it and hands over the
  // candidate bytes with refs re-addressed; here it only has to be the {by, at, cites} record.
  if (pin.recited !== undefined && (!object(pin.recited) || !text(pin.recited.by) || !text(pin.recited.at) || !object(pin.recited.cites))) fail(pinPath, "Invalid pin recite");
  safeSegment(pin.candidate, CANDIDATE, pinPath);
  if (typeof pin.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(pin.sha256)
    || typeof pin.decidedBy !== "string" || !/^(?:(?:owner|planner|migration)(?::\S.*)?|agent:\S+|migrated)$/.test(pin.decidedBy)
    || !["picked", "bulk", "planner", "agent"].includes(pin.basis as string)
    || (pin.basis === "agent") !== pin.decidedBy.startsWith("agent:")
    || typeof pin.at !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(pin.at) || Number.isNaN(Date.parse(pin.at))) fail(pinPath, "Invalid pin");
  const path = `${dir}/candidates/${pin.candidate}`, raw = present(records.candidate(id, pin.candidate), path);
  if (raw.sha256 !== pin.sha256) fail(path, "Pinned candidate hash drift");
const value = parse(raw.bytes, path); candidate(value, kind, path);
  if (value.meta.slot !== undefined && value.meta.slot !== id) fail(path, "Conflicting candidate slot identity");
  return { slot, value };
}
function equal(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((item, i) => equal(item, b[i]));
  if (object(a) || object(b)) return object(a) && object(b) && Object.keys(a).length === Object.keys(b).length && Object.keys(a).every(key => Object.hasOwn(b, key) && equal(a[key], b[key]));
  return a === b;
}
function page(value: JsonObject, id: string, publicationId: string, parentId: string | undefined, order: number) {
  const meta = value.meta.entry ?? {};
  if (!object(meta) || meta.fields !== undefined && !object(meta.fields) || meta.blocks !== undefined && !object(meta.blocks)) fail(id, "Invalid entry metadata");
  if (meta.entryId !== undefined && meta.entryId !== id || meta.publication !== undefined && meta.publication !== publicationId) fail(id, "Native entry identity disagrees with publication");
  const f = meta.fields ?? {}, blocks = meta.blocks ?? {}, kind = f.kind ?? "page";
  keys(f, ["id", "kind", "title", "path", "slug", "planItemId", "frame", "sections", "href", "pageConfig", "icon", "description", "keywords", "indexing", "indexingReason", "lastModified", "note"], id);
  if (!["page", "slide", "section", "external"].includes(kind)) fail(id, "Invalid page entry kind");
  for (const key of ["title", "path", "slug", "frame", "sections"]) if (f[key] !== undefined && !equal(f[key], value[key])) fail(id, `Conflicting ${key} metadata`);
  if (f.id !== undefined && f.id !== pageId(id)) fail(id, "Conflicting page slot identity");
  if (value.nav !== undefined && (!object(value.nav) || value.nav.nav !== true || value.nav.group !== undefined && value.nav.group !== parentId)) fail(id, "Invalid navigation pin or group");
  if (meta.entryMeta !== undefined && (!object(meta.entryMeta) || !equal(meta.entryMeta.pin, value.nav))) fail(id, "Conflicting navigation metadata");
  if (f.planItemId !== undefined && (value.frame !== null || value.sections.length) || f.planItemId === undefined && kind !== "external" && typeof value.frame !== "string") fail(id, "Conflicting or missing source");
  if (kind === "external" && (value.frame !== null || value.sections.length || f.planItemId !== undefined || f.pageConfig !== undefined)) fail(id, "External page cannot carry a source");
  if (kind !== "external" && f.href !== undefined) fail(id, "Only external pages carry href");
  if (f.indexing === undefined && f.indexingReason !== undefined) fail(id, "indexingReason requires indexing");
  const entry: JsonObject = { id, ...(parentId ? { parentId } : {}), order, title: value.title, kind,
    ...(value.path === undefined ? { slug: value.slug } : { path: value.path }),
    ...(kind === "external" ? { href: f.href } : { source: f.planItemId === undefined ? { frameId: value.frame, sectionIds: value.sections } : { planItemId: f.planItemId } }),
    ...(value.nav === undefined ? {} : { pin: value.nav }) };
  for (const key of ["pageConfig", "icon", "description", "keywords", "lastModified"]) if (f[key] !== undefined) entry[key] = f[key];
  if (f.indexing !== undefined) entry.indexing = { mode: f.indexing, ...(f.indexingReason === undefined ? {} : { reason: f.indexingReason }) };
  for (const [block, key] of [["Constructs", "constructs"], ["Manifest", "manifest"], ["Actions", "actions"]] as const) if (blocks[block] !== undefined) entry[key] = blocks[block];
  if (blocks.Route !== undefined && !object(blocks.Route)) fail(id, "Route metadata must be an object");
  return { entry, route: blocks.Route as JsonObject | undefined };
}
/** Project only the native publication and page candidates named by intact pins.
 * No generated or legacy store is consulted, and nothing is written. */
export function projectPinnedPublication(records: PinnedPublicationSource, publicationId: string): PinnedPublication {
  safeSegment(publicationId, /^[a-z][a-z0-9.-]*$/, "publication");
  const index = positions(records);
  const { slot, value: publication } = pinned(records, index, `publication.${publicationId}`, "publication");
  const tree = publication.meta.tree;
  if (!object(tree) || tree.id !== publicationId) fail(publicationId, "Missing or conflicting publication tree snapshot");
  const groups = new Set<string>(), nodeIds = new Set<string>();
  const inspect = (node: unknown) => {
    if (!object(node) || !text(node.id) || !text(node.name) || node.cells !== undefined && !strings(node.cells) || node.children !== undefined && !Array.isArray(node.children)) fail(publicationId, "Invalid tree snapshot node");
    if (nodeIds.has(node.id)) fail(node.id, "Duplicate tree node"); nodeIds.add(node.id);
    if (node.entry !== undefined) {
      if (!object(node.entry) || node.entry.kind !== "group") fail(node.id, "Only explicit group entries belong in tree nodes");
      groups.add(node.id);
    }
    for (const child of node.children ?? []) inspect(child);
  };
  inspect(tree);
  const entryOrder = publication.entryOrder as string[], entryIds = new Set<string>(), identities = new Map<string, string>();
  for (const id of entryOrder) {
    if (!text(id) || entryIds.has(id)) fail(publicationId, "Duplicate or invalid entryOrder identity"); entryIds.add(id);
    if (groups.has(id)) continue;
    const canonical = pageId(id);
    if (identities.has(canonical)) fail(canonical, "Cell identity collision across entries"); identities.set(canonical, id);
  }
  for (const id of groups) if (!entryIds.has(id)) fail(id, "Group missing from entryOrder");
  const entries: JsonObject[] = [], routes = new Map<string, JsonObject>(), placed = new Set<string>();
  const walk = (node: JsonObject, parentId?: string, order = 0) => {
    let parent = parentId;
    if (node.entry !== undefined) { entries.push({ ...node.entry, id: node.id, title: node.name, order, ...(parentId ? { parentId } : {}) }); parent = node.id; }
    for (const [order, slotId] of (node.cells ?? []).entries()) {
      if (!PAGE_ID.test(slotId) || !identities.has(slotId)) fail(slotId, "Page reference has no stable entryOrder identity");
      if (placed.has(slotId)) fail(slotId, "Duplicate page placement"); placed.add(slotId);
      if (!slot.inputs.includes(slotId) || !slot.uses.includes(slotId)) fail(slotId, "Page is not declared by this publication");
      const { value } = pinned(records, index, slotId, "page"), id = identities.get(slotId)!;
      const parsed = page(value, id, publicationId, parent, order); entries.push(parsed.entry);
      if (parsed.route !== undefined) routes.set(id, parsed.route);
    }
    for (const [order, child] of (node.children ?? []).entries()) walk(child, parent, order);
  };
  walk(tree);
  for (const id of identities.keys()) if (!placed.has(id)) fail(id, "Unplaced publication page");
  entries.sort((a, b) => entryOrder.indexOf(a.id) - entryOrder.indexOf(b.id));
  const map: unknown = { version: 1, publicationId, format: publication.format, entries,
    ...(publication.actions === undefined ? {} : { actions: publication.actions }), ...(publication.redirects === undefined ? {} : { redirects: publication.redirects }) };
  const findings = checkContentMap(map);
  if (findings.length) fail(publicationId, `Content map refused: ${findings.map(f => `${f.code} ${f.path}`).join("; ")}`);
  if (publication.routePack === undefined) return { map: map as ContentMap };
  const header = publication.routePack;
  if (header.packId !== publicationId || Object.hasOwn(header, "routes") || header.homeRouteId !== undefined && (typeof header.homeRouteId !== "string" || !routes.has(header.homeRouteId))) fail(publicationId, "Conflicting route pack header");
  const compiled = entries.filter(entry => entry.kind !== "group").map(entry => {
    const metadata = routes.get(entry.id); if (!metadata) fail(entry.id, "Missing Route metadata");
    return { ...metadata, instanceId: entry.id, path: entry.path ?? `/${entry.slug}`, label: entry.title, ...(entry.keywords === undefined ? {} : { keywords: entry.keywords }) };
  });
  return { map: map as ContentMap, routePack: { ...header, routes: compiled } };
}
