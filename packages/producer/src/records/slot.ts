/**
 * `clossys.slot/2` (release2 ia-target system.md 4, 6.1, 7, 9; flows F1, F4): the one slot format.
 *
 * - The package ships a base brief at `packages/<agent>/src/catalog/slots/<slot-id>/slot.json`.
 * - `clossys ia sync` copies it into the consumer `clossys/agents/<agent>/<slot-id>/slot.json` and records
 *   `base {package, version, path, sha256}`. Every field but `tighten`, `ia.order`, `status` and the CLI
 *   stamps (`createdBy`, `createdAt`, `updatedAt`, `consumedBy` refs) is computed from the base:
 *   `records.computed-match` fails a hand edit to one.
 * - The consumer may only make the brief stricter, through `tighten` entries (`brief.tighten-only`).
 * - A null `base` is the only mark of a consumer-added slot (F4).
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { PRODUCER_ROOT, packagePath } from "../package-path.js";
import { sha256Hex } from "./hash.js";
import { validateAgainst, type JsonSchema, type SchemaIssue } from "./schema.js";
import type { AgentId, Brief, Iso, Ref, Slot, Tighten, TightenOp } from "./types.js";

export const SLOT_SCHEMA = "clossys.slot/2";
export const SLOT_V1_SCHEMA = "clossys.slot/1";
export const SLOT_AGENTS: readonly AgentId[] = ["director", "designer", "writer", "publisher", "producer"];

// ---------------------------------------------------------------------------
// IA position
// ---------------------------------------------------------------------------

const iaSegment = (value: string): string => {
  const cleaned = value.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  return /^[a-z]/.test(cleaned) ? cleaned : `x${cleaned || "slot"}`;
};
const stripPrefix = (value: string, prefix: string): string => value.startsWith(`${prefix}.`) && value.length > prefix.length + 1 ? value.slice(prefix.length + 1) : value;

/**
 * The slot/2 slash-path `ia` of an ia.json position (`{l0?, l1, l2, order}`: the layer, the node id, the
 * child id and the global order): `l0`, `l0/<l1>`, `l0/<l1>/<l2>`, each segment without its parent's
 * dotted prefix. A missing `l0` is the id's first segment, a missing `l1` its first two, a missing `l2` the
 * `l1`; an order that is no non-negative integer is 0.
 */
export function positionIa(id: string, position: { readonly l0?: string; readonly l1?: string; readonly l2?: string; readonly order?: number } = {}): Slot["ia"] {
  const rawL0 = position.l0 ?? id.split(".")[0]!;
  const rawL1 = position.l1 ?? id.split(".").slice(0, 2).join(".");
  const rawL2 = position.l2 ?? rawL1;
  const l0 = iaSegment(rawL0);
  const l1 = `${l0}/${iaSegment(stripPrefix(rawL1, rawL0))}`;
  const l2 = `${l1}/${iaSegment(stripPrefix(stripPrefix(rawL2, rawL1), rawL0))}`;
  return { l0, l1, l2, order: Number.isInteger(position.order) && position.order! >= 0 ? position.order! : 0 };
}

// ---------------------------------------------------------------------------
// Reader and writer
// ---------------------------------------------------------------------------

const schemaCache = new Map<string, JsonSchema>();
/** A record schema shipped in packages/producer/schemas/ (`slot.json`, `queue-entry.json`, ...). */
export function recordSchema(file: string): JsonSchema {
  let schema = schemaCache.get(file);
  if (!schema) {
    schema = JSON.parse(readFileSync(join(PRODUCER_ROOT, "schemas", file), "utf8")) as JsonSchema;
    schemaCache.set(file, schema);
  }
  return schema;
}

export function validateSlot(doc: unknown): SchemaIssue[] {
  return validateAgainst(recordSchema("slot.json"), doc);
}

export class SlotFormatError extends Error {
  constructor(readonly file: string, readonly issues: readonly SchemaIssue[]) {
    super(`${file}: not a valid ${SLOT_SCHEMA}: ${issues.slice(0, 5).map(issue => `${issue.path} ${issue.message}`).join("; ")}`);
    this.name = "SlotFormatError";
  }
}

