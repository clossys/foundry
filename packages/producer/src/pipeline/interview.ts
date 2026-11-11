/**
 * The interview (SKILL-INT): every agent skill asks the owner only its open decisions and gaps, in
 * multiple choice, and records each answer through a clossys verb. Two read-only views, no model call:
 *
 *   gapsOf(root)       `clossys gaps --agent <id>`: what keeps an agent from done, in three kinds.
 *                      coverage  open decide items (no slot.json, no candidates, unpinned, unapproved,
 *                                unassigned seat), a missing seat policy, slot model issues, pinned
 *                                Director cells whose checks block.
 *                      wiring    decide steps with no seat path, pinned slots citing an input pinned
 *                                after them or whose pin no longer clears (stale citations), plumb
 *                                steps whose latest run failed or went stale (chain drift), recorded
 *                                candidates whose selection-ladder record does not hold (a created one
 *                                with no reason no seed fit; candidate-ladder.ts).
 *                      request   a downstream agent's need only an upstream agent can answer: a slot
 *                                input citing an upstream slot with no candidates, not needed, or
 *                                unclear (a pinned Director cell with TODO-OWNER lines or blocking
 *                                findings); a pinned Publisher record naming a Writer key the pinned
 *                                copy lacks; an open Director request record. Each is addressed `to`
 *                                the upstream agent and becomes a question in that agent's round.
 *   interviewOf(root)  `clossys next --owner --agent <id>`: the owner questions taken from the gaps,
 *                      grouped (items that share one option set are one question whose options run
 *                      one call per item), in rounds of at most ROUND_SIZE.
 *
 * The Director asks content (director-interview.ts): the archetype first while none is recorded, then
 * one "Pick <cell>" question per owner-held core cell with an open option round, in dependency order,
 * each option a candidate's exact pin argv; a request for a cell already asked folds into that
 * question ("also unblocks N ... slots"); agent picks are one confirm question after the content.
 *
 * Every option carries the exact `clossys` argv of each call; a `<model:tier>` word is filled from the
 * seat policy (seat-policy.ts) and never guessed, and while the policy is missing its question comes
 * first and every seat question waits on it. Order of agents: producer, director, designer, writer,
 * publisher.
 */
import { join } from "node:path";
import { blocks, checkCell, readStrategyRoot } from "@clossys/director";
import type { Cell, StrategyModel } from "@clossys/director";
import { checkSlotModel } from "../records/slot-check.js";
import { SLOT_AGENTS } from "../records/slot-model/types.js";
import type { SlotAgent } from "../records/slot-model/types.js";
import { directorStoreReader, listSlots, readCandidate, readiness, readSlot, slotIndex } from "../records/slots.js";
import type { SlotEntry } from "../records/slots.js";
import { WRITER_KEY, writerCopy } from "../records/writer-copy.js";
import { ARCHETYPE_RECORD_ID, directorContent } from "./director-interview.js";
import type { DirectorContent } from "./director-interview.js";
import { candidatesOf, contextOf, explainChain, openItems, packetOf, skillLine, skillOf, verbOf } from "./chain.js";
import type { Context, Packet } from "./chain.js";
import { ladderIssues } from "./candidate-ladder.js";
import { isDecide } from "./define.js";
import type { Step } from "./define.js";
import { PACKAGE_ROOT } from "./options.js";
import { policyModels, readSeatPolicy, SEAT_POLICY_FILE } from "./seat-policy.js";
import type { SeatPolicyState, SeatTier } from "./seat-policy.js";
import { writerKeysUnapproved } from "./status.js";
import { STEPS } from "./steps/index.js";
import { readRuns } from "./trace.js";

export const GAPS_SCHEMA = "clossys.gaps/1";
export const INTERVIEW_SCHEMA = "clossys.next-owner/2";
export const INTERVIEW_AGENTS = ["producer", "director", "designer", "writer", "publisher"] as const;
export type InterviewAgent = typeof INTERVIEW_AGENTS[number];
export const GAP_KINDS = ["coverage", "wiring", "request"] as const;
export type GapKind = typeof GAP_KINDS[number];
/** At most this many questions per round. */
export const ROUND_SIZE = 4;

export interface Gap {
  readonly kind: GapKind;
  /** `open.<step>`, `seat-policy.missing`, `citation.stale`, `request.input-unpinned`, ... */
  readonly code: string;
  /** Who must act: the agent whose skill closes it (a request's addressee). */
  readonly agent: InterviewAgent;
  /** The slot (`<agent>/<slot>`), seat (step id), step or file the gap is about. */
  readonly item: string;
  readonly step: string | null;
  readonly message: string;
  /** Who answers: the owner (an owner question), or the agent's own skill. */
  readonly decider: "owner" | "agent";
  /** Requests: the downstream agent that needs the answer, and the upstream agent addressed. */
  readonly from?: string;
  readonly to?: InterviewAgent;
  /** Requests: the downstream slots (`<agent>/<slot>`) whose need it is. */
  readonly need?: readonly string[];
  /** Requests about Writer copy: the keys the pinned copy lacks. */
  readonly keys?: readonly string[];
  /** An answer that keeps the gap listed by rule (a human-only seat): asked once, then held. */
  readonly held?: string;
}

export interface QuestionOption {
  readonly id: string;
  /** One line. */
  readonly label: string;
  readonly recommended: boolean;
  /** The exact clossys argv of each call this answer runs, in order (one per item for a grouped question). */
  readonly calls: readonly (readonly string[])[];
  /** Placeholders the answerer fills in calls, with what each is. Empty when every call is exact. */
  readonly fill: Readonly<Record<string, string>>;
}
export interface Question {
  readonly id: string;
  readonly agent: InterviewAgent;
  readonly step: string | null;
  /** Short chip text (12 characters or so). */
  readonly header: string;
  readonly question: string;
  /** What the answer decides: one or more items of the gaps. */
  readonly items: readonly string[];
  /** 2 to 4 answers, the recommended one first. */
  readonly options: readonly QuestionOption[];
  /** The free-text answer: recorded through this verb once the owner's words are its arguments. */
  readonly freeText: {
    readonly id: "other"; readonly label: string; readonly verb: string;
    /** The calls the owner's words run, when more than the verb (Director content: evidence, then a re-draft). */
    readonly calls?: readonly (readonly string[])[];
    readonly fill?: Readonly<Record<string, string>>;
  };
  /** Questions that must be answered (and recorded) first; they sit in an earlier round. */
  readonly after: readonly string[];
  /** Downstream agents whose request this question answers. */
  readonly requestedBy: readonly string[];
}

