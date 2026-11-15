/**
 * `clossys slot <ref> --json`: one slot in full as `clossys.slot-view/1` (system.md 12.3).
 *
 * The pure read model behind the verb. It reads the same records the Studio `slot-detail` and
 * `slot-gallery` projections read (src/records/slots.ts), without importing the server: the
 * candidate list, the pin and the used-by set are the same answers (parity test in slot.test.ts).
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
import { canonical, MODEL_AGENTS, parseFrontmatter, pinStatus, validateCandidate, type ModelAgent, type SlotDoc } from "../records/slot-model/index.js";
import { parseJson } from "../errors.js";
import { formatRef, PACKAGE_PREFIX, parseRef, REF_CANDIDATE, type ParsedRef, type RefAgent } from "./ref.js";

/* The output shape, declared from system.md 12.3 until src/records/types.ts lands (foundry-build-0001). */
export type Sha256 = string;
export type Iso = string;
export type CandidateName = string;
export type Actor =
  | { actor: "package"; package: string; version: string }
  | { actor: "agent"; agent: RefAgent; skill: string; skillSha256: Sha256; model: string; tier: "low" | "mid" | "high" }
  | { actor: "owner"; ref: string }
  | { actor: "planner"; ref: string }
  | { actor: "code"; cli: string; version: string };
export interface BriefRef { to: string; key?: string; record?: string; rel: "input" }
export interface Brief { purpose: string; mustDo: string[]; inputs: BriefRef[]; acceptance: { check: string; params?: Record<string, unknown>; decider?: "code" | "agent" | "owner" }[] }
export type SlotStatus = "starter" | "live" | "parked" | "retired" | "needs-refresh";
export type CheckStatus = "pass" | "fail" | "error" | "none";

export interface SlotViewCandidate {
  name: CandidateName; record?: string; sha256: Sha256; createdBy: Actor; createdAt: Iso;
  briefCurrent: boolean;
  check: { status: CheckStatus; failed: string[] };
  rationale: { purpose: string; field?: string; why: string }[];
  renders: string[];
}
export interface SlotViewPin {
  record?: string; candidate: CandidateName; sha256: Sha256; decidedBy: string; basis: string; at: Iso;
  state: "pinned" | "confirm" | "sample";
}
export interface SlotView {
  schema: "clossys.slot-view/1";
  ref: string;
  slot: { id: string; agent: RefAgent; kind: string; status: SlotStatus; ia: { l0: string; l1: string; l2: string };
          brief: Brief; briefSha256: Sha256; tightenCount: number; contract: unknown };
  candidates: SlotViewCandidate[];
  pin: SlotViewPin[];
  consumedBy: string[];
  queue: string[];
  ledger: string[];
}

export interface SlotViewOptions {
  /** `live` (default) leaves out retired candidates; `all` lists them. */
  readonly candidates?: "all" | "live";
  /** The installed package root of an agent, where its `src/catalog/defaults/` lives. */
  readonly packageRoot?: (agent: RefAgent) => string | undefined;
}

/** A ref that parses but names nothing: an unknown slot or a candidate that is not on disk. Exit 1. */
export class SlotViewError extends Error {
  readonly exitCode = 1;
  constructor(message: string) { super(message); this.name = "SlotViewError"; }
}

const sha256 = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
const readJsonFile = (path: string): unknown => { const parsed = parseJson(readFileSync(path, "utf8")); return parsed.ok ? parsed.value : undefined; };

/** The candidate's header fields: Markdown frontmatter, or a JSON candidate's top level merged with its `meta`. */
function candidateHeader(name: string, bytes: string): Record<string, unknown> {
  if (name.endsWith(".md")) { const parsed = parseFrontmatter(bytes); return parsed.ok ? parsed.value.fields : {}; }
  if (!name.endsWith(".json")) return {};
  const parsed = parseJson(bytes);
  if (!parsed.ok || !isObject(parsed.value)) return {};
  return { ...parsed.value, ...(isObject(parsed.value.meta) ? parsed.value.meta : {}) };
}

