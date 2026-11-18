/**
 * The request facts the Q rows judge (foundry-build-0048 U7): every clossys.queue-entry/2 about an agent with its
 * re-derived route and owner class, the queue-entry/1 fixes still raised, the run ledgers, the agent's declared request
 * handling skills, and the Producer machinery (routing table, owner classes, fix raisers, release gates). Read once
 * from disk; assertions.ts judges. An agent "is about" an entry when it raised it (`from`), holds it (`assignee`) or
 * owns its target slot.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { gapsOf } from "../pipeline/interview.js";
import { consumerFacts, ownerClassOf, ownerClasses, readDeclarations, rederive, routingIssues, type RoutingFacts } from "../queue/routing.js";
import { listWorkEntries, requestIssues, resultRefusal, slotlessNeeds } from "../records/request.js";
import { gateRunners, openFixes, RELEASE_GATES, REQUESTS_OPEN_FIX } from "../release/gates.js";
import { releaseResolutions } from "../release/pins.js";
import { seatRefusal } from "../records/seat-owner.js";
import type { SlotRequest } from "../records/types.js";

const object = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
function json(path: string): unknown {
  try { return JSON.parse(readFileSync(path, "utf8")); } catch { return undefined; }
}
const isDir = (path: string): boolean => { try { return statSync(path).isDirectory(); } catch { return false; } };

/** One clossys.queue-entry/2 entry with what the router says about it now. */
export interface QueueFact {
  readonly kind: string;
  readonly id: string;
  readonly doc: Readonly<Record<string, unknown>>;
  /** requestIssues on the doc: a closed entry missing its link back is listed here. */
  readonly issues: readonly string[];
  /** `rederive` on an open entry: undefined when the recorded route is the one the table gives now (a closed entry keeps its route). */
  readonly routeIssue?: string;
  /** The owner step (`<loop>/<version>#<step>`) and queue reserving the target, when it falls in an owner class. */
  readonly ownerClass?: { readonly step: string; readonly queue: string };
  /** A closed change or fix: why its result ref does not resolve. */
  readonly resultIssue?: string;
}
/** One run ledger: the entries it answers (`<queue>#<id>`, `*#<id>` for a run's request id) and every step's decider and written paths (under agents/). */
export interface RunFact {
  readonly id: string;
  readonly loop: string;
  readonly status: string;
  readonly createdAt: string;
  readonly cites: readonly string[];
  readonly steps: readonly { readonly id: string; readonly agent?: string; readonly by: string; readonly wrote: readonly string[] }[];
}
export interface AgentRequestFacts {
  /** Package source files scanned for a request store of the agent's own. */
  readonly sourceFiles: number;
  readonly localStores: readonly string[];
  readonly entries: readonly QueueFact[];
  /** clossys.queue-entry/1 queue.fix entries about the agent's slots: breakage raised as a decision entry. */
  readonly legacyFixes: readonly { readonly id: string; readonly subject: string; readonly status: string }[];
  /** Interview request gaps about the agent that no open entry records, and its unfiled slotless needs. */
  readonly unrecorded: readonly string[];
  readonly needs: number;
  readonly skills: readonly { readonly kind: string; readonly skill: string; readonly loop: string; readonly exists: boolean; readonly registered: boolean; readonly hasRequests: boolean }[];
  /** Owner steps reserving a class of this agent's slots (`<loop>/<version>#<step>`). */
  readonly ownerClasses: readonly string[];
  /** conform.json `requests.issuing`: the agents this one may raise to, and the kinds; undefined when undeclared. */
  readonly issuing?: readonly { readonly to: string; readonly kinds: readonly string[] }[];
  /** conform.json declares `requests` at all. */
  readonly declared: boolean;
}
export interface RequestMachinery {
  readonly routingIssues: readonly string[];
  readonly ownerPacketRow: boolean;
  readonly ownerClassCount: number;
  /** Producer source files that raise a clossys.queue-entry/1 queue.fix (Q10: breakage is kind fix). */
  readonly fixRaisers: readonly string[];
  /** Interview request gap codes that print a need and file no record, of `gapCodes` request codes in all. */
  readonly printedGaps: readonly string[];
  readonly gapCodes: number;
  readonly releaseGates: readonly string[];
  readonly runs: readonly RunFact[];
  /** `<queue>#<id>` of every /2 entry an open queue-entry/1 entry cites (a stopped run's re-ask). */
  readonly reasked: ReadonlySet<string>;
  /** Q9's verb half: why a verb would let a seat act on another agent's slot (the seat rule probed, and pick wired to it). */
  readonly seatGuardIssues: readonly string[];
  /**
   * Q11: whether release's runGates wires requests.open-fix, the slots a release reads (the one resolver, slot level)
   * and the slots the gate refuses on this consumer now; read on first use.
   */
  readonly openFix: { readonly wired: boolean; readonly closure: ReadonlySet<string>; readonly refused: ReadonlySet<string>; readonly error?: string };
}