export interface Gaps {
  readonly schema: typeof GAPS_SCHEMA;
  readonly agent: InterviewAgent | null;
  readonly counts: Readonly<Record<GapKind, number>> & { readonly total: number; readonly held: number };
  readonly gaps: readonly Gap[];
  /** Why a kind is empty where one could be expected: no request between two agents, and why. */
  readonly notes: readonly string[];
}
export interface Interview {
  readonly schema: typeof INTERVIEW_SCHEMA;
  readonly agent: InterviewAgent | null;
  readonly policy: SeatPolicyState["state"];
  readonly count: number;
  readonly rounds: readonly (readonly Question[])[];
  readonly gaps: Gaps["counts"];
}

export interface InterviewOptions {
  readonly steps?: readonly Step[];
  readonly packageRoot?: string;
  /** `--model <tier>=<id>` given to next --owner: the seat-policy question's recommended answer. */
  readonly models?: Readonly<Partial<Record<SeatTier, string>>>;
}

const isAgent = (value: string): value is InterviewAgent => (INTERVIEW_AGENTS as readonly string[]).includes(value);
/** A word the answerer fills: a whole `<placeholder>`, or `tier=<placeholder>`. Placeholders inside prose are text. */
const PLACEHOLDER = /^(?:[a-z]+=)?(<[^<>\s]+>)$/;
const slotOf = (item: string) => item.slice(item.indexOf("/") + 1);
const prefixOf = (item: string) => item.slice(0, item.indexOf("/"));
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;
const listed = (items: readonly string[], max = 4) => `${items.slice(0, max).join(", ")}${items.length > max ? `, +${items.length - max}` : ""}`;

/** The agent an open decide item belongs to: a slot's agent, evidence to the Director, the rest to the Producer. */
export function agentOfItem(step: Step, item: string): InterviewAgent {
  if (item.includes("/") && isAgent(prefixOf(item))) return prefixOf(item) as InterviewAgent;
  if (step.id === "evidence") return "director";
  if (step.id === "seats") return "producer";
  return step.agent && isAgent(step.agent) ? step.agent : "producer";
}

// ---------------------------------------------------------------- the Director, read once
interface DirectorView {
  readonly model: StrategyModel | null;
  readonly unreadable: string | null;
  /** Pinned cells whose bullets carry TODO-OWNER or whose checks block, with why. */
  readonly unclear: ReadonlyMap<string, string>;
  /** The content the owner decides (archetype, owner-held core rounds) and the agent picks. */
  readonly content: DirectorContent | null;
}
const OWNER_LINE = /\bTODO-OWNER\b/;
const bulletsOf = (cell: Cell) => [...cell.direction, ...cell.because, ...cell.watch];
function directorView(consumer: string, context: Context): DirectorView {
  let model: StrategyModel;
  try { model = readStrategyRoot(join(consumer, "agents", "director"), directorStoreReader); }
  catch (error) { return { model: null, unreadable: error instanceof Error ? error.message : String(error), unclear: new Map(), content: null }; }
  if (model.issues.length) return { model, unreadable: model.issues.slice(0, 3).map(issue => `${issue.path}:${issue.line} ${issue.message}`).join("; "), unclear: new Map(), content: null };
  const unclear = new Map<string, string>();
  for (const cell of model.cells) {
    const owner = bulletsOf(cell).filter(bullet => OWNER_LINE.test(`${bullet.key ?? ""} ${bullet.text}`)).length;
    const blocking = checkCell(cell, { model }).filter(blocks);
    const why = [owner ? `${plural(owner, "TODO-OWNER line")}` : "", blocking.length ? `${plural(blocking.length, "blocking finding")} (${listed([...new Set(blocking.map(finding => finding.rule))], 3)})` : ""].filter(Boolean);
    if (why.length) unclear.set(cell.id, why.join("; "));
  }
  const pinStep = context.steps.find(step => step.id === "pin.director");
  const content = directorContent(consumer, model, context.seats["pin.director"], pinStep?.decider === "owner");
  return { model, unreadable: null, unclear, content };
}

// ---------------------------------------------------------------- Writer keys
/** Writer keys a record line (`<!-- {"id":...} -->`) of a candidate declares. */
const keysIn = (bytes: string): string[] => [...bytes.matchAll(/^<!-- (\{.*\}) -->$/gm)].flatMap(match => {
  try { const id = (JSON.parse(match[1]!) as { id?: unknown }).id; return typeof id === "string" ? [id] : []; } catch { return []; }
});
/** Strings in a pinned Publisher record shaped like a Writer key of a namespace the pinned copy uses. */
function keysNamed(value: unknown, namespaces: ReadonlySet<string>, out = new Set<string>()): Set<string> {
  if (typeof value === "string") { if (WRITER_KEY.test(value) && namespaces.has(value.slice(0, value.indexOf(".")))) out.add(value); }
  else if (Array.isArray(value)) for (const each of value) keysNamed(each, namespaces, out);
  else if (value && typeof value === "object") for (const each of Object.values(value)) keysNamed(each, namespaces, out);
  return out;
}
const sharedPrefix = (a: string, b: string): number => {
  const left = a.split("."), right = b.split(".");
  let at = 0;
  while (at < left.length && at < right.length && left[at] === right[at]) at++;
  return at;
};