export function parseSlot(text: string, file = "slot.json"): Slot {
  let doc: unknown;
  try { doc = JSON.parse(text); } catch (error) { throw new SlotFormatError(file, [{ path: "$", message: `is not JSON (${(error as Error).message})` }]); }
  const issues = validateSlot(doc);
  if (issues.length) throw new SlotFormatError(file, issues);
  return doc as Slot;
}

export function readSlot(file: string): Slot {
  return parseSlot(readFileSync(file, "utf8"), file);
}

/** Key order of a written slot.json (the system.md 6.1 template). Unknown keys never survive validation. */
const SLOT_KEY_ORDER = ["schema", "id", "agent", "kind", "status", "ia", "createdBy", "createdAt", "updatedAt", "refs", "base", "standard", "brief", "contract", "tighten", "options", "varyOn"] as const;

/** The canonical bytes of a slot: template key order, two-space JSON, one trailing newline. */
export function serializeSlot(slot: Slot): string {
  const ordered: Record<string, unknown> = {};
  for (const key of SLOT_KEY_ORDER) if (slot[key] !== undefined) ordered[key] = slot[key];
  ordered.ia = { l0: slot.ia.l0, l1: slot.ia.l1, l2: slot.ia.l2, order: slot.ia.order };
  return `${JSON.stringify(ordered, null, 2)}\n`;
}

/** Validates, then writes the canonical bytes. Returns false (and writes nothing) when the bytes are already there. */
export function writeSlot(file: string, slot: Slot): boolean {
  const issues = validateSlot(slot);
  if (issues.length) throw new SlotFormatError(file, issues);
  const text = serializeSlot(slot);
  if (existsSync(file) && readFileSync(file, "utf8") === text) return false;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
  return true;
}

// ---------------------------------------------------------------------------
// Tighten: paths, ops and the stricter-only rule
// ---------------------------------------------------------------------------

type Segment = { key: string } | { select: string };

/**
 * `brief.mustDo`, `contract.copy.fields[header.heading].maxLength.en`: dot-separated keys; `[x]` selects the
 * array element whose `key`, `id` or `name` is x (or index x). Rooted at `brief` or `contract`.
 */
export function parseTightenPath(path: string): Segment[] | string {
  const out: Segment[] = [];
  let index = 0;
  while (index < path.length) {
    if (path[index] === "[") {
      const close = path.indexOf("]", index);
      if (close < 0) return `unclosed [ in ${path}`;
      out.push({ select: path.slice(index + 1, close) });
      index = close + 1;
      if (path[index] === ".") index += 1;
      continue;
    }
    let end = index;
    while (end < path.length && path[end] !== "." && path[end] !== "[") end += 1;
    const key = path.slice(index, end);
    if (!key) return `empty key in ${path}`;
    out.push({ key });
    index = path[end] === "." ? end + 1 : end;
  }
  const first = out[0];
  if (!first || !("key" in first) || (first.key !== "brief" && first.key !== "contract")) return `${path} must start at brief or contract`;
  return out;
}

function step(value: unknown, segment: Segment): unknown {
  if ("key" in segment) return isRecord(value) ? value[segment.key] : undefined;
  if (!Array.isArray(value)) return undefined;
  const found = value.find(item => isRecord(item) && (item.key === segment.select || item.id === segment.select || item.name === segment.select));
  if (found !== undefined) return found;
  return /^\d+$/.test(segment.select) ? value[Number(segment.select)] : undefined;
}

function lookup(doc: unknown, segments: readonly Segment[]): { parent: unknown; value: unknown } {
  let parent: unknown, value: unknown = doc;
  for (const segment of segments) { parent = value; value = step(value, segment); }
  return { parent, value };
}

/** Arrays whose items are requirements: adding is stricter, removing is looser. Every other array is an allowed set. */
const REQUIRE_LIST = /^(mustDo|acceptance|mustContain|inputs)$|^(required|must)/;

/**
 * Null when `entry` applied on `scope` ({brief, contract} of the base) is stricter or equal on its path;
 * else why it is looser, or why the op does not fit the field type.
 */
