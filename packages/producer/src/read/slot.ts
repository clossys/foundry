/**
 * `clossys slot <ref> --json`: one slot in full as `clossys.slot-view/1` (system.md 12.3).
 *
 * The pure read model behind the verb. Two record layouts are read:
 * - int2 (`clossys.slot/1`, positions in `<agent>/ia.json`): through src/records/slots.ts, the same
 *   reader the Studio `slot-detail` and `slot-gallery` projections use, without importing the server.
 *   Candidates, pin and used-by are the same answers (parity test in slot.test.ts).
 * - target (`clossys.slot/2`, the Tallyhouse fixture): slot.json, candidates/, pin.json (pin/2 or
 *   pin-map/1) read directly; candidate headers through readRecordHeader (src/records/schema.ts).
 *
 * Resolution follows system.md 8: a consumer pin whose sha256 matches its candidate file wins;
 * otherwise the package default (`<package>/src/catalog/defaults/<slot-id>/<name>-v1.<ext>`) is the
 * value, shown with state `sample`; otherwise the slot is unresolved and `pin` is empty.
 *
 * Writes nothing.
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { installedPackageRoot } from "../package-path.js";
import { inspectSlot, readCandidate, readLedger, readSlotEntry, slotIndex, usedByPlaced } from "../records/slots.js";
import { canonical, MODEL_AGENTS, parseFrontmatter, pinStatus, validateCandidate, type ModelAgent, type PinBasis } from "../records/slot-model/index.js";
import { readRecordHeader } from "../records/schema.js";
import type { Actor, AgentId, Brief, Iso, Ref, SlotState, SlotView } from "../records/types.js";
import { parseJson } from "../errors.js";
import { formatRef, parseRef, REF_CANDIDATE, SLOT_ID } from "./ref.js";

export type { SlotView };
type ViewCandidate = SlotView["candidates"][number];
type ViewPin = SlotView["pin"][number];

export interface SlotViewOptions {
  /** `live` (default) leaves out retired candidates; `all` lists them. */
  readonly candidates?: "all" | "live";
  /** The installed package root of an agent, where its `src/catalog/defaults/` lives. */
  readonly packageRoot?: (agent: AgentId) => string | undefined;
}

/** A ref that parses but names nothing: an unknown slot or a candidate that is not on disk. Exit 1. */
export class SlotViewError extends Error {
  readonly exitCode = 1;
  constructor(message: string) { super(message); this.name = "SlotViewError"; }
}

const sha256 = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === "string" && value.length > 0;
const SHA = /^[0-9a-f]{64}$/;
const ISO = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?Z$/;
const readJsonFile = (path: string): unknown => { const parsed = parseJson(readFileSync(path, "utf8")); return parsed.ok ? parsed.value : undefined; };
/** A file's modification time, to the second: the creation time of a candidate whose header records none. */
const mtimeIso = (path: string): Iso => `${new Date(statSync(path).mtimeMs).toISOString().slice(0, 19)}Z`;

interface FileCandidate { name: string; bytes: string; sha256: string; path: string }
interface PinRow { record?: string; candidate: string; sha256: string; decidedBy: string; basis: string; at: string; confirmed?: unknown }
/** One slot, normalized across the int2 and target layouts. */
interface Model {
  kind: string; status: SlotState; ia: { l0: string; l1: string; l2: string };
  brief: Brief; tightenCount: number; contract: unknown;
  files: FileCandidate[]; pins: PinRow[];
  issues: (file: FileCandidate) => string[];
  ledgerEvent: (name: string) => Record<string, unknown> | undefined;
  consumedBy: string[];
}

/** An int2 IA position as target node ids (system.md 5): `lexicon`, `lexicon/voice`, `lexicon/voice/<l2>`. */
export function iaNodes(position: { l0?: string; l1?: string; l2?: string }, slot: string): { l0: string; l1: string; l2: string } {
  const node = (parent: string, id: string) => id.includes("/") ? id : `${parent}/${(id.startsWith(`${parent}.`) ? id.slice(parent.length + 1) : id).replaceAll(".", "/")}`;
  const l0 = position.l0 || slot.split(".")[0]!;
  const l1 = position.l1 ? node(l0, position.l1) : l0;
  return { l0, l1, l2: position.l2 ? node(l1, position.l2) : l1 };
}