// ---------------------------------------------------------------- gaps
/** Every gap of the workspace (unscoped) and the notes on empty request pairs. */
function allGaps(root: string, options: InterviewOptions): { gaps: Gap[]; notes: string[]; director: DirectorContent | null; unclear: ReadonlyMap<string, string> } {
  const steps = options.steps ?? STEPS;
  const packageRoot = options.packageRoot ?? PACKAGE_ROOT;
  const consumer = join(root, "clossys");
  const context = contextOf(root, steps);
  const gaps: Gap[] = [];
  const notes: string[] = [];
  const policy = readSeatPolicy(root);

  // coverage: every open decide item.
  for (const step of steps) {
    if (!isDecide(step)) continue;
    for (const item of openItems(step, context)) {
      const seat = step.id === "seats" ? context.seats[item] : undefined;
      const held = seat && seat.state === "partial" && seat.llm === "open" && seat.human !== "open" ? "human only by an earlier answer: the seat stays listed open until an llm part is added" : undefined;
      gaps.push({
        kind: "coverage", code: `open.${step.id}`, agent: agentOfItem(step, item), item, step: step.id,
        message: step.id === "seats" ? `seat ${item} is ${seat?.state ?? "unassigned"}` : `${item}: ${step.summary.replace(/\.$/, "")}`,
        decider: step.decider === "owner" ? "owner" : "agent", ...(held ? { held } : {}),
      });
    }
  }
  if (policy.state !== "ok") gaps.push({ kind: "coverage", code: `seat-policy.${policy.state}`, agent: "producer", item: SEAT_POLICY_FILE, step: "seats", decider: "owner",
    message: policy.state === "missing" ? `${SEAT_POLICY_FILE} is missing: no seat answer can name a model until it records each tier's model id` : `${SEAT_POLICY_FILE} is invalid: ${policy.issues.map(issue => `${issue.path} ${issue.message}`).join("; ")}` });
  for (const issue of checkSlotModel(consumer)) {
    const agent = /^agents\/([a-z]+)\//.exec(issue.path)?.[1];
    gaps.push({ kind: "coverage", code: `slot-model.${issue.code}`, agent: agent && isAgent(agent) ? agent : "producer", item: issue.path, step: null, decider: "agent", message: issue.message });
  }
  const director = directorView(consumer, context);
  const content = director.content;
  // Director content: the archetype (while unrecorded), owner-held core rounds, agent picks to confirm.
  if (content && content.owner.length && !content.archetypeRecorded) gaps.push({ kind: "coverage", code: "director.archetype", agent: "director", item: `evidence/director/${ARCHETYPE_RECORD_ID}.md`, step: "director.store", decider: "owner",
    message: `no archetype is recorded: the core (${content.core.length} cells, default) waits on it` });
  const openPin = new Set(gaps.filter(gap => gap.code === "open.pin.director").map(gap => gap.item));
  for (const row of content?.owner ?? []) if (!openPin.has(row.item)) gaps.push({ kind: "coverage", code: "director.owner-round", agent: "director", item: row.item, step: "pin.director", decider: "owner",
    message: `${row.item}: ${row.round.length} drafted options (${row.round.map(each => each.name).join(", ")}) newer than its pin ${row.pinned}` });
  for (const pick of content?.agentPicks ?? []) gaps.push({ kind: "coverage", code: "director.agent-pick", agent: "director", item: pick.item, step: "pin.director", decider: "owner",
    message: `${pick.item}: agent pick ${pick.candidate} waits for the owner's confirmation` });
  if (director.unreadable) gaps.push({ kind: "wiring", code: "director.unreadable", agent: "director", item: "agents/director", step: null, decider: "agent", message: `the Director root does not read in full: ${director.unreadable}` });
  for (const [cell, why] of director.unclear) gaps.push({ kind: "coverage", code: "director.check", agent: "director", item: `director/${cell}`, step: "pin.director", decider: "agent", message: `pinned cell ${cell}: ${why}` });

  // wiring: seats, citations, chain.
  for (const step of steps) if (isDecide(step) && !step.seat) gaps.push({ kind: "wiring", code: "seat.none", agent: "producer", item: step.id, step: step.id, decider: "agent", message: `decide step ${step.id} names no seat path` });
  for (const [id, seat] of Object.entries(context.seats)) if (seat.state === "invalid") gaps.push({ kind: "wiring", code: "seat.invalid", agent: "producer", item: id, step: "seats", decider: "agent", message: `seat ${id} is invalid: ${seat.issues.map(issue => `${issue.path} ${issue.message}`).join("; ")}` });
  const index = slotIndex(consumer);
  const entries = new Map<SlotAgent, SlotEntry[]>();
  for (const agent of SLOT_AGENTS) entries.set(agent, listSlots(consumer, agent));
  for (const [agent, list] of entries) for (const entry of list) {
    if (!entry.pin || agent === "director") continue;
    const stale: string[] = [];
    for (const input of readSlot(consumer, agent, entry.id).inputs) {
      const upstream = index.get(input);
      if (upstream?.pin && upstream.pin.at > entry.pin.at) stale.push(`${upstream.agent}/${input}`);
    }
    const broken = readiness(consumer, agent, entry.id, index).blockedBy.filter(block => ["invalid-pin", "missing-candidate", "hash-drift", "invalid-candidate", "invalid-slot"].includes(block.reason));
    if (stale.length) gaps.push({ kind: "wiring", code: "citation.stale", agent, item: `${agent}/${entry.id}`, step: `${agent}.candidates`, decider: "agent", message: `pinned ${entry.pin.at.slice(0, 10)}; ${plural(stale.length, "input")} pinned since: ${listed(stale)}` });
    if (broken.length) gaps.push({ kind: "wiring", code: "citation.broken", agent, item: `${agent}/${entry.id}`, step: `${agent}.candidates`, decider: "agent", message: `inputs whose pin no longer clears: ${listed(broken.map(block => `${block.slot} (${block.reason})`))}` });
  }
  for (const row of explainChain(root, { steps, packageRoot }).rows) {
    if (row.kind !== "plumb" || (row.last !== "failed" && row.last !== "stale")) continue;
    gaps.push({ kind: "wiring", code: `chain.${row.last}`, agent: isAgent(row.agent) ? row.agent : "producer", item: row.step, step: row.step, decider: "agent", message: `plumb step ${row.step}'s latest run ${row.last === "failed" ? "failed" : "is stale (an input changed since)"}; clossys run re-runs it` });
  }
  // A recorded candidate whose selection-ladder record does not hold (a created one with no reason no seed fit).
  for (const { record, store, line } of readRuns(root)) {
    const agent = /^(director|designer|writer|publisher)\.candidates$/.exec(record.step)?.[1];
    if (!agent || record.exit !== 0 || !record.decision?.ladder) continue;
    for (const issue of ladderIssues(agent, record.decision.ladder)) gaps.push({ kind: "wiring", code: `ladder.${issue.rule}`, agent: agent as InterviewAgent, item: record.decision.output.path, step: record.step, decider: "agent",
      message: `${store}:${line} ${issue.detail}; submit a new candidate with its ladder record` });
  }

  // requests: a downstream slot citing an upstream slot only its agent can settle.
  const cited = new Map<string, { to: SlotAgent; from: SlotAgent; cell: string; need: string[] }>();
  const citations = new Map<string, number>();
  for (const [agent, list] of entries) for (const entry of list) {
    for (const input of readSlot(consumer, agent, entry.id).inputs) {
      const upstream = index.get(input);
      if (!upstream || upstream.agent === agent) continue;
      citations.set(`${agent}>${upstream.agent}`, (citations.get(`${agent}>${upstream.agent}`) ?? 0) + 1);
      const key = `${agent}>${upstream.agent}/${input}`;
      const row = cited.get(key) ?? { to: upstream.agent, from: agent, cell: input, need: [] };
      row.need.push(`${agent}/${entry.id}`);
      cited.set(key, row);
    }
  }
  const requested = new Set<string>();
  for (const row of cited.values()) {
    const upstream = index.get(row.cell)!;
    const target = `${row.to}/${row.cell}`;
    let code: string | null = null, why = "";
    if (upstream.state.state === "not-needed") { code = "request.input-not-needed"; why = `is not needed (${upstream.state.notNeeded.reason})`; }
    else if (!upstream.candidates.length) { code = "request.input-no-candidates"; why = "has no candidates"; }
    else if (!upstream.pin) { code = "request.input-unpinned"; why = `has ${plural(upstream.candidates.length, "candidate")} and no pin`; }
    else if (row.to === "director" && director.unclear.has(row.cell)) { code = "request.input-unclear"; why = `is unclear: ${director.unclear.get(row.cell)}`; }
    if (!code) continue;
    requested.add(`${row.from}>${row.to}`);
    gaps.push({ kind: "request", code, agent: row.to as InterviewAgent, from: row.from, to: row.to as InterviewAgent, item: target, step: `pin.${row.to}`, decider: "owner", need: row.need,
      message: `${plural(row.need.length, `${row.from} slot`)} (${listed(row.need)}) cite ${target}, which ${why}` });
  }
  // The Publisher's pinned records name Writer keys the pinned copy must hold.
  let copy: ReturnType<typeof writerCopy> | null = null;
  try { copy = writerCopy(consumer); }
  catch (error) { gaps.push({ kind: "wiring", code: "writer.copy-unreadable", agent: "writer", item: "agents/writer", step: "pin.writer", decider: "agent", message: `the pinned Writer copy does not load: ${error instanceof Error ? error.message : String(error)}` }); }
  let keysChecked = 0;
  if (copy) {
    const namespaces = new Set(copy.ids.map(id => id.slice(0, id.indexOf("."))));
    const pinnedWriter = (entries.get("writer") ?? []).filter(entry => entry.pin && entry.id.startsWith("strings.")).map(entry => ({ entry, keys: keysIn(readCandidate(consumer, "writer", entry.id, entry.pin!.candidate).bytes) }));
    const unapproved = writerKeysUnapproved(root);
    const missing = new Map<string, { keys: Set<string>; need: Set<string> }>();
    for (const entry of entries.get("publisher") ?? []) {
      if (!entry.pin || !/^(?:page|publication)\./.test(entry.id)) continue;
      let value: unknown;
      try { value = JSON.parse(readCandidate(consumer, "publisher", entry.id, entry.pin.candidate).bytes); } catch { continue; }
      for (const key of keysNamed(value, namespaces)) {
        keysChecked++;
        if (copy.has(key)) continue;
        // The Writer slot that holds it unapproved, else the one whose keys share the longest prefix.
        const holder = [...unapproved].find(([, keys]) => keys.includes(key))?.[0]
          ?? pinnedWriter.map(row => ({ id: row.entry.id, score: Math.max(0, ...row.keys.map(each => sharedPrefix(each, key))) })).sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1))[0]?.id;
        if (!holder) continue;
        const row = missing.get(holder) ?? { keys: new Set<string>(), need: new Set<string>() };
        row.keys.add(key); row.need.add(`publisher/${entry.id}`);
        missing.set(holder, row);
      }
    }
    for (const [slot, row] of missing) {
      requested.add("publisher>writer");
      const keys = [...row.keys].sort(), need = [...row.need].sort();
      gaps.push({ kind: "request", code: "request.writer-keys", agent: "writer", from: "publisher", to: "writer", item: `writer/${slot}`, step: "writer.approve", decider: "owner", need, keys,
        message: `${plural(need.length, "pinned Publisher record")} (${listed(need)}) name ${plural(keys.length, "Writer key")} writer/${slot}'s pinned copy lacks: ${listed(keys)}` });
    }
  }
  // Open Director request records (requests/*.json) raised downstream.
  for (const request of director.model?.requests ?? []) {
    if (request.status !== "open" && request.status !== "drafted") continue;
    const from = request.raisedBy.replace(/^agent:/, "");
    requested.add(`${from}>director`);
    gaps.push({ kind: "request", code: `request.director-${request.kind}`, agent: "director", from, to: "director", item: request.cells.length === 1 ? `director/${request.cells[0]}` : request.id, step: "director.candidates", decider: "owner", need: request.cells.map(cell => `director/${cell}`),
      message: `${request.id} (${request.status}) by ${request.raisedBy}: ${request.detail}` });
  }
  for (const [pair, count] of [...citations].sort()) {
    if (requested.has(pair)) continue;
    const [from, to] = pair.split(">") as [string, string];
    notes.push(`no ${from} request to the ${to}: every one of the ${plural(count, "citation")} of ${to} slots in ${from} slot inputs is pinned${to === "director" ? ", free of TODO-OWNER lines and clear of blocking Director checks" : ""}, and none is not-needed`);
  }
  if (copy && !requested.has("publisher>writer")) notes.push(`no publisher request to the writer: all ${plural(keysChecked, "Writer key")} the pinned Publisher records name are held by the pinned Writer copy`);
  if (director.model && !(director.model.requests ?? []).some(request => request.status === "open" || request.status === "drafted")) notes.push("no open Director request record (agents/director requests)");

  const order = (gap: Gap) => [INTERVIEW_AGENTS.indexOf(gap.agent), GAP_KINDS.indexOf(gap.kind)];
  gaps.sort((a, b) => { const [x, y] = [order(a), order(b)]; return x[0]! - y[0]! || x[1]! - y[1]!; });
  return { gaps, notes, director: content, unclear: director.unclear };
}