/** The slot brief: the slot's own `brief` (slot/2), else the int2 slot's purpose and declared inputs. */
function slotBrief(doc: SlotDoc & { brief?: unknown }, agentOf: (id: string) => string | undefined): Brief {
  if (isObject(doc.brief)) return doc.brief as unknown as Brief;
  const contract = doc.contract as Record<string, unknown>;
  const purpose = [contract.purpose, contract.question, contract.rule].find((value): value is string => typeof value === "string") ?? "";
  const inputs = doc.inputs.flatMap(id => { const agent = agentOf(id); return agent ? [{ to: `${agent}/${id}`, rel: "input" as const }] : []; });
  return { purpose, mustDo: strings(contract.mustContain), inputs, acceptance: [] };
}

function createdOf(header: Record<string, unknown>, ledgerEvent: Record<string, unknown> | undefined): { createdBy: Actor; createdAt: Iso } {
  if (isObject(header.createdBy) && typeof header.createdBy.actor === "string") {
    return { createdBy: header.createdBy as unknown as Actor, createdAt: typeof header.createdAt === "string" ? header.createdAt : "" };
  }
  const at = typeof ledgerEvent?.at === "string" ? ledgerEvent.at : typeof header.createdAt === "string" ? header.createdAt : "";
  const by = typeof ledgerEvent?.by === "string" ? ledgerEvent.by : "";
  const agent = /^agent:([a-z]+)$/.exec(by)?.[1] ?? (MODEL_AGENTS as readonly string[]).find(name => name === by);
  if (agent && ledgerEvent) {
    const skill = isObject(ledgerEvent.skill) ? ledgerEvent.skill : {};
    return { createdAt: at, createdBy: { actor: "agent", agent: agent as RefAgent, skill: String(skill.path ?? ""), skillSha256: String(skill.sha256 ?? ""),
      model: String(ledgerEvent.model ?? ""), tier: (["low", "mid", "high"].includes(String(ledgerEvent.tier)) ? ledgerEvent.tier : "mid") as "low" | "mid" | "high" } };
  }
  if (by.startsWith("owner")) return { createdAt: at, createdBy: { actor: "owner", ref: by } };
  if (by.startsWith("planner")) return { createdAt: at, createdBy: { actor: "planner", ref: by } };
  return { createdAt: at, createdBy: { actor: "code", cli: "unknown", version: "" } };
}

/** `.clossys/checks/<agent>/<slot>/<candidate>.json` (a check-result/1), when one is on disk. */
function storedCheck(root: string, agent: string, slot: string, name: string): { status: CheckStatus; failed: string[] } | undefined {
  const path = join(root, ".clossys", "checks", agent, slot, `${name}.json`);
  if (!existsSync(path)) return undefined;
  const value = readJsonFile(path);
  if (!isObject(value) || !["pass", "fail", "error"].includes(String(value.status))) return { status: "error", failed: [] };
  const failed = Array.isArray(value.results) ? value.results.filter(isObject).filter(row => row.status === "fail").map(row => String(row.check)) : [];
  return { status: value.status as CheckStatus, failed };
}

/** Files under `.clossys/renders/<agent>/<slot>/<candidate>/`, as root-relative paths. */
function rendersOf(root: string, agent: string, slot: string, name: string): string[] {
  const rel = join(".clossys", "renders", agent, slot, name);
  const dir = join(root, rel);
  if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory()) return [];
  return readdirSync(dir).sort().map(file => join(rel, file));
}