/** The int2 slot's brief: its purpose (or question, or rule) and its declared inputs; the slot id when it states none. */
function int2Brief(id: string, contract: Record<string, unknown>, inputs: readonly string[], agentOf: (id: string) => string | undefined): Brief {
  const purpose = [contract.purpose, contract.question, contract.rule].find(text) ?? id;
  const mustDo = Array.isArray(contract.mustContain) ? contract.mustContain.filter(text) : [];
  const refs = inputs.flatMap(input => { const agent = agentOf(input); return agent ? [{ to: `${agent}/${input}`, rel: "input" } as Ref] : []; });
  return { purpose, mustDo, inputs: refs, acceptance: [] };
}

function int2Model(consumer: string, agent: ModelAgent, id: string): Model | undefined {
  const entry = readSlotEntry(consumer, agent, id);
  if (!entry) return undefined;
  const { doc } = inspectSlot(consumer, agent, id);
  const index = slotIndex(consumer);
  const events = (readLedger(entry.dir)?.events ?? []) as readonly Record<string, unknown>[];
  const files = entry.candidates.map(name => {
    const candidate = readCandidate(consumer, agent, id, name);
    return { name, bytes: candidate.bytes, sha256: candidate.sha256, path: join(entry.dir, "candidates", name) };
  });
  const status = (doc as { status?: unknown }).status;
  const tighten = (doc as { tighten?: unknown }).tighten;
  return {
    kind: doc.kind, status: text(status) ? status as SlotState : "live", ia: iaNodes(doc.ia, id),
    brief: int2Brief(id, doc.contract as Record<string, unknown>, doc.inputs, input => index.get(input)?.agent),
    tightenCount: Array.isArray(tighten) ? tighten.length : 0, contract: doc.contract,
    files, pins: entry.pin ? [{ ...entry.pin }] : [],
    issues: file => [...new Set(validateCandidate(doc.kind, id, file.name, file.bytes).map(issue => issue.code))],
    ledgerEvent: name => events.find(event => Array.isArray(event.records)
      && event.records.some(row => isObject(row) && (row.file === `candidates/${name}` || row.file === name))),
    consumedBy: usedByPlaced(consumer, id).map(row => `${row.agent}/${row.id}`),
  };
}

/** Every target-format slot.json in the consumer, as `[agent/id, doc]`. */
function targetSlots(consumer: string): [string, Record<string, unknown>][] {
  const agents = join(consumer, "agents");
  if (!existsSync(agents)) return [];
  const out: [string, Record<string, unknown>][] = [];
  for (const agent of readdirSync(agents).sort()) {
    const dir = join(agents, agent);
    if (!statSync(dir).isDirectory()) continue;
    for (const id of readdirSync(dir).sort()) {
      const file = join(dir, id, "slot.json");
      if (!SLOT_ID.test(id) || !existsSync(file)) continue;
      const doc = readJsonFile(file);
      if (isObject(doc) && doc.schema === "clossys.slot/2") out.push([`${agent}/${id}`, doc]);
    }
  }
  return out;
}

const refTo = (to: string, self: string) => to === self || to.startsWith(`${self}/`);