/** One agent's gaps (its own and the requests it raised); every gap when no agent is named. */
function scope(all: { gaps: readonly Gap[]; notes: readonly string[] }, agent: InterviewAgent | undefined): Gaps {
  const gaps = agent ? all.gaps.filter(gap => gap.agent === agent || gap.from === agent) : [...all.gaps];
  const notes = agent ? all.notes.filter(note => note.startsWith(`no ${agent} `) || note.includes(` to the ${agent}:`) || agent === "director" && note.includes("Director request")) : [...all.notes];
  const counts = { coverage: 0, wiring: 0, request: 0, total: gaps.length, held: gaps.filter(gap => gap.held).length };
  for (const gap of gaps) counts[gap.kind]++;
  return { schema: GAPS_SCHEMA, agent: agent ?? null, counts, gaps, notes };
}

/** `clossys gaps [--agent <id>]`: read-only; records nothing. */
export function gapsOf(root: string, options: InterviewOptions & { readonly agent?: InterviewAgent } = {}): Gaps {
  return scope(allGaps(root, options), options.agent);
}

// ---------------------------------------------------------------- questions
type Built = Omit<Question, "options" | "requestedBy" | "after" | "question"> & { options: QuestionOption[]; requestedBy: string[]; after: string[]; question: string };
const FREE_LABEL = "Something else: answer in your own words.";
const optionsFrom = (rows: readonly { label: string; calls: string[][] }[], models: Readonly<Partial<Record<SeatTier, string>>>): QuestionOption[] =>
  rows.slice(0, 4).map((row, index) => {
    const fill: Record<string, string> = {};
    const calls = row.calls.map(argv => argv.map(word => word.replace(/<model:(low|mid|high)>/g, (whole, tier: SeatTier) => {
      const id = models[tier];
      if (id) return id;
      fill[whole] = `the model id your account policy maps to the ${tier} tier (clossys seat --policy records it in ${SEAT_POLICY_FILE})`;
      return whole;
    })));
    for (const argv of calls) for (const word of argv) { const match = PLACEHOLDER.exec(word); if (match) fill[match[1]!] ??= `fill ${match[1]} in your own words`; }
    return { id: String.fromCharCode(97 + index), label: row.label, recommended: index === 0, calls, fill };
  });