const SOURCE = /\.(ts|tsx|mts)$/;
const skipSource = (name: string) => name === "node_modules" || name === "dist" || name === "__fixtures__" || name === "generated" || /\.test\.|\.spec\./.test(name);
function sources(dir: string, out: string[] = []): string[] {
  if (!isDir(dir)) return out;
  for (const name of readdirSync(dir).sort()) {
    if (skipSource(name)) continue;
    const path = join(dir, name);
    if (isDir(path)) sources(path, out); else if (SOURCE.test(name)) out.push(path);
  }
  return out;
}

/**
 * An agent-local request store in package source: a record id of its own (`REQ-NNNN`, `NEED-NNN`) or a store folder
 * literal (`needs/`, `requests/`) the package reads or writes. Requests live in Producer's queue only (Q1).
 */
const STORE_MARKERS: readonly [RegExp, string][] = [
  [/\^?(REQ|NEED)-(\\d|\[0-9\]|\$\{|\d)/, "a request record id of its own"],
  [/["'`](needs|requests)\/(\$\{|["'`])|containedPath\([^)]*["'`](needs|requests)["'`]/, "a request store folder of its own"],
];
export function localStores(packageDir: string): { files: number; rows: string[] } {
  const files = sources(join(packageDir, "src"));
  const rows: string[] = [];
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    for (const [pattern, what] of STORE_MARKERS) {
      const match = pattern.exec(text);
      if (match) rows.push(`${relative(packageDir, file)}: ${what} (${match[0].slice(0, 24)})`);
    }
  }
  return { files: files.length, rows };
}