function targetModel(consumer: string, agent: string, id: string): Model | undefined {
  const dir = join(consumer, "agents", agent, id);
  const doc = existsSync(join(dir, "slot.json")) ? readJsonFile(join(dir, "slot.json")) : undefined;
  if (!isObject(doc) || doc.schema !== "clossys.slot/2") return undefined;
  const self = `${agent}/${id}`;
  const candidatesDir = join(dir, "candidates");
  const files = existsSync(candidatesDir) ? readdirSync(candidatesDir).filter(name => REF_CANDIDATE.test(name)).sort(byVersion).map(name => {
    const path = join(candidatesDir, name), bytes = readFileSync(path, "utf8");
    return { name, bytes, sha256: sha256(bytes), path };
  }) : [];
  const pinDoc = existsSync(join(dir, "pin.json")) ? readJsonFile(join(dir, "pin.json")) : undefined;
  const pins: PinRow[] = !isObject(pinDoc) ? []
    : pinDoc.schema === "clossys.pin-map/1" && isObject(pinDoc.records)
      ? Object.entries(pinDoc.records).filter(([, row]) => isObject(row)).map(([record, row]) => ({ record, ...(row as unknown as PinRow) }))
      : pinDoc.schema === "clossys.pin/2" ? [pinDoc as unknown as PinRow] : [];
  const own = Array.isArray(doc.refs) ? doc.refs.filter(isObject) : [];
  const consumers = new Set(own.filter(ref => ref.rel === "consumedBy" && text(ref.to)).map(ref => ref.to as string));
  for (const [other, slot] of targetSlots(consumer)) {
    if (other === self || !Array.isArray(slot.refs)) continue;
    if (slot.refs.some(ref => isObject(ref) && ["input", "uses", "places"].includes(String(ref.rel)) && text(ref.to) && refTo(ref.to, self))) consumers.add(other);
  }
  const ia = isObject(doc.ia) ? doc.ia : {};
  return {
    kind: String(doc.kind), status: (text(doc.status) ? doc.status : "live") as SlotState,
    ia: { l0: String(ia.l0 ?? ""), l1: String(ia.l1 ?? ""), l2: String(ia.l2 ?? "") },
    brief: doc.brief as Brief, tightenCount: Array.isArray(doc.tighten) ? doc.tighten.length : 0, contract: doc.contract ?? null,
    files, pins, issues: () => [], ledgerEvent: () => undefined, consumedBy: [...consumers].sort(),
  };
}

/** The candidate's header: the target `clossys` header, else int2 Markdown frontmatter or JSON `meta`. */
function candidateHeader(name: string, bytes: string): Record<string, unknown> {
  try { const header = readRecordHeader(name, bytes); if (isObject(header)) return header; } catch { /* an int2 candidate */ }
  if (name.endsWith(".md")) { const parsed = parseFrontmatter(bytes); return parsed.ok ? parsed.value.fields : {}; }
  if (!name.endsWith(".json")) return {};
  const parsed = parseJson(bytes);
  if (!parsed.ok || !isObject(parsed.value)) return {};
  return { ...parsed.value, ...(isObject(parsed.value.meta) ? parsed.value.meta : {}) };
}

/** The int2 per-slot ledger event that wrote a candidate, as an Actor. */
function ledgerActor(event: Record<string, unknown> | undefined): Actor | undefined {
  if (!event || !text(event.by)) return undefined;
  const by = event.by;
  const agent = /^agent:([a-z]+)$/.exec(by)?.[1] ?? (MODEL_AGENTS as readonly string[]).find(name => name === by);
  const skill = isObject(event.skill) ? event.skill : {};
  if (agent && text(skill.path) && text(skill.sha256) && SHA.test(skill.sha256) && text(event.model) && ["low", "mid", "high"].includes(String(event.tier))) {
    return { actor: "agent", agent: agent as AgentId, skill: skill.path, skillSha256: skill.sha256, model: event.model, tier: event.tier as "low" | "mid" | "high" };
  }
  if (by.startsWith("owner")) return { actor: "owner", ref: by };
  if (by.startsWith("planner")) return { actor: "planner", ref: by };
  return undefined;
}

/** `.clossys/checks/<agent>/<slot>/<candidate>.json` (a check-result/1), when one is on disk. */
function storedCheck(root: string, agent: string, slot: string, name: string): ViewCandidate["check"] | undefined {
  const path = join(root, ".clossys", "checks", agent, slot, `${name}.json`);
  if (!existsSync(path)) return undefined;
  const value = readJsonFile(path);
  if (!isObject(value) || !["pass", "fail", "error"].includes(String(value.status))) return { status: "error", failed: [] };
  const failed = Array.isArray(value.results) ? value.results.filter(isObject).filter(row => row.status === "fail" && text(row.check)).map(row => String(row.check)) : [];
  return { status: value.status as "pass" | "fail" | "error", failed: [...new Set(failed)] };
}