/** The seat questions: one per seat class (owner decisions, candidate drafting, agent picks). */
function seatQuestions(items: readonly string[], context: Context, policy: SeatPolicyState, packageRoot: string): Built[] {
  const models = policyModels(policy);
  const humanOnly = policy.state === "ok" && policy.policy.humanOnly;
  const waits = policy.state === "ok" ? [] : ["seat-policy"];
  const target = (item: string) => context.steps.find(step => step.id === item)!;
  const human = (item: string) => {
    const seat = context.seats[item];
    const part = seat && seat.human !== "open" ? seat.human : null;
    return { procedure: part?.procedure ?? skillLine(target(item), packageRoot), command: part?.command ?? verbOf(target(item)) };
  };
  const by = (item: string) => target(item).decider === "owner" ? "owner" : `agent:${target(item).agent}`;
  const llm = (item: string, tier: SeatTier) => ["clossys", "seat", item, "--by", by(item), "--model", `<model:${tier}>`, "--tier", tier, "--prompt-file", skillOf(target(item), packageRoot).path, "--procedure", human(item).procedure, "--command", human(item).command];
  const noLlm = (item: string) => ["clossys", "seat", item, "--by", by(item), "--no-llm", "--procedure", human(item).procedure, "--command", human(item).command];
  const fromSource = (item: string) => ["clossys", "seat", item, "--by", by(item), "--llm-from", `${/^pick\.(.+)$/.exec(item)![1]}.candidates`, "--prompt-file", skillOf(target(item), packageRoot).path, "--procedure", human(item).procedure, "--command", human(item).command];
  const tiers = (["mid", "high"] as const).filter(tier => !humanOnly && (policy.state !== "ok" || models[tier]));
  const classes = [
    { id: "seats.owner", header: "Owner seats", items: items.filter(item => target(item).decider === "owner") },
    { id: "seats.candidates", header: "Draft seats", items: items.filter(item => item.endsWith(".candidates")) },
    { id: "seats.pick", header: "Pick seats", items: items.filter(item => item.startsWith("pick.")) },
  ];
  const out: Built[] = [];
  for (const klass of classes) {
    if (!klass.items.length) continue;
    const rows: { label: string; calls: string[][] }[] = [];
    const human_ = { label: humanOnly ? "Human only, as the seat policy says: no llm (the seats stay listed open until an llm part is added)." : "Human only, no llm: the seats stay listed open until an llm part is added.", calls: klass.items.map(noLlm) };
    let after = [...waits];
    if (klass.id === "seats.pick") {
      const pending = context.steps.filter(step => step.id.endsWith(".candidates") && context.seats[step.id]?.llm === "open").map(step => step.id);
      const source = { label: "Each agent's drafting llm picks among its own candidates (rule W4); you confirm in Studio.", calls: klass.items.map(fromSource) };
      if (humanOnly) rows.push({ label: "No agent pick: you pin every slot yourself (the seats stay listed open).", calls: klass.items.map(noLlm) }, source);
      else rows.push(source, { label: "No agent pick: you pin every slot yourself (the seats stay listed open).", calls: klass.items.map(noLlm) });
      if (pending.length) after = [...new Set([...after, "seats.candidates"])];
    } else {
      const owner = klass.id === "seats.owner";
      for (const tier of tiers) rows.push({ label: owner ? `You decide; a ${tier}-tier llm drafts each recommendation from the step's skill first.` : `Each agent drafts at ${tier} tier with its skill; you review in Studio.`, calls: klass.items.map(item => llm(item, tier)) });
      if (humanOnly) rows.unshift(human_); else rows.push(human_);
      if (rows.length < 2) rows.push({ label: "Name the tier models first (the seat policy), then answer with them.", calls: [["clossys", "seat", "--policy", "--model", "mid=<model:mid>"]] });
    }
    out.push({
      id: klass.id, agent: "producer", step: "seats", header: klass.header, items: klass.items,
      question: `Who decides the ${plural(klass.items.length, klass.id === "seats.owner" ? "owner decision" : klass.id === "seats.pick" ? "agent pick" : "candidate drafting step")} (${listed(klass.items, 5)})?`,
      options: optionsFrom(rows, models), freeText: { id: "other", label: FREE_LABEL, verb: "clossys seat" }, after, requestedBy: [],
    });
  }
  return out;
}