export function tightenIssue(scope: { brief: unknown; contract: unknown }, entry: Pick<Tighten, "path" | "op" | "value">): string | null {
  const segments = parseTightenPath(entry.path);
  if (typeof segments === "string") return segments;
  const { parent, value } = lookup(scope, segments);
  const last = segments[segments.length - 1]!;
  const lastKey = "key" in last ? last.key : "";
  if (parent === undefined || (Array.isArray(parent) && "key" in last)) return `${entry.path}: no such field in the base brief`;
  const op: TightenOp = entry.op;
  switch (op) {
    case "max":
    case "min": {
      if (typeof entry.value !== "number" || !Number.isFinite(entry.value)) return `${entry.path}: ${op} takes a number`;
      if (value === undefined) return null;
      if (typeof value !== "number") return `${entry.path}: ${op} applies to a number field, the base holds ${typeName(value)}`;
      if (op === "max" && entry.value > value) return `${entry.path}: max ${entry.value} is looser than the base ${value}`;
      if (op === "min" && entry.value < value) return `${entry.path}: min ${entry.value} is looser than the base ${value}`;
      return null;
    }
    case "require": {
      if (entry.value !== true) return `${entry.path}: require takes true`;
      if (value !== undefined && typeof value !== "boolean") return `${entry.path}: require applies to a boolean field, the base holds ${typeName(value)}`;
      return null;
    }
    case "add": {
      if (!Array.isArray(value)) return `${entry.path}: add applies to a list, the base holds ${typeName(value)}`;
      if (!REQUIRE_LIST.test(lastKey)) return `${entry.path}: add widens an allowed list; only requirement lists (mustDo, acceptance, required*) take add`;
      return null;
    }
    case "remove": {
      if (!Array.isArray(value)) return `${entry.path}: remove applies to a list, the base holds ${typeName(value)}`;
      if (REQUIRE_LIST.test(lastKey)) return `${entry.path}: remove drops a requirement`;
      if (!value.some(item => sameJson(item, entry.value))) return `${entry.path}: remove names an item the base does not allow`;
      return null;
    }
    case "narrow": {
      if (!Array.isArray(value)) return `${entry.path}: narrow applies to a list, the base holds ${typeName(value)}`;
      if (REQUIRE_LIST.test(lastKey)) return `${entry.path}: narrow drops requirements`;
      if (!Array.isArray(entry.value) || entry.value.length === 0) return `${entry.path}: narrow takes a non-empty list`;
      const outside = entry.value.filter(item => !value.some(allowed => sameJson(allowed, item)));
      if (outside.length) return `${entry.path}: narrow adds ${JSON.stringify(outside)} the base does not allow`;
      return null;
    }
    default:
      return `${entry.path}: unknown op ${String(op)}`;
  }
}

function applyOne(scope: { brief: unknown; contract: unknown }, entry: Tighten): void {
  const segments = parseTightenPath(entry.path) as Segment[];
  const parentSegments = segments.slice(0, -1);
  const last = segments[segments.length - 1]!;
  const { value: parent } = lookup(scope, parentSegments);
  const current = step(parent, last);
  if (entry.op === "add") (current as unknown[]).push(clone(entry.value));
  else if (entry.op === "remove") {
    const list = current as unknown[];
    const at = list.findIndex(item => sameJson(item, entry.value));
    if (at >= 0) list.splice(at, 1);
  } else if (entry.op === "narrow") {
    const list = current as unknown[];
    const keep = entry.value as unknown[];
    for (let index = list.length - 1; index >= 0; index -= 1) if (!keep.some(item => sameJson(item, list[index]))) list.splice(index, 1);
  } else if ("key" in last && isRecord(parent)) parent[last.key] = entry.op === "require" ? true : entry.value;
}

/** The resolved brief: the slot's own brief and contract with every valid tighten entry applied in order. */
export function resolveBrief(slot: Pick<Slot, "brief" | "contract" | "tighten">, base: { brief: unknown; contract: unknown } = slot): { brief: Brief; contract: Record<string, unknown>; issues: string[] } {
  const scope = { brief: clone(slot.brief) as unknown, contract: clone(slot.contract) as unknown };
  const issues: string[] = [];
  for (const entry of slot.tighten) {
    const issue = tightenIssue(base, entry);
    if (issue) { issues.push(issue); continue; }
    applyOne(scope, entry);
  }
  return { brief: scope.brief as Brief, contract: scope.contract as Record<string, unknown>, issues };
}