/** Entry JSON files under `agents/producer/<prefix>.*\/entries/`, sorted by id (ids are time first). */
function processEntries(consumer: string, prefix: "queue" | "ledger"): { id: string; value: Record<string, unknown> }[] {
  const producer = join(consumer, "agents", "producer");
  if (!existsSync(producer)) return [];
  const out: { id: string; value: Record<string, unknown> }[] = [];
  for (const folder of readdirSync(producer).filter(name => name.startsWith(`${prefix}.`)).sort()) {
    const entries = join(producer, folder, "entries");
    if (!existsSync(entries)) continue;
    for (const file of readdirSync(entries).filter(name => name.endsWith(".json")).sort()) {
      const value = readJsonFile(join(entries, file));
      if (isObject(value)) out.push({ id: file.slice(0, -".json".length), value });
    }
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

const subjectTo = (value: Record<string, unknown>) => isObject(value.subject) && typeof value.subject.to === "string" ? value.subject.to : typeof value.subject === "string" ? value.subject : undefined;

export function slotView(root: string, refString: string, options: SlotViewOptions = {}): SlotView {
  const ref = parseRef(refString);
  const consumer = join(root, "clossys");
  const agent = ref.agent as ModelAgent;
  const entry = readSlotEntry(consumer, agent, ref.slot);
  if (!entry) throw new SlotViewError(`No such slot: ${ref.agent}/${ref.slot} (not in ${ref.agent}/ia.json)`);
  const { doc } = inspectSlot(consumer, agent, ref.slot);
  const index = slotIndex(consumer);
  const brief = slotBrief(doc, id => index.get(id)?.agent);
  const briefSha256 = sha256(JSON.stringify(canonical(brief)));
  const tighten = (doc as { tighten?: unknown }).tighten;
  const events = (readLedger(entry.dir)?.events ?? []) as readonly Record<string, unknown>[];
  const eventFor = (name: string) => events.find(event => Array.isArray(event.records)
    && event.records.some(row => isObject(row) && (row.file === `candidates/${name}` || row.file === name)));

  const describe = (name: string, bytes: string, digest: string, packageDefault: boolean): SlotViewCandidate & { status?: string } => {
    const header = candidateHeader(name, bytes);
    const issues = packageDefault ? [] : validateCandidate(doc.kind, ref.slot, name, bytes);
    const created = packageDefault && !isObject(header.createdBy)
      ? { createdBy: { actor: "package" as const, package: `@clossys/${ref.agent}`, version: packageVersion(options, ref.agent) }, createdAt: typeof header.createdAt === "string" ? header.createdAt : "" }
      : createdOf(header, eventFor(name));
    const listed = packageDefault ? `${PACKAGE_PREFIX}${name}` : name;
    const check = issues.length ? { status: "fail" as const, failed: [...new Set(issues.map(issue => issue.code))] }
      : storedCheck(root, ref.agent, ref.slot, listed) ?? { status: "none" as const, failed: [] };
    const rationale = Array.isArray(header.rationale) ? header.rationale.filter(isObject).map(row => ({
      purpose: String(row.purpose ?? ""), ...(typeof row.field === "string" ? { field: row.field } : {}), why: String(row.why ?? "") })) : [];
    return {
      name: listed, ...(typeof header.record === "string" ? { record: header.record } : {}), sha256: digest, ...created,
      briefCurrent: header.briefSha256 === briefSha256, check, rationale, renders: rendersOf(root, ref.agent, ref.slot, listed),
      ...(typeof header.status === "string" ? { status: header.status } : {}),
    };
  };

  const consumerCandidates = entry.candidates.map(name => { const candidate = readCandidate(consumer, agent, ref.slot, name); return describe(name, candidate.bytes, candidate.sha256, false); });
  const defaults = packageDefaults(options, ref.agent, ref.slot).map(({ name, bytes }) => describe(name, bytes, sha256(bytes), true));
  // Package defaults are v1 of their name, so they list first (system.md 5).
  let candidates = [...defaults, ...consumerCandidates];
  if ((options.candidates ?? "live") === "live") candidates = candidates.filter(candidate => candidate.status !== "retired");
  if (ref.record) candidates = candidates.filter(candidate => candidate.record === undefined || candidate.record === ref.record);

  // A ref that names a candidate must name one on disk: a dangling ref is refused, never shown empty.
  if (ref.candidate !== undefined) {
    const wanted = ref.packageDefault ? `${PACKAGE_PREFIX}${ref.candidate}` : ref.candidate;
    const found = ref.packageDefault ? defaults.some(row => row.name === wanted) : entry.candidates.includes(ref.candidate);
    if (!found) throw new SlotViewError(`Dangling ref ${formatRef(ref)}: no ${ref.packageDefault ? "package default" : "candidate"} ${ref.candidate} in ${ref.agent}/${ref.slot}`);
    candidates = candidates.filter(candidate => candidate.name === wanted);
  }

  const pin: SlotViewPin[] = [];
  const pinned = entry.pin && consumerCandidates.find(candidate => candidate.name === entry.pin!.candidate);
  if (entry.pin && pinned && pinned.sha256 === entry.pin.sha256) {
    pin.push({ candidate: entry.pin.candidate, sha256: entry.pin.sha256, decidedBy: entry.pin.decidedBy, basis: entry.pin.basis, at: entry.pin.at, state: pinStatus(entry.pin.basis) });
  } else if (defaults.length) {
    const sample = defaults[defaults.length - 1]!;
    pin.push({ candidate: sample.name, sha256: sample.sha256, decidedBy: `package:@clossys/${ref.agent}`, basis: "package-default", at: sample.createdAt, state: "sample" });
  }

  const self = `${ref.agent}/${ref.slot}`;
  const names = (to: string | undefined) => to !== undefined && (to === self || to.startsWith(`${self}/`) || to.startsWith(`${self}#`));
  const queue = processEntries(consumer, "queue").filter(({ value }) => value.status === "open" && names(subjectTo(value))).map(row => row.id);
  const slotPath = `agents/${ref.agent}/${ref.slot}/`;
  const ledger = processEntries(consumer, "ledger").filter(({ value }) => names(subjectTo(value))
    || (Array.isArray(value.steps) && value.steps.some(step => isObject(step) && Array.isArray(step.wrote)
      && step.wrote.some(row => isObject(row) && typeof row.file === "string" && row.file.includes(slotPath))))).map(row => row.id).slice(-5);

  const status = (doc as { status?: unknown }).status;
  return {
    schema: "clossys.slot-view/1",
    ref: formatRef(ref),
    slot: {
      id: ref.slot, agent: ref.agent, kind: doc.kind,
      status: typeof status === "string" ? status as SlotStatus : "live",
      ia: { l0: doc.ia.l0, l1: doc.ia.l1, l2: doc.ia.l2 },
      brief, briefSha256, tightenCount: Array.isArray(tighten) ? tighten.length : 0, contract: doc.contract,
    },
    candidates: candidates.map(({ status: _status, ...candidate }) => candidate),
    pin,
    consumedBy: usedByPlaced(consumer, ref.slot).map(row => `${row.agent}/${row.id}`),
    queue,
    ledger,
  };
}

function rootOf(options: SlotViewOptions, agent: RefAgent): string | undefined {
  return options.packageRoot ? options.packageRoot(agent) : installedPackageRoot(agent);
}

function packageVersion(options: SlotViewOptions, agent: RefAgent): string {
  const root = rootOf(options, agent);
  const value = root && existsSync(join(root, "package.json")) ? readJsonFile(join(root, "package.json")) : undefined;
  return isObject(value) && typeof value.version === "string" ? value.version : "";
}

/** The package default candidates of a slot: `<package>/src/catalog/defaults/<slot-id>/<name>-v<n>.<ext>`. */
export function packageDefaults(options: SlotViewOptions, agent: RefAgent, slot: string): { name: string; bytes: string }[] {
  const root = rootOf(options, agent);
  if (!root) return [];
  const dir = join(root, "src", "catalog", "defaults", slot);
  if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory()) return [];
  return readdirSync(dir).filter(name => REF_CANDIDATE.test(name)).sort(byVersion).map(name => ({ name, bytes: readFileSync(join(dir, name), "utf8") }));
}

const byVersion = (a: string, b: string) => {
  const [, an = a, av = "0"] = /^(.*)-v(\d+)\.[a-z]+$/.exec(a) ?? [];
  const [, bn = b, bv = "0"] = /^(.*)-v(\d+)\.[a-z]+$/.exec(b) ?? [];
  return an === bn ? Number(av) - Number(bv) : an.localeCompare(bn);
};

export type { ParsedRef };