/** Files under `.clossys/renders/<agent>/<slot>/<candidate>/`, as root-relative paths. */
function rendersOf(root: string, agent: string, slot: string, name: string): string[] {
  const rel = join(".clossys", "renders", agent, slot, name);
  if (!statSync(join(root, rel), { throwIfNoEntry: false })?.isDirectory()) return [];
  return readdirSync(join(root, rel)).sort().map(file => join(rel, file));
}

/** Entry JSON files under `agents/producer/<prefix>.*\/entries/`, sorted by id (ids are time first). */
function processEntries(consumer: string, prefix: "queue" | "ledger"): { id: string; value: Record<string, unknown> }[] {
  const producer = join(consumer, "agents", "producer");
  if (!existsSync(producer)) return [];
  const out: { id: string; value: Record<string, unknown> }[] = [];
  for (const folder of readdirSync(producer).filter(name => name.startsWith(`${prefix}.`))) {
    const entries = join(producer, folder, "entries");
    if (!existsSync(entries)) continue;
    for (const file of readdirSync(entries).filter(name => name.endsWith(".json"))) {
      const value = readJsonFile(join(entries, file));
      if (isObject(value)) out.push({ id: file.slice(0, -".json".length), value });
    }
  }
  return out.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}
const subjectTo = (value: Record<string, unknown>) => isObject(value.subject) && text(value.subject.to) ? value.subject.to : text(value.subject) ? value.subject : undefined;

export function slotView(root: string, refString: string, options: SlotViewOptions = {}): SlotView {
  const ref = parseRef(refString);
  const consumer = join(root, "clossys");
  const model = int2Model(consumer, ref.agent as ModelAgent, ref.slot) ?? targetModel(consumer, ref.agent, ref.slot);
  if (!model) throw new SlotViewError(`No such slot: ${ref.agent}/${ref.slot}`);
  const briefSha256 = sha256(JSON.stringify(canonical(model.brief)));
  const version = packageVersion(options, ref.agent);

  const describe = (file: FileCandidate, packageDefault: boolean): ViewCandidate & { retired: boolean } => {
    const header = candidateHeader(file.name, file.bytes);
    const issues = packageDefault ? [] : model.issues(file);
    const event = packageDefault ? undefined : model.ledgerEvent(file.name);
    const createdBy: Actor = isObject(header.createdBy) && text(header.createdBy.actor) ? header.createdBy as unknown as Actor
      : packageDefault ? { actor: "package", package: `@clossys/${ref.agent}`, version }
      : ledgerActor(event) ?? { actor: "code", cli: "unknown", version: "unknown" };
    const createdAt = [header.createdAt, event?.at].find((value): value is string => text(value) && ISO.test(value)) ?? mtimeIso(file.path);
    const check = issues.length ? { status: "fail" as const, failed: issues } : storedCheck(root, ref.agent, ref.slot, file.name) ?? { status: "none" as const, failed: [] };
    const rationale = Array.isArray(header.rationale) ? header.rationale.filter(isObject).filter(row => text(row.purpose) && text(row.why))
      .map(row => ({ purpose: row.purpose as string, ...(text(row.field) ? { field: row.field } : {}), why: row.why as string })) : [];
    return {
      name: file.name, ...(text(header.record) ? { record: header.record } : {}), sha256: file.sha256, createdBy, createdAt,
      briefCurrent: header.briefSha256 === briefSha256, check, rationale, renders: rendersOf(root, ref.agent, ref.slot, file.name),
      retired: header.status === "retired",
    };
  };

  const defaultFiles = packageDefaults(options, ref.agent, ref.slot);
  const defaults = defaultFiles.map(file => describe(file, true));
  const own = model.files.map(file => describe(file, false));
  // Package defaults are v1 of their name, so they list first (system.md 5).
  let candidates = [...defaults, ...own];
  if ((options.candidates ?? "live") === "live") candidates = candidates.filter(candidate => !candidate.retired);
  if (ref.record) candidates = candidates.filter(candidate => candidate.record === undefined || candidate.record === ref.record);

  // A ref that names a candidate must name one on disk: a dangling ref is refused, never shown empty.
  if (ref.candidate !== undefined) {
    const pool = ref.packageDefault ? defaultFiles : model.files;
    if (!pool.some(file => file.name === ref.candidate)) {
      throw new SlotViewError(`Dangling ref ${formatRef(ref)}: no ${ref.packageDefault ? "package default" : "candidate"} ${ref.candidate} in ${ref.agent}/${ref.slot}`);
    }
    const chosen = ref.packageDefault ? defaults : own;
    candidates = candidates.filter(candidate => candidate.name === ref.candidate && chosen.some(row => row === candidate));
  }

  // A pin counts only when its candidate is on disk with the pinned bytes (system.md 8 step 1).
  const pin: ViewPin[] = [];
  for (const row of model.pins) {
    if (ref.record && row.record !== undefined && row.record !== ref.record) continue;
    const file = model.files.find(candidate => candidate.name === row.candidate);
    if (!file || file.sha256 !== row.sha256) continue;
    const state = isObject(row.confirmed) ? "pinned" : pinStatus(row.basis as PinBasis);
    pin.push({ ...(row.record !== undefined ? { record: row.record } : {}), candidate: row.candidate, sha256: row.sha256, decidedBy: row.decidedBy, basis: row.basis, at: row.at, state });
  }
  if (!pin.length && !model.pins.some(row => row.record !== undefined) && defaults.length) {
    const sample = defaults[defaults.length - 1]!;
    pin.push({ candidate: sample.name, sha256: sample.sha256, decidedBy: `package:@clossys/${ref.agent}`, basis: "package-default", at: sample.createdAt, state: "sample" });
  }

  const self = `${ref.agent}/${ref.slot}`;
  const wrote = (path: unknown) => text(path) && (path.startsWith(`${self}/`) || path.includes(`/${self}/`));
  const queue = processEntries(consumer, "queue").filter(({ value }) => value.status === "open" && refTo(subjectTo(value) ?? "", self)).map(row => row.id);
  const ledger = processEntries(consumer, "ledger").filter(({ value }) => refTo(subjectTo(value) ?? "", self)
    || (Array.isArray(value.steps) && value.steps.some(step => isObject(step) && Array.isArray(step.wrote) && step.wrote.some(row => isObject(row) && wrote(row.file)))))
    .map(row => row.id).slice(-5);

  return {
    schema: "clossys.slot-view/1",
    ref: formatRef(ref),
    slot: { id: ref.slot, agent: ref.agent, kind: model.kind, status: model.status, ia: model.ia, brief: model.brief, briefSha256, tightenCount: model.tightenCount, contract: model.contract },
    candidates: candidates.map(({ retired: _retired, ...candidate }) => candidate),
    pin,
    consumedBy: model.consumedBy,
    queue,
    ledger,
  };
}