// ---------------------------------------------------------------------------
// Package base slots
// ---------------------------------------------------------------------------

export const baseSlotPath = (slotId: string): string => `src/catalog/slots/${slotId}/slot.json`;

export interface BaseSlot {
  /** The package base document, as the package wrote it. */
  doc: Slot;
  /** What a consumer copy records as `base`. */
  meta: NonNullable<Slot["base"]>;
  /** The installed package version (also `createdBy.version` of a copy). */
  version: string;
}

/** The installed package root of `@clossys/<agent>` for this consumer root (system.md 1; package-path.ts). */
export function agentPackageRoot(root: string, agent: AgentId): string {
  return packagePath(root, `packages/${agent}`);
}

export function packageVersion(root: string, agent: AgentId): string {
  const file = join(agentPackageRoot(root, agent), "package.json");
  if (!existsSync(file)) return "0.0.0";
  const version = (JSON.parse(readFileSync(file, "utf8")) as { version?: unknown }).version;
  return typeof version === "string" && version ? version : "0.0.0";
}

/** The package base of `<agent>/<slotId>`, or undefined when the package ships none. Throws on an invalid base file. */
export function readBaseSlot(root: string, agent: AgentId, slotId: string): BaseSlot | undefined {
  const path = baseSlotPath(slotId);
  const file = join(agentPackageRoot(root, agent), path);
  if (!existsSync(file)) return undefined;
  const text = readFileSync(file, "utf8");
  const doc = parseSlot(text, file);
  if (doc.id !== slotId || doc.agent !== agent) throw new SlotFormatError(file, [{ path: "$.id", message: `is ${doc.agent}/${doc.id}, expected ${agent}/${slotId}` }]);
  const version = packageVersion(root, agent);
  return { doc, version, meta: { package: `@clossys/${agent}`, version, path, sha256: sha256Hex(text) } };
}

/** Slot ids the package ships a base for, sorted. */
export function listBaseSlots(root: string, agent: AgentId): string[] {
  const dir = join(agentPackageRoot(root, agent), "src", "catalog", "slots");
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter(id => existsSync(join(dir, id, "slot.json"))).sort();
}

// ---------------------------------------------------------------------------
// What `clossys ia sync` writes, and which fields are computed
// ---------------------------------------------------------------------------

/** Fields a consumer copy takes from its base. `records.computed-match` fails any difference. */
export const COMPUTED_FIELDS = ["schema", "id", "agent", "kind", "ia.l0", "ia.l1", "ia.l2", "base", "standard", "brief", "contract", "options", "varyOn", "refs (not consumedBy)"] as const;

const ownRefs = (refs: readonly Ref[]): Ref[] => refs.filter(ref => ref.rel !== "consumedBy");
const consumedByRefs = (refs: readonly Ref[]): Ref[] => refs.filter(ref => ref.rel === "consumedBy");

/**
 * The consumer slot `ia sync` writes from `base`, keeping the consumer's `tighten`, `status`, `createdAt`,
 * `consumedBy` refs and, while the slot stays in the same L2, `ia.order`. A package move to another L2
 * (the int2 `ia-regroup`, folded here) takes the base order.
 */
export function syncedSlot(base: BaseSlot, existing: Slot | undefined, at: Iso): Slot {
  const doc = base.doc;
  const sameL2 = existing !== undefined && existing.ia.l2 === doc.ia.l2;
  const slot: Slot = {
    schema: SLOT_SCHEMA,
    id: doc.id,
    agent: doc.agent,
    kind: doc.kind,
    status: existing?.status ?? "starter",
    ia: { l0: doc.ia.l0, l1: doc.ia.l1, l2: doc.ia.l2, order: sameL2 ? existing!.ia.order : doc.ia.order },
    createdBy: { actor: "package", package: base.meta.package as `@clossys/${AgentId}`, version: base.version },
    createdAt: existing?.createdAt ?? at,
    updatedAt: existing?.updatedAt ?? at,
    refs: [...clone(ownRefs(doc.refs)), ...clone(consumedByRefs(existing?.refs ?? []))],
    base: { ...base.meta },
    standard: doc.standard,
    brief: clone(doc.brief),
    contract: clone(doc.contract),
    tighten: clone(existing?.tighten ?? []),
  };
  if (doc.options !== undefined) slot.options = doc.options;
  if (doc.varyOn !== undefined) slot.varyOn = doc.varyOn;
  if (existing && serializeSlot(slot) !== serializeSlot(existing)) slot.updatedAt = at;
  return slot;
}