function policyQuestion(policy: SeatPolicyState, given: Readonly<Partial<Record<SeatTier, string>>>): Built {
  const named = Object.entries(given).filter(([, id]) => id) as [SeatTier, string][];
  const rows = [
    named.length
      ? { label: `Seats use ${named.map(([tier, id]) => `${tier}=${id}`).join(", ")}.`, calls: [["clossys", "seat", "--policy", ...named.flatMap(([tier, id]) => ["--model", `${tier}=${id}`])]] }
      : { label: "Name the model id your account policy maps to each seat tier.", calls: [["clossys", "seat", "--policy", "--model", "mid=<model:mid>", "--model", "high=<model:high>"]] },
    { label: "Human only: no seat runs an llm.", calls: [["clossys", "seat", "--policy", "--human-only"]] },
  ];
  return {
    id: "seat-policy", agent: "producer", step: "seats", header: "Seat policy", items: [SEAT_POLICY_FILE],
    question: policy.state === "missing" ? `Which model does each seat tier use? (${SEAT_POLICY_FILE} is missing; every seat answer waits on it)` : `${SEAT_POLICY_FILE} is invalid; which model does each seat tier use?`,
    options: optionsFrom(rows, {}), freeText: { id: "other", label: FREE_LABEL, verb: "clossys seat --policy" }, after: [], requestedBy: [],
  };
}

/** Owner packets of one step grouped by option shape: items whose answers differ only by item and candidate rank are one question. */
function packetQuestions(packets: readonly Packet[]): Built[] {
  const groups = new Map<string, Packet[]>();
  const shape = (packet: Packet) => {
    const names = candidateNames(packet);
    return JSON.stringify((packet.options ?? []).map(option => option.argv?.map(word => word === packet.item ? "<item>" : names.has(word) ? `<rank:${names.get(word)}>` : word) ?? null));
  };
  for (const packet of packets) {
    const key = `${packet.step}|${shape(packet)}`;
    groups.set(key, [...(groups.get(key) ?? []), packet]);
  }
  return [...groups.values()].map(group => {
    const first = group[0]!;
    const many = group.length > 1;
    const names = candidateNames(first);
    const rows = (first.options ?? []).filter(option => option.argv).map((option, index) => ({
      label: many ? option.label.replace(/\s*\(.*\)/, "").replace(first.item, "each").replace(/\S+-v\d+\.(?:md|json)/g, word => names.get(word) === 0 ? "the newest candidate" : names.get(word) === 1 ? "the previous candidate" : "an earlier candidate") : option.label,
      calls: group.map(packet => [...(packet.options ?? []).filter(each => each.argv)[index]!.argv!]),
    }));
    // Never a lone answer: a slot's owner can always ask its agent for a draft first.
    if (rows.length < 2 && first.item.includes("/")) rows.push({ label: `The ${prefixOf(first.item)} drafts ${many ? "each" : first.item} (again) first.`, calls: group.map(packet => ["clossys", "options", packet.item, "--redraft"]) });
    const agent = isAgent(prefixOf(first.item)) ? prefixOf(first.item) as InterviewAgent : first.step === "evidence" ? "director" : "producer";
    return {
      id: many ? `${first.step}:${group.length}` : `${first.step}:${first.item}`, agent, step: first.step, header: first.step.slice(0, 12),
      question: many ? `${first.question.replace(first.item, `each of ${plural(group.length, "item")}`)} (${listed(group.map(packet => packet.item))})` : first.question,
      items: group.map(packet => packet.item), options: optionsFrom(rows, {}),
      freeText: { id: "other", label: FREE_LABEL, verb: first.record.split(" ").slice(0, 2).join(" ") }, after: [], requestedBy: [],
    };
  });
}
/** Candidate file names an owner packet's answers name, by rank (0 = newest). */
function candidateNames(packet: Packet): Map<string, number> {
  const names = (packet.options ?? []).flatMap(option => option.argv ?? []).filter(word => /-v\d+\.(?:md|json)$/.test(word));
  const version = (name: string) => Number(/-v(\d+)\./.exec(name)![1]);
  return new Map([...new Set(names)].sort((a, b) => version(b) - version(a)).map((name, rank) => [name, rank]));
}

/** A request gap as a question for its addressee: settle the upstream slot, or the downstream slots re-draft without it. */
function requestQuestion(gap: Gap, root: string, agentHeld: ReadonlySet<string> = new Set()): Built {
  const to = gap.to!, need = gap.need ?? [];
  const names = gap.item.includes("/") ? candidatesOf(root, gap.item) : [];
  const newest = names.slice(-2).reverse();
  const redraft = (item: string) => ["clossys", "options", item, "--redraft"];
  const rows: { label: string; calls: string[][] }[] = [];
  const downstream = { label: `The ${gap.from} re-drafts ${plural(need.length, "slot")} without it.`, calls: need.map(redraft) };
  if (gap.code === "request.writer-keys") {
    const unapproved = writerKeysUnapproved(root).get(slotOf(gap.item)) ?? [];
    if (newest[0] && (gap.keys ?? []).some(key => unapproved.includes(key))) rows.push({ label: `Approve ${newest[0]}, which holds the keys.`, calls: [["clossys", "approve", gap.item, newest[0]]] });
    rows.push({ label: `The Writer re-drafts ${gap.item} with the ${plural(gap.keys?.length ?? 0, "missing key")}.`, calls: [redraft(gap.item)] });
    rows.push({ label: `The Publisher re-drafts ${plural(need.length, "record")} without them.`, calls: need.map(redraft) });
  } else if (gap.code === "request.input-not-needed") {
    rows.push(downstream);
    if (newest[0]) rows.push({ label: `Reopen it: pin ${newest[0]}.`, calls: [["clossys", "pin", gap.item, newest[0], "--basis", "picked"]] });
    else rows.push({ label: `Reopen it: the ${to} drafts it.`, calls: [redraft(gap.item)] });
  } else if (gap.code === "request.input-unclear") {
    const evidence = { label: "Answer it as owner evidence; the Director re-drafts the cell on it.", calls: [["clossys", "evidence", "<id>", "--source", "owner", "--observed", new Date().toISOString().slice(0, 10), "--by", "owner", "--body", "<answer.md>"], redraft(gap.item)] };
    const own = { label: "The Director re-drafts the cell from the evidence it has.", calls: [redraft(gap.item)] };
    // An agent-held cell is the Director's to re-draft (owner, 2026-11-11); owner evidence is the alternative, not the ask.
    rows.push(...(agentHeld.has(gap.item) ? [own, evidence] : [evidence, own]));
    rows.push(downstream);
  } else if (gap.code === "request.input-unpinned") {
    for (const name of newest) rows.push({ label: `Pin ${name}.`, calls: [["clossys", "pin", gap.item, name, "--basis", "picked"]] });
    rows.push(downstream);
  } else {
    rows.push({ label: `The ${to} drafts ${gap.item} now.`, calls: [redraft(gap.item)] }, downstream);
  }
  return {
    id: `request:${gap.item}`, agent: to, step: gap.step, header: "Request", items: [gap.item],
    question: `${gap.message}. How does the ${to} answer?`, options: optionsFrom(rows, {}),
    freeText: { id: "other", label: FREE_LABEL, verb: gap.code === "request.writer-keys" ? "clossys approve" : "clossys pin" }, after: [], requestedBy: [gap.from!],
  };
}