function rootOf(options: SlotViewOptions, agent: AgentId): string | undefined {
  return options.packageRoot ? options.packageRoot(agent) : installedPackageRoot(agent);
}

function packageVersion(options: SlotViewOptions, agent: AgentId): string {
  const root = rootOf(options, agent);
  const value = root && existsSync(join(root, "package.json")) ? readJsonFile(join(root, "package.json")) : undefined;
  return isObject(value) && text(value.version) ? value.version : "unknown";
}

const byVersion = (a: string, b: string) => {
  const [, an = a, av = "0"] = /^(.*)-v(\d+)\.[a-z]+$/.exec(a) ?? [];
  const [, bn = b, bv = "0"] = /^(.*)-v(\d+)\.[a-z]+$/.exec(b) ?? [];
  return an === bn ? Number(av) - Number(bv) : an < bn ? -1 : an > bn ? 1 : 0;
};

/** The package default candidates of a slot: `<package>/src/catalog/defaults/<slot-id>/<name>-v<n>.<ext>`. */
export function packageDefaults(options: SlotViewOptions, agent: AgentId, slot: string): FileCandidate[] {
  const root = rootOf(options, agent);
  if (!root) return [];
  const dir = join(root, "src", "catalog", "defaults", slot);
  if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory()) return [];
  return readdirSync(dir).filter(name => REF_CANDIDATE.test(name)).sort(byVersion).map(name => {
    const path = join(dir, name), bytes = readFileSync(path, "utf8");
    return { name, bytes, sha256: sha256(bytes), path };
  });
}