/** The computed fields on which `actual` differs from what `ia sync` writes from `base`. */
export function computedDiff(actual: Slot, base: BaseSlot): string[] {
  const expected = syncedSlot(base, actual, actual.updatedAt ?? actual.createdAt);
  const out: string[] = [];
  const pairs: [string, unknown, unknown][] = [
    ["schema", actual.schema, expected.schema], ["id", actual.id, expected.id], ["agent", actual.agent, expected.agent],
    ["kind", actual.kind, expected.kind], ["ia.l0", actual.ia.l0, expected.ia.l0], ["ia.l1", actual.ia.l1, expected.ia.l1],
    ["ia.l2", actual.ia.l2, expected.ia.l2], ["base", actual.base, expected.base], ["standard", actual.standard, expected.standard],
    ["brief", actual.brief, expected.brief], ["contract", actual.contract, expected.contract], ["options", actual.options, expected.options],
    ["varyOn", actual.varyOn, expected.varyOn], ["refs", ownRefs(actual.refs), ownRefs(expected.refs)],
  ];
  for (const [field, have, want] of pairs) if (!sameJson(have, want)) out.push(field);
  return out;
}

// ---------------------------------------------------------------------------
// Consumer slot folders
// ---------------------------------------------------------------------------

export interface ConsumerSlotFolder { agent: AgentId; id: string; dir: string; file: string; hasSlot: boolean }

/** Entries of `clossys/agents/<agent>/` that are not slot folders: the IA, views, Producer queues and ledgers. */
const NOT_A_SLOT = /^(ia\.json|ledger\.json|views|queue\..+|ledger\..+)$/;

/** Every slot folder under `<root>/clossys/agents/*`, sorted by agent then id. */
export function consumerSlotFolders(root: string): ConsumerSlotFolder[] {
  const out: ConsumerSlotFolder[] = [];
  for (const agent of SLOT_AGENTS) {
    const dir = join(root, "clossys", "agents", agent);
    if (!existsSync(dir)) continue;
    for (const id of readdirSync(dir).sort()) {
      if (NOT_A_SLOT.test(id) || (agent === "producer" && /^(queue|ledger)\./.test(id))) continue;
      const slotDir = join(dir, id);
      if (!statSync(slotDir).isDirectory()) continue;
      const file = join(slotDir, "slot.json");
      out.push({ agent, id, dir: slotDir, file, hasSlot: existsSync(file) });
    }
  }
  return out;
}

/** The schema id of a slot.json on disk, without validating it (`clossys.slot/1`, `clossys.slot/2`, or undefined). */
export function slotSchemaOf(file: string): string | undefined {
  try {
    const doc = JSON.parse(readFileSync(file, "utf8")) as unknown;
    return isRecord(doc) && typeof doc.schema === "string" ? doc.schema : undefined;
  } catch { return undefined; }
}

// ---------------------------------------------------------------------------
// Tree check result (the per-check shape of system.md 6.4 `results`)
// ---------------------------------------------------------------------------

export interface TreeFinding { subject: string; detail: string }
export interface TreeCheckResult { check: string; status: "pass" | "fail"; findings: TreeFinding[] }
export interface TreeCheck { id: string; run(root: string): TreeCheckResult }

export const treeResult = (check: string, findings: TreeFinding[]): TreeCheckResult => ({ check, status: findings.length ? "fail" : "pass", findings });

// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function typeName(value: unknown): string {
  return value === undefined ? "nothing" : Array.isArray(value) ? "a list" : value === null ? "null" : `a ${typeof value}`;
}
function clone<T>(value: T): T {
  return value === undefined ? value : JSON.parse(JSON.stringify(value)) as T;
}
export function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (isRecord(value)) return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