/** Every request gap code the interview emits (`code: "request.x"` or `code = "request.x"`; `request.director-*` for a templated one). */
export function gapCodesOf(interviewText: string): string[] {
  return [...new Set([...interviewText.matchAll(/\bcode(?:: | = )["'`](request\.[a-z-]+)(\$\{)?/g)].map(match => match[2] ? `${match[1]}*` : match[1]!))].sort();
}
/**
 * The interview's request gap codes that print a need without a record: every code except one pushed right after a
 * `filed.has(` dedupe against the open queue entries (that need is filed as a kind slot entry).
 */
export function printedGapCodes(interviewText: string): string[] {
  const filed = new Set<string>();
  for (const match of interviewText.matchAll(/filed\.has\(/g)) {
    for (const code of interviewText.slice(match.index, match.index + 600).matchAll(/code: ["'`](request\.[a-z-]+)["'`]/g)) filed.add(code[1]!);
  }
  return gapCodesOf(interviewText).filter(code => !filed.has(code));
}

function readRuns(consumer: string): RunFact[] {
  const producer = join(consumer, "agents", "producer");
  if (!isDir(producer)) return [];
  const runs: RunFact[] = [];
  for (const folder of readdirSync(producer).filter(name => name.startsWith("ledger.")).sort()) {
    const dir = join(producer, folder, "entries");
    if (!isDir(dir)) continue;
    for (const name of readdirSync(dir).filter(file => file.endsWith(".json")).sort()) {
      const doc = json(join(dir, name));
      if (!object(doc)) continue;
      // A run answers an entry by an `answers` ref, its trigger ref or its `request` id (a raisedBy ref is the entry it raised).
      const refs = [...(Array.isArray(doc.refs) ? doc.refs.filter(object).filter(ref => ref.rel === "answers") : []), ...(object(doc.trigger) && object(doc.trigger.ref) ? [doc.trigger.ref] : [])].filter(object);
      const cites = [...new Set([...refs.filter(ref => typeof ref.to === "string" && /^producer\/queue\.[a-z]+$/.test(ref.to) && typeof ref.record === "string")
        .map(ref => `${String(ref.to).slice("producer/".length)}#${String(ref.record)}`), ...(typeof doc.request === "string" ? [`*#${doc.request}`] : [])])];
      const steps = (Array.isArray(doc.steps) ? doc.steps : []).filter(object).map(step => {
        const decider = object(step.decider) ? step.decider : {};
        return {
          id: String(step.id), by: String(decider.by ?? "unknown"), ...(typeof decider.agent === "string" ? { agent: decider.agent } : {}),
          wrote: (Array.isArray(step.wrote) ? step.wrote : []).filter(object).map(row => String(row.file)),
        };
      });
      runs.push({ id: String(doc.id ?? name.slice(0, -5)), loop: String(doc.loop), status: String(doc.status), createdAt: String(doc.createdAt ?? ""), cites, steps });
    }
  }
  return runs;
}

/** queue-entry/1 fixes and the /2 entries open /1 entries cite. */
function readDecisionEntries(consumer: string): { fixes: { id: string; subject: string; status: string }[]; reasked: Set<string> } {
  const producer = join(consumer, "agents", "producer");
  const fixes: { id: string; subject: string; status: string }[] = [];
  const reasked = new Set<string>();
  for (const queue of ["queue.pick", "queue.approve", "queue.clarify", "queue.fix"]) {
    const dir = join(producer, queue, "entries");
    if (!isDir(dir)) continue;
    for (const name of readdirSync(dir).filter(file => file.endsWith(".json")).sort()) {
      const doc = json(join(dir, name));
      if (!object(doc) || doc.schema === "clossys.queue-entry/2") continue;
      const subject = object(doc.subject) && typeof doc.subject.to === "string" ? doc.subject.to : "";
      if (queue === "queue.fix") fixes.push({ id: String(doc.id ?? name.slice(0, -5)), subject, status: String(doc.status) });
      if (doc.status !== "open") continue;
      for (const ref of [...(Array.isArray(doc.refs) ? doc.refs : []), doc.subject].filter(object)) {
        if (typeof ref.to === "string" && /^producer\/queue\.(slot|change|fix)$/.test(ref.to) && typeof ref.record === "string") reasked.add(`${ref.to.slice("producer/".length)}#${ref.record}`);
      }
    }
  }
  return { fixes, reasked };
}

/** One conform read's shared facts (routing, interview gaps), keyed by repo and consumer; reset per model read. */
const cache = new Map<string, { routing?: { facts?: RoutingFacts; issues: string[] }; gaps?: ReturnType<typeof gapsOf>["gaps"] | Error }>();
export const resetRequestFacts = (): void => cache.clear();
const slotOf = (repo: string, consumer: string) => {
  const key = `${repo}\0${consumer}`;
  if (!cache.has(key)) cache.set(key, {});
  return cache.get(key)!;
};
function routingOf(repo: string, consumer: string): { facts?: RoutingFacts; issues: string[] } {
  const slot = slotOf(repo, consumer);
  if (slot.routing) return slot.routing;
  const file = join(repo, "packages/producer/src/queue/routing.json");
  const text = existsSync(file) ? readFileSync(file, "utf8") : undefined;
  let doc: unknown;
  try { doc = text === undefined ? undefined : JSON.parse(text); } catch { doc = undefined; }
  const issues = text === undefined ? ["packages/producer/src/queue/routing.json is missing"] : doc === undefined ? ["routing.json is not JSON"] : routingIssues(doc);
  if (issues.length) slot.routing = { issues };
  else {
    // A refused read (owner classes that do not read) is a routing issue, never an empty owner list.
    try { slot.routing = { facts: consumerFacts(consumer, { text, loopsDir: join(repo, "packages/producer/loops"), packagesDir: join(repo, "packages") }), issues: [] }; } catch (error) {
      slot.routing = { issues: [`the router refuses: ${error instanceof Error ? error.message : String(error)} (no owner class is read)`] };
    }
  }
  return slot.routing;
}
function gapsFor(repo: string, consumer: string): ReturnType<typeof gapsOf>["gaps"] {
  const slot = slotOf(repo, consumer);
  if (slot.gaps === undefined) {
    try { slot.gaps = gapsOf(dirname(consumer)).gaps; } catch (error) { slot.gaps = error instanceof Error ? error : new Error(String(error)); }
  }
  if (slot.gaps instanceof Error) throw slot.gaps;
  return slot.gaps;
}

/**
 * Q9's verb half: the seat rule (records/seat-owner.ts) refuses another agent's seat and lets the slot's own agent and
 * a judging seat act, and `clossys pick` calls it before it writes. `next --submit` and `options` take no seat: a
 * submit acts as the owning step's agent, and options writes no decision.
 */
export function seatGuardIssues(repo: string): string[] {
  const out: string[] = [];
  const probes: [string, string, boolean][] = [["agent:writer", "designer", true], ["agent:director.candidates", "designer", true], ["agent:designer", "designer", false], ["agent:designer.verdict", "designer", false], ["agent:judge", "writer", false]];
  for (const [by, agent, refused] of probes) if ((seatRefusal(by, agent) !== undefined) !== refused) out.push(`the seat rule ${refused ? "lets" : "refuses"} --by ${by} on a ${agent} slot`);
  const file = join(repo, "packages/producer/src/cli/options.ts");
  const text = existsSync(file) ? readFileSync(file, "utf8") : "";
  const start = text.indexOf("export async function runPickCli");
  const body = start < 0 ? "" : text.slice(start);
  const guard = body.indexOf("seatRefusal(flags.by, agent)"), write = body.indexOf("writePin(");
  if (!body || guard < 0 || write < 0 || guard > write) out.push("clossys pick (src/cli/options.ts runPickCli) does not refuse a seat of another agent before it writes the pin");
  return out;
}

/** The release side of Q11 on one consumer (`root` holds clossys/): the gate as runGates calls it, never a copy. */
export function openFixFacts(root: string): RequestMachinery["openFix"] {
  try {
    const wired = Object.keys(gateRunners(root, "-", undefined)).includes(REQUESTS_OPEN_FIX);
    const closure = new Set(releaseResolutions(root).map(resolution => `${resolution.agent}/${resolution.slotId}`));
    const refused = new Set(openFixes(root).map(finding => finding.subject));
    return { wired, closure, refused };
  } catch (error) {
    return { wired: false, closure: new Set(), refused: new Set(), error: error instanceof Error ? error.message : String(error) };
  }
}

export function readRequestMachinery(repo: string, consumer: string): RequestMachinery {
  const producer = join(repo, "packages/producer");
  const { issues, facts } = routingOf(repo, consumer);
  const table = object(json(join(producer, "src/queue/routing.json"))) ? json(join(producer, "src/queue/routing.json")) as { rows?: unknown } : {};
  const rows = Array.isArray(table.rows) ? table.rows.filter(object) : [];
  const interview = existsSync(join(producer, "src/pipeline/interview.ts")) ? readFileSync(join(producer, "src/pipeline/interview.ts"), "utf8") : "";
  const fixRaisers = sources(join(producer, "src")).filter(file => /queue: *["'`]queue\.fix["'`]/.test(readFileSync(file, "utf8"))).map(file => relative(repo, file));
  const decisions = readDecisionEntries(consumer);
  let openFix: RequestMachinery["openFix"] | undefined;
  return {
    routingIssues: issues, ownerPacketRow: rows.some(row => row.to === "owner-packet"),
    ownerClassCount: facts ? facts.classes.length : (() => { try { return ownerClasses(join(producer, "loops")).length; } catch { return 0; } })(),
    fixRaisers, printedGaps: printedGapCodes(interview), gapCodes: gapCodesOf(interview).length, releaseGates: [...RELEASE_GATES], runs: readRuns(consumer), reasked: decisions.reasked,
    seatGuardIssues: seatGuardIssues(repo),
    get openFix() { return openFix ??= openFixFacts(dirname(consumer)); },
  };
}

const about = (agent: string, doc: Record<string, unknown>): boolean =>
  (typeof doc.from === "string" && doc.from.startsWith(`${agent}/`)) || doc.assignee === agent || (typeof doc.target === "string" && doc.target.startsWith(`${agent}/`));

export function readAgentRequests(repo: string, consumer: string, agent: string, hashed: ReadonlySet<string>): AgentRequestFacts {
  const declared = readDeclarations(agent, join(repo, "packages"))?.requests;
  const handling = declared?.handling;
  const facts = routingOf(repo, consumer).facts;
  const entries: QueueFact[] = listWorkEntries(consumer).flatMap(read => {
    if (!read.request) {
      // An entry that does not read is a finding, never dropped: kept with its issues for every agent it names (all
      // four when it names none), so Q1 (and Q7, when it says it is closed) report it.
      const doc = object(read.doc) ? read.doc : {};
      const named = typeof doc.from === "string" || typeof doc.assignee === "string" || typeof doc.target === "string";
      if (named && !about(agent, doc)) return [];
      const kind = typeof doc.kind === "string" ? doc.kind : basename(dirname(dirname(read.file))).replace(/^queue\./, "");
      const id = typeof doc.id === "string" ? doc.id : basename(read.file).replace(/\.json$/, "");
      return [{ kind, id, doc, issues: read.issues.length ? read.issues : ["does not read as a clossys.queue-entry/2 work entry"] }];
    }
    const doc = read.request as unknown as Record<string, unknown>;
    if (!about(agent, doc)) return [];
    const request = read.request;
    // A closed entry keeps the route it was given: re-derived against today's table and placements it could differ
    // legitimately (a slot placed since, a table edit), so only an open entry is re-derived.
    const routeIssue = request.status !== "open" ? undefined
      : facts ? rederive(facts, { kind: request.kind, target: request.target, assignee: request.assignee, ...(request.route ? { route: request.route } : {}) }) : "no routing table to re-derive the route";
    const owned = facts ? ownerClassOf(facts, request.target) : undefined;
    const resultIssue = request.status === "closed" && request.kind !== "slot" && typeof request.result === "string" ? resultRefusal(consumer, request.result) : undefined;
    return [{
      kind: request.kind, id: request.id, doc, issues: requestIssues(doc),
      ...(routeIssue ? { routeIssue } : {}), ...(owned ? { ownerClass: { step: `${owned.loop}/${owned.version}#${owned.step}`, queue: owned.queue } } : {}),
      ...(resultIssue ? { resultIssue } : {}),
    }];
  });
  const decisions = readDecisionEntries(consumer);
  const store = localStores(join(repo, "packages", agent));
  // The interview's gaps are the costly read: taken only when a Q2 cell asks for the needs.
  let needsFacts: { unrecorded: string[]; needs: number } | undefined;
  const needsOf = (): { unrecorded: string[]; needs: number } => needsFacts ??= (() => {
    try {
      const targets = new Set(listWorkEntries(consumer).flatMap(read => read.request ? [read.request.target] : []));
      const open = new Set(listWorkEntries(consumer).flatMap(read => read.request && read.request.status === "open" ? [read.request.target] : []));
      const gaps = gapsFor(repo, consumer).filter(gap => gap.kind === "request" && (gap.agent === agent || gap.from === agent || (gap.from ?? "").startsWith(`${agent}/`)));
      const slotless = slotlessNeeds(consumer).filter(need => need.from.startsWith(`${agent}/`) && !(need.target && targets.has(need.target)));
      return {
        needs: gaps.length + slotless.length,
        unrecorded: [
          ...gaps.filter(gap => !open.has(gap.item) && !(gap.need ?? []).some(need => open.has(need))).map(gap => `${gap.code} ${gap.item}: printed by the interview, no queue entry records it`),
          ...slotless.map(need => `${need.from} -> ${need.to}: a slotless need with no kind slot entry${need.target ? "" : " (no agent owns it)"}`),
        ],
      };
    } catch (error) {
      return { needs: 0, unrecorded: [`the interview did not run: ${error instanceof Error ? error.message : String(error)}`] };
    }
  })();
  const owned = facts ? facts.classes.filter(item => (item.when.ia ?? []).some(ia => ia === agent || ia.startsWith(`${agent}/`)) || (item.when.slots ?? []).some(slot => slot.startsWith(`${agent}/`))) : [];
  return {
    sourceFiles: store.files, localStores: store.rows, entries,
    legacyFixes: decisions.fixes.filter(fix => fix.subject.startsWith(`${agent}/`)),
    get unrecorded() { return needsOf().unrecorded; },
    get needs() { return needsOf().needs; },
    skills: Object.entries(handling ?? {}).map(([kind, handler]) => {
      const path = join(repo, handler.skill);
      const text = existsSync(path) ? readFileSync(path, "utf8") : undefined;
      return { kind, skill: handler.skill, loop: handler.loop, exists: text !== undefined, registered: hashed.has(handler.skill), hasRequests: text !== undefined && /^## Requests\b/m.test(text) };
    }),
    ownerClasses: owned.map(item => `${item.loop}/${item.version}#${item.step}`),
    ...(declared ? { issuing: declared.issuing.map(edge => ({ to: edge.to, kinds: [...edge.kinds] })) } : {}),
    declared: declared !== undefined,
  };
}

/** The entry's open/closed state, as a Q row reads it. */
export const statusOf = (fact: QueueFact): string => String((fact.doc as Partial<SlotRequest>).status);