// ---------------------------------------------------------------- Director content
const ARCHETYPE_QUESTION = "director.archetype";
const AGENT_PICKS_QUESTION = "director.agent-picks";
const today = () => new Date().toISOString().slice(0, 10);
/** The owner's own words for a Director cell: recorded as owner evidence, then the cell is re-drafted on it. */
const ownWords = (item: string) => ({
  calls: [["clossys", "evidence", "<id>", "--source", "owner", "--observed", today(), "--by", "owner", "--body", "<answer.md>"], ["clossys", "options", item, "--redraft"]],
  fill: { "<id>": "a finding id for your answer (owner-<topic>-<date>)", "<answer.md>": "a file with your words, verbatim" },
});

function archetypeQuestion(content: DirectorContent): Built {
  const rows = content.archetypes.map(each => ({
    label: each.name === "default" ? `default: the ${content.core.length} core cells stay as they are.` : `${each.name}: adds ${each.extras.join(", ")} to the core.`,
    calls: [["clossys", "director", "check", "archetype", each.name, "--by", "owner"]],
  }));
  return {
    id: ARCHETYPE_QUESTION, agent: "director", step: "director.store", header: "Archetype", items: [`evidence/director/${ARCHETYPE_RECORD_ID}.md`],
    question: "Which archetype is the project? (it decides which cells are core; no archetype is recorded yet)",
    options: optionsFrom(rows, {}), freeText: { id: "other", label: FREE_LABEL, verb: "clossys evidence", calls: [ownWords("").calls[0]!], fill: ownWords("").fill }, after: [], requestedBy: [],
  };
}

function contentQuestions(content: DirectorContent, after: readonly string[]): Built[] {
  return content.owner.map(row => {
    const rows = row.round.slice(0, 4).map(candidate => ({ label: `${candidate.summary} (${candidate.name})`, calls: [["clossys", "pin", row.item, candidate.name, "--basis", "picked"]] }));
    // Never a lone answer: the owner can always ask the Director for another option first.
    if (rows.length < 2) rows.push({ label: "The Director drafts another option first.", calls: [["clossys", "options", row.item, "--more"]] });
    return {
      id: `director:${row.cell}`, agent: "director", step: "pin.director", header: row.header, items: [row.item],
      question: `Pick ${row.title}`, options: optionsFrom(rows, {}),
      freeText: { id: "other", label: FREE_LABEL, verb: "clossys evidence", ...ownWords(row.item) }, after: [...after], requestedBy: [],
    };
  });
}

function agentPicksQuestion(content: DirectorContent, unclear: ReadonlyMap<string, string>, after: readonly string[]): Built {
  const picks = content.agentPicks;
  const groups = new Map<string, string[]>();
  for (const pick of picks) groups.set(pick.group, [...(groups.get(pick.group) ?? []), pick.cell]);
  const failing = picks.filter(pick => unclear.has(pick.cell)).length;
  const rows = [
    { label: `Confirm all ${plural(picks.length, "agent pick")}${failing ? ` (${failing} still have blocking findings)` : ""}.`, calls: picks.map(pick => ["clossys", "pin", pick.item, pick.candidate, "--basis", "bulk"]) },
    { label: `Review them by group (${[...groups].map(([group, cells]) => `${group} ${cells.length}`).join(", ")}): the Director plays each group back.`, calls: picks.map(pick => ["clossys", "options", pick.item]) },
  ];
  return {
    id: AGENT_PICKS_QUESTION, agent: "director", step: "pin.director", header: "Agent picks", items: picks.map(pick => pick.item),
    question: `Confirm ${plural(picks.length, "agent pick")} (the non-core cells the Director picked)?`, options: optionsFrom(rows, {}),
    freeText: { id: "other", label: FREE_LABEL, verb: "clossys evidence", calls: [ownWords("").calls[0]!], fill: ownWords("").fill }, after: [...after], requestedBy: [],
  };
}

/** Questions into rounds of at most ROUND_SIZE, each after every question it waits on. */
export function roundsOf(questions: readonly Question[]): Question[][] {
  const rounds: Question[][] = [];
  const placed = new Map<string, number>();
  for (const question of questions) {
    let at = Math.max(0, ...question.after.filter(id => placed.has(id)).map(id => placed.get(id)! + 1));
    while ((rounds[at]?.length ?? 0) >= ROUND_SIZE) at++;
    (rounds[at] ??= []).push(question);
    placed.set(question.id, at);
  }
  return rounds.filter(round => round.length);
}

/** `clossys next --owner [--agent <id>]`: the owner questions the gaps hold, in agent order and rounds. */
export function interviewOf(root: string, options: InterviewOptions & { readonly agent?: InterviewAgent } = {}): Interview {
  const steps = options.steps ?? STEPS;
  const packageRoot = options.packageRoot ?? PACKAGE_ROOT;
  const context = contextOf(root, steps);
  const policy = readSeatPolicy(root);
  const all = allGaps(root, options);
  const asked = all.gaps.filter(gap => gap.decider === "owner" && !gap.held);
  const questions: Built[] = [];
  if (policy.state !== "ok") questions.push(policyQuestion(policy, options.models ?? {}));
  const seatItems = asked.filter(gap => gap.code === "open.seats").map(gap => gap.item);
  questions.push(...seatQuestions(seatItems, context, policy, packageRoot));
  // The Director's content: the archetype first, then each owner-held core round as "Pick <cell>".
  const content = all.director;
  const contentItems = new Set(content?.owner.map(row => row.item) ?? []);
  const archetype = content && asked.some(gap => gap.code === "director.archetype") ? archetypeQuestion(content) : null;
  if (archetype) questions.push(archetype);
  const contentAsked = content ? contentQuestions({ ...content, owner: content.owner.filter(row => asked.some(gap => gap.item === row.item && (gap.code === "director.owner-round" || gap.code === "open.pin.director"))) }, archetype ? [archetype.id] : []) : [];
  questions.push(...contentAsked);
  const packets = asked.filter(gap => gap.code.startsWith("open.") && gap.code !== "open.seats" && !(gap.code === "open.pin.director" && contentItems.has(gap.item))).map(gap => {
    const step = steps.find(each => each.id === gap.step)!;
    return packetOf(step, gap.item, 1, context, { packageRoot });
  });
  questions.push(...packetQuestions(packets));
  // A request for a cell already asked folds into that question; the confirm question takes none.
  const agentHeld = new Set(content?.agentPicks.map(pick => pick.item) ?? []);
  const unblocks = new Map<string, Map<string, Set<string>>>();
  for (const gap of asked.filter(each => each.kind === "request")) {
    const merged = questions.find(question => question.id !== AGENT_PICKS_QUESTION && question.items.includes(gap.item) && question.agent === gap.agent);
    if (merged) {
      merged.requestedBy = [...new Set([...merged.requestedBy, gap.from!])];
      const byAgent = unblocks.get(merged.id) ?? new Map<string, Set<string>>();
      for (const need of gap.need ?? []) byAgent.set(prefixOf(need), new Set([...(byAgent.get(prefixOf(need)) ?? []), need]));
      unblocks.set(merged.id, byAgent);
      continue;
    }
    questions.push(requestQuestion(gap, root, agentHeld));
  }
  for (const question of questions) {
    const byAgent = unblocks.get(question.id);
    if (byAgent?.size) question.question = `${question.question} (also unblocks ${[...byAgent].map(([agent, needs]) => plural(needs.size, `${agent} slot`)).join(", ")})`;
  }
  // The rest of the Director's round waits on its content: agent picks and request records cite the core.
  const lastContent = contentAsked.at(-1)?.id;
  const picks = asked.filter(gap => gap.code === "director.agent-pick");
  if (content && picks.length) questions.push(agentPicksQuestion({ ...content, agentPicks: content.agentPicks.filter(pick => picks.some(gap => gap.item === pick.item)) }, all.unclear, lastContent ? [lastContent] : []));
  if (lastContent) for (const question of questions) if (question.agent === "director" && question.id.startsWith("request:")) question.after = [...new Set([...question.after, lastContent])];
  // Requests first within an agent (a downstream agent is waiting on them), except the Director's
  // content, which runs archetype first, then the core in dependency order.
  const contentIds = new Set(contentAsked.map(question => question.id));
  const rank = (question: Question) => [INTERVIEW_AGENTS.indexOf(question.agent), question.id === "seat-policy" ? -3 : question.id === ARCHETYPE_QUESTION ? -2 : contentIds.has(question.id) ? -1 : question.requestedBy.length ? 0 : 1];
  const ordered = questions.map((question, index) => ({ question, index })).sort((a, b) => {
    const [x, y] = [rank(a.question), rank(b.question)];
    return x[0]! - y[0]! || x[1]! - y[1]! || a.index - b.index;
  }).map(row => row.question);
  const scoped = options.agent ? ordered.filter(question => question.agent === options.agent) : ordered;
  const counts = scope(all, options.agent).counts;
  return { schema: INTERVIEW_SCHEMA, agent: options.agent ?? null, policy: policy.state, count: scoped.length, rounds: roundsOf(scoped), gaps: counts };
}

/** Problems with emitted questions: what check:step-standard's owner.argv and request.addressee rules fail on. */
export function interviewIssues(interview: Pick<Interview, "rounds">, gaps: Pick<Gaps, "gaps">): { rule: "owner.argv" | "request.addressee"; message: string }[] {
  const issues: { rule: "owner.argv" | "request.addressee"; message: string }[] = [];
  for (const round of interview.rounds) {
    if (round.length > ROUND_SIZE) issues.push({ rule: "owner.argv", message: `a round holds ${round.length} questions (at most ${ROUND_SIZE})` });
    for (const question of round) {
      if (question.options.length < 2 || question.options.length > 4) issues.push({ rule: "owner.argv", message: `${question.id}: ${question.options.length} options (2 to 4, plus free text)` });
      if (!question.options[0]?.recommended) issues.push({ rule: "owner.argv", message: `${question.id}: the first option is not the recommended one` });
      if (!question.freeText?.verb?.startsWith("clossys ")) issues.push({ rule: "owner.argv", message: `${question.id}: the free-text answer names no clossys verb` });
      for (const option of question.options) {
        if (!option.calls.length) issues.push({ rule: "owner.argv", message: `${question.id} ${option.id}: no argv` });
        for (const call of option.calls) if (call[0] !== "clossys" || call.length < 2) issues.push({ rule: "owner.argv", message: `${question.id} ${option.id}: ${JSON.stringify(call)} is not a clossys argv` });
        for (const call of option.calls) for (const word of call) { const match = PLACEHOLDER.exec(word); if (match && !(match[1]! in option.fill)) issues.push({ rule: "owner.argv", message: `${question.id} ${option.id}: ${match[1]} is neither filled nor named in fill` }); }
      }
    }
  }
  for (const gap of gaps.gaps) if (gap.kind === "request" && (!gap.to || !isAgent(gap.to) || gap.to !== gap.agent || !gap.from || gap.from === gap.to)) issues.push({ rule: "request.addressee", message: `request ${gap.code} ${gap.item} has no upstream addressee (to ${gap.to ?? "none"}, from ${gap.from ?? "none"})` });
  return issues;
}
