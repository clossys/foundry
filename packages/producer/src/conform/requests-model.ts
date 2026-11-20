/**
 * The request facts the Q rows judge (foundry-build-0048 U7): every clossys.queue-entry/2 about an agent with its
 * re-derived route and owner class, the queue-entry/1 fixes still raised, the run ledgers, the agent's declared request
 * handling skills, and the Producer machinery (routing table, owner classes, fix raisers, release gates). Read once
 * from disk; assertions.ts judges. An agent "is about" an entry when it raised it (`from`), holds it (`assignee`) or
 * owns its target slot.
 */
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative } from "node:path";
import { gapsOf } from "../pipeline/interview.js";
import { consumerFacts, ownerClassOf, ownerClasses, readDeclarations, rederive, routingIssues, type RoutingFacts } from "../queue/routing.js";
import { closeEventsOf, closerIssues, inputsSha256, listWorkEntries, requestIssues, resultRefusal, slotlessNeeds } from "../records/request.js";
import { readLegacyFixes, type LegacyFix } from "../queue/legacy-fix.js";
import { gateRunners, openFixes, RELEASE_GATES, REQUESTS_OPEN_FIX } from "../release/gates.js";
import { releaseResolutions } from "../release/pins.js";
import { sha256Hex } from "../records/hash.js";
import { writeTargetPin } from "../records/pin-map.js";
import { cliActor } from "../records/pin.js";
import { seatRefusal } from "../records/seat-owner.js";
import { jsonBytes, slotPositions, type IaDoc, type SlotAgent } from "../records/slot-model/index.js";
import { positionIa, writeSlot } from "../records/slot.js";
import { slotReadIssues } from "../records/slot-current.js";
import { slotFromV1, targetKind, type SlotV1 } from "../migrate/slot-1-to-2.js";
import { appendRetireCandidate, appendRetireSlot, PRODUCER_INTERNAL_WRITERS, writeCandidate, writeConfirm, writeNotNeeded, writePin } from "../records/slot-write.js";
import { fixCheck, requesterCheck } from "../queue/requester-check.js";
import type { Slot, SlotRequest } from "../records/types.js";

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
  /**
   * A closed change or fix, re-checked now (Q7): why its requester check (and, closed fixed, its own fix check) fails
   * on the tree today. A verified event is recorded evidence; this re-runs what it claims, so a forged one is red.
   */
  readonly recheck?: readonly string[];
  /** A closed change or fix whose judged inputs changed since its close: why Q7 skipped the re-run (INPUTS_DRIFTED). */
  readonly recheckNote?: string;
  /** An entry that does not read: its file, relative to the folder holding clossys/ (as the release gate names it). */
  readonly file?: string;
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
  /**
   * clossys.queue-entry/1 queue.fix entries about the agent's slots (breakage raised as a decision entry), and every
   * one that does not read (for all four agents). `status` is open for any entry that is not closed.
   */
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
  /** Q9's verb half: why a pin-writing verb or writer would let a seat act on a slot it may not (driven on a probe consumer; read on first use). */
  readonly seatGuardIssues: readonly string[];
  /**
   * Q11: whether release's runGates wires requests.open-fix, the slots a release reads (the one resolver, slot level)
   * and the slots the gate refuses on this consumer now; read on first use.
   */
  readonly openFix: {
    readonly wired: boolean; readonly closure: ReadonlySet<string>; readonly refused: ReadonlySet<string>;
    /** The queue.fix files the gate refuses as not reading (`might be an open fix`), relative to the folder holding clossys/. */
    readonly unread: ReadonlySet<string>;
    readonly error?: string;
  };
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

/**
 * queue-entry/1 fixes and the /2 entries open /1 entries cite. The fixes come from the one strict reader
 * (queue/legacy-fix.ts, foundry-build-0048 U7 r3), the same the release gate reads: hidden files and entries that do
 * not read are kept, with their issues.
 */
function readDecisionEntries(consumer: string): { fixes: LegacyFix[]; reasked: Set<string> } {
  const producer = join(consumer, "agents", "producer");
  const fixes = readLegacyFixes(dirname(consumer));
  const reasked = new Set<string>();
  for (const queue of ["queue.pick", "queue.approve", "queue.clarify", "queue.fix"]) {
    const dir = join(producer, queue, "entries");
    if (!isDir(dir)) continue;
    for (const name of readdirSync(dir).filter(file => file.endsWith(".json")).sort()) {
      const doc = json(join(dir, name));
      if (!object(doc) || doc.schema === "clossys.queue-entry/2") continue;
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
const rechecks = new Map<string, Recheck>();
export const resetRequestFacts = (): void => { cache.clear(); rechecks.clear(); };
/** Q7's re-read of a closed change or fix: why it fails now (red), and a note when the recheck was skipped. */
export interface Recheck { readonly failures: readonly string[]; readonly note?: string }
/** The note when a close's judged inputs changed since: drift after the close is slots.stale's, never Q7 red by itself. */
export const INPUTS_DRIFTED = "inputs drifted; slots.stale owns it";
/**
 * Q7's re-read of a closed change or fix (foundry-build-0048 U7 r3), read once per conform read:
 * - the closure rule (records/request.ts closerIssues, the predicate closeWork enforces, never a copy): a fix closed
 *   declined, or by anyone but its agent assignee, without the owner's answered option right before it, is red;
 * - the judged inputs' digest (inputsSha256) recomputed from today's bytes: equal, the requester check and (closed
 *   fixed) the fix's own check re-run, and a failure is red (a forged close over unchanged inputs); different, the
 *   re-run is skipped with INPUTS_DRIFTED, so an honest close that drifted later is never red here;
 * - a decline (U7 r5) served nothing and re-ran no requester check: only its closure rule is re-read.
 */
function recheckOf(consumer: string, request: SlotRequest): Recheck {
  const key = `${consumer}\0${request.kind}\0${request.id}`;
  let out = rechecks.get(key);
  if (out === undefined) {
    const root = dirname(consumer);
    const rule = closureRows(consumer, request as unknown as Record<string, unknown>);
    try {
      const at = request.closed !== undefined ? request.events.findIndex(event => event.id === request.closed) : -1;
      const stored = at > 0 ? request.events[at - 1]?.inputsSha256 : undefined;
      // A decline served nothing and re-ran no requester check (U7 r5): only its closure rule is re-read.
      if (request.outcome === "declined") out = { failures: rule };
      else if (stored !== undefined && stored !== inputsSha256(consumer, request)) out = { failures: rule, note: INPUTS_DRIFTED };
      else {
        const check = requesterCheck(root, request);
        const fix = request.kind === "fix" && request.outcome === "fixed" ? fixCheck(root, request) : undefined;
        out = { failures: [
          ...rule,
          ...check.failures.map(failure => `the requester check fails now: ${failure}`),
          ...(fix && !fix.ran ? [`its check ${String(request.check)} is not one Producer re-runs, so it never closed fixed`] : []),
          ...(fix?.failures ?? []).map(failure => `its check ${String(request.check)} fails now: ${failure}`),
        ] };
      }
    } catch (error) {
      out = { failures: [...rule, `the requester check does not run: ${error instanceof Error ? error.message : String(error)}`] };
    }
    rechecks.set(key, out);
  }
  return out;
}
/**
 * Q7's closure-rule rows on a closed change or fix entry, read or not (foundry-build-0048 U7 r3): records/request.ts
 * closerIssues, the predicate closeWork enforces, never a copy. A fix closed declined, or by anyone but its agent
 * assignee, without the owner's answered option right before it is red, also when the entry does not read otherwise.
 */
function closureRows(consumer: string, doc: Record<string, unknown>): string[] {
  if (doc.status !== "closed" || (doc.kind !== "change" && doc.kind !== "fix")) return [];
  const events = Array.isArray(doc.events) ? doc.events.filter(object) : [];
  const closer = events.find(event => event.id === doc.closed)?.by;
  const by = typeof closer === "string" ? closer : undefined;
  const request = {
    id: String(doc.id), kind: doc.kind, assignee: String(doc.assignee), closed: typeof doc.closed === "string" ? doc.closed : undefined,
    options: Array.isArray(doc.options) ? doc.options.filter(object) : undefined, events,
  } as unknown as Pick<SlotRequest, "id" | "kind" | "assignee" | "events" | "options" | "closed">;
  return closerIssues(request, by, typeof doc.outcome === "string" ? doc.outcome : undefined, closeEventsOf(request)).map(issue => `its close by ${by ?? "nobody"} breaks the closure rule: ${issue}`);
}
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

/** A refusal that is the seat rule's (records/seat-owner.ts, the pin CLI's agent and owner rules), not a fixture's. */
const SEAT_REFUSAL = /acts only on its own slots|is not a registered seat|is not agent:<agent>|a confirmation is the owner's|--confirm is the owner's|an agent seat picks with clossys pick/;
const PROBE_ID = "components.button";
const PROBE_TARGET = "sections.hero";
const PROBE_AT = "2026-11-17T12:00:00.000Z";

/** Every file under `dir` with its bytes: a refused verb leaves it byte-identical. */
function filesOf(dir: string, rel = "", out = new Map<string, string>()): Map<string, string> {
  if (!isDir(dir)) return out;
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name), at = rel ? `${rel}/${name}` : name;
    if (isDir(path)) filesOf(path, at, out); else out.set(at, readFileSync(path, "utf8"));
  }
  return out;
}
const changedFiles = (before: ReadonlyMap<string, string>, after: ReadonlyMap<string, string>): string[] =>
  [...new Set([...before.keys(), ...after.keys()])].filter(file => before.get(file) !== after.get(file)).sort();

/**
 * One probe slot as a valid clossys.slot/2 file (foundry-build-0048 M1b): the slot/1 shape the verbs judge, mapped by
 * the one slot/1-to-2 mapping (migrate/slot-1-to-2.ts slotFromV1, what `clossys ia` writes on a recut store), written
 * through writeSlot (schemas/slot.json) and read back by the slot reader (slotReadIssues). A probe slot that does not
 * read throws, so no probe row is judged on a slot a verb would refuse by format before its seat guard runs.
 */
function writeProbeSlot(dir: string, ia: IaDoc, doc: SlotV1, status: Slot["status"]): void {
  const kind = targetKind(doc);
  if (kind === undefined) throw new Error(`probe slot ${doc.agent}/${doc.id} has no clossys.slot/2 kind`);
  const position = slotPositions(doc.agent as SlotAgent, ia).get(doc.id);
  if (!position) throw new Error(`probe slot ${doc.agent}/${doc.id} is not placed in the probe ia.json`);
  const file = join(dir, "clossys/agents", doc.agent, doc.id, "slot.json");
  writeSlot(file, slotFromV1(doc, { kind, status, ia: positionIa(doc.id, position), inputs: [], uses: [], createdBy: cliActor("clossys conform"), at: PROBE_AT }));
  const issues = slotReadIssues(JSON.parse(readFileSync(file, "utf8")), file);
  if (issues.length) throw new Error(`probe slot ${doc.agent}/${doc.id} does not read as clossys.slot/2: ${issues.map(issue => issue.message).join("; ")}`);
}

/**
 * The probe consumer: a Designer element/component slot (a planner pin on its one candidate, the component standard)
 * and a Designer element/section target slot, both valid clossys.slot/2 files placed in the probe ia.json. Every
 * pin-writing verb is driven against it with a seat that may not act.
 */
function probeWorld(repo: string, dir: string): string {
  const write = (rel: string, text: string): void => { mkdirSync(dirname(join(dir, rel)), { recursive: true }); writeFileSync(join(dir, rel), text); };
  write("clossys/clossys.config.ts", "export default {};\n");
  write("package-lock.json", jsonBytes({ name: "probe", lockfileVersion: 3, packages: { "": { name: "probe" } } }));
  const ia: IaDoc = { schema: "clossys.ia/1", source: "synthetic#seat-probe", extensions: [], nodes: [
    { id: "components", label: "Components", children: [{ id: "group", label: "Group", slots: [PROBE_ID] }] },
    { id: "sections", label: "Sections", children: [{ id: "story", label: "Story", slots: [PROBE_TARGET] }] },
  ] };
  write("clossys/agents/designer/ia.json", jsonBytes(ia));
  const slot = `clossys/agents/designer/${PROBE_ID}`;
  writeProbeSlot(dir, ia, { schema: "clossys.slot/1", id: PROBE_ID, agent: "designer", kind: "element", standard: "component", contract: { variant: "solid" } }, "live");
  const candidate = jsonBytes({ name: "button", type: "registry:ui", dependencies: [], registryDependencies: [], files: [], meta: { source: { kind: "registry", ref: ["shadcn-aria/button@4.23.0"] } } });
  write(`${slot}/candidates/button-v1.json`, candidate);
  // An unpinned second candidate: the retire probes have something a guardless retire would move.
  write(`${slot}/candidates/button-v2.json`, jsonBytes({ name: "button", type: "registry:ui", dependencies: [], registryDependencies: [], files: [], meta: { source: { kind: "registry", ref: ["shadcn-aria/button@4.23.0"] }, note: "seat probe" } }));
  write(`${slot}/pin.json`, jsonBytes({ candidate: "button-v1.json", sha256: sha256Hex(candidate), decidedBy: "planner:seat-probe", basis: "planner", at: PROBE_AT }));
  cpSync(join(repo, "packages/designer/standards/component"), join(dir, "packages/designer/standards/component"), { recursive: true });
  writeProbeSlot(dir, ia, { schema: "clossys.slot/1", id: PROBE_TARGET, agent: "designer", kind: "element", standard: "section.site", contract: { kind: "section" } }, "starter");
  write("pick.json", JSON.stringify({ schema: "clossys.verdict/1", slot: PROBE_ID, pick: "button-v1.json", reason: "seat probe", criteria: ["fidelity", "polish"] }));
  write("create.json", JSON.stringify({ schema: "clossys.verdict/1", slot: PROBE_ID, create: true, reason: "seat probe", gaps: [{ id: "fidelity", class: "missing-behavior" }, { id: "brief:variant", class: "a11y-failure" }] }));
  return join(dir, "clossys");
}

/** The verbs that write or repin pin.json, each driven through the CLI with a seat that may not act on the slot. */
const VERB_PROBES: readonly { readonly verb: string; readonly args: readonly string[] }[] = [
  ...["agent:writer", "agent:writer-x", "agent:judge"].map(by => ({ verb: `pick --by ${by}`, args: ["pick", `designer/${PROBE_ID}`, "button-v1.json", "--by", by, "--at", PROBE_AT] })),
  { verb: "verdict pick --by agent:writer.verdict", args: ["verdict", `designer/${PROBE_ID}`, "--record", "pick.json", "--model", "seat-probe", "--tier", "high", "--by", "agent:writer.verdict", "--at", PROBE_AT] },
  { verb: "verdict create --by agent:writer.verdict", args: ["verdict", `designer/${PROBE_ID}`, "--record", "create.json", "--model", "seat-probe", "--tier", "high", "--by", "agent:writer.verdict", "--at", PROBE_AT] },
  { verb: "verdict pick --by agent:judge", args: ["verdict", `designer/${PROBE_ID}`, "--record", "pick.json", "--model", "seat-probe", "--tier", "high", "--by", "agent:judge", "--at", PROBE_AT] },
  { verb: "reissue --by agent:writer.reissue", args: ["reissue", `designer/${PROBE_ID}`, "button-v1", "--by", "agent:writer.reissue", "--at", PROBE_AT] },
  { verb: "pin --not-needed --by agent:writer", args: ["pin", `designer/${PROBE_ID}`, "--not-needed", "--reason", "seat probe", "--by", "agent:writer", "--at", PROBE_AT] },
  { verb: "pin --by agent:writer --basis picked", args: ["pin", `designer/${PROBE_ID}`, "button-v1.json", "--by", "agent:writer", "--basis", "picked", "--at", PROBE_AT] },
  { verb: "pin --confirm --by agent:designer", args: ["pin", `designer/${PROBE_ID}`, "button-v1.json", "--confirm", "--ref", "seat-probe", "--by", "agent:designer", "--at", PROBE_AT] },
  { verb: "pin (clossys.slot/2) --by agent:writer", args: ["pin", `designer/${PROBE_TARGET}`, "hero-v1.json", "--by", "agent:writer", "--at", PROBE_AT] },
  { verb: "pin (clossys.slot/2) --by agent:judge", args: ["pin", `designer/${PROBE_TARGET}`, "hero-v1.json", "--by", "agent:judge", "--at", PROBE_AT] },
  // retire (foundry-build-0048 U7 r3): the total actor guard refuses a foreign seat, no seat, bare owner and the planner.
  // Run last: a guardless retire --slot would take the probe slot away from the probes after it.
  ...["agent:writer", "agent:judge", "owner", "planner"].map(by => ({ verb: `retire <candidate> --by ${by}`, args: ["retire", `designer/${PROBE_ID}`, "button-v2.json", "--by", by, "--reason", "superseded: seat probe", "--at", PROBE_AT] })),
  ...["agent:writer", "owner"].map(by => ({ verb: `retire --slot --by ${by}`, args: ["retire", `designer/${PROBE_ID}`, "--slot", "--by", by, "--reason", "not-needed: seat probe", "--at", PROBE_AT] })),
];

/**
 * The child that drives the verbs: argv is the built CLI entry, the probe folder and the probes' argv (JSON). It loads
 * the entry's runCli (cli/main.js beside it), runs each probe from the probe folder and prints one JSON line: per
 * probe its exit code, message (a thrown usage error is exit 2) and the files under clossys/ it changed.
 */
const VERB_RUNNER = `
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
const [cli, dir, probes] = process.argv.slice(1);
const { runCli } = await import(pathToFileURL(join(dirname(cli), "main.js")).href);
const files = (base, rel = "", out = new Map()) => {
  for (const name of readdirSync(base).sort()) {
    const path = join(base, name), at = rel ? rel + "/" + name : name;
    if (statSync(path).isDirectory()) files(path, at, out); else out.set(at, readFileSync(path, "utf8"));
  }
  return out;
};
const results = [];
for (const args of JSON.parse(probes)) {
  const before = files(join(dir, "clossys"));
  let result;
  try { result = await runCli(args, dir); } catch (error) { result = { exitCode: 2, message: error instanceof Error ? error.message : String(error) }; }
  const after = files(join(dir, "clossys"));
  const changed = [...new Set([...before.keys(), ...after.keys()])].filter(file => before.get(file) !== after.get(file)).sort();
  results.push({ exitCode: result.exitCode, message: String(result.message ?? ""), changed });
}
console.log(JSON.stringify(results));
`;

/** Every non-test .ts file under `dir`, as a path relative to it. */
function sourceFiles(dir: string, rel = "", out: string[] = []): string[] {
  if (!isDir(dir)) return out;
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name), at = rel ? `${rel}/${name}` : name;
    if (isDir(path)) { if (name !== "node_modules" && name !== "__fixtures__") sourceFiles(path, at, out); }
    else if (name.endsWith(".ts") && !name.endsWith(".d.ts") && !/\.test\.ts$/.test(name)) out.push(at);
  }
  return out;
}

/**
 * Q9's reachability half (foundry-build-0048 U7 r3): a Producer-internal writer (records/slot-write.ts
 * PRODUCER_INTERNAL_WRITERS, no actor guard) is called only from its listed files, so no other verb can hand it a
 * caller's `--by` unjudged. `src` is packages/producer/src.
 */
export function internalWriterIssues(src: string): string[] {
  const out: string[] = [];
  const files = sourceFiles(src).filter(file => file !== "records/slot-write.ts");
  if (!PRODUCER_INTERNAL_WRITERS.length) out.push("records/slot-write.ts lists no Producer-internal writers");
  for (const { writer, callers } of PRODUCER_INTERNAL_WRITERS) {
    const call = new RegExp(`\\b${writer}\\s*\\(`);
    for (const file of files) if (!callers.includes(file) && call.test(readFileSync(join(src, file), "utf8"))) out.push(`${file} calls the Producer-internal writer ${writer} (no actor guard); judge the actor first or list it in PRODUCER_INTERNAL_WRITERS`);
  }
  return out;
}

/**
 * Q9's verb half, judged by behaviour: on a probe consumer, every verb that writes or repins pin.json (pick, verdict,
 * reissue, pin, --not-needed, --confirm, the clossys.slot/2 pin) is run with a seat that may not act on the slot (another
 * agent's, or no registered seat) and must refuse by the seat rule with every file byte-identical. The writers that
 * hold the guard (records/slot-write.ts, records/pin-map.ts) are called directly too, so a verb that reaches them
 * cannot skip it. The seat rule itself is probed for the slot's own seats. `cli` is the built clossys entry.
 */
export function seatGuardIssues(repo: string, cli: string = join(repo, "packages/producer/dist/cli/index.js")): string[] {
  const out: string[] = [];
  const probes: [string, string, boolean][] = [
    ["agent:writer", "designer", true], ["agent:director.candidates", "designer", true], ["agent:judge", "writer", true], ["agent:writer-x", "writer", true],
    // Only registered seats act: an unknown head is refused even on a slot folder of its own name.
    ["agent:judge", "judge", true], ["agent:writer-x", "writer-x", true],
    ["agent:designer", "designer", false], ["agent:designer.verdict", "designer", false], ["agent:producer.verdict", "producer", false],
  ];
  for (const [by, agent, refused] of probes) if ((seatRefusal(by, agent) !== undefined) !== refused) out.push(`the seat rule ${refused ? "lets" : "refuses"} --by ${by} on a ${agent} slot`);
  out.push(...internalWriterIssues(join(repo, "packages/producer/src")));
  if (!existsSync(cli)) return [...out, `no built clossys CLI at ${relative(repo, cli)} to drive the pin-writing verbs with`];
  if (!isDir(join(repo, "packages/designer/standards/component"))) return [...out, "no packages/designer/standards/component for the probe slot"];
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "clossys-seat-probe-")));
  try {
    const consumer = probeWorld(repo, dir);
    // One child process runs every verb through the built CLI's runCli (what bin clossys calls), in order, and
    // reports each one's exit, message and the files it changed.
    const run = spawnSync(process.execPath, ["--input-type=module", "-e", VERB_RUNNER, cli, dir, JSON.stringify(VERB_PROBES.map(probe => probe.args))], { cwd: dir, encoding: "utf8", timeout: 120_000 });
    let results: { exitCode: number; message: string; changed: string[] }[] = [];
    try { results = JSON.parse(run.stdout.trim().split("\n").at(-1) ?? ""); } catch { out.push(`the verb probe did not report (exit ${String(run.status)}: ${(run.stderr ?? "").trim().split("\n")[0]})`); }
    VERB_PROBES.forEach((probe, index) => {
      const result = results[index];
      if (!result) { if (results.length) out.push(`clossys ${probe.verb}: no result from the verb probe`); return; }
      const said = result.message.trim();
      if (result.exitCode === 0) out.push(`clossys ${probe.verb} on designer/<slot> exits 0: a seat acted on a slot it may not (${said.split("\n")[0]})`);
      else if (!SEAT_REFUSAL.test(said)) out.push(`clossys ${probe.verb} on designer/<slot> is refused, but not by the seat rule (${said.split("\n")[0] || `exit ${result.exitCode}`})`);
      if (result.changed.length) out.push(`clossys ${probe.verb} on designer/<slot> wrote ${result.changed.join(", ")}`);
    });
    // The writers themselves: a verb that calls them cannot skip the guard.
    const writers: [string, () => unknown][] = [
      ["writePin basis agent --by agent:writer", () => writePin(consumer, "designer", PROBE_ID, "button-v1.json", { decidedBy: "agent:writer", basis: "agent", at: PROBE_AT })],
      ["writeConfirm --by agent:designer", () => writeConfirm(consumer, "designer", PROBE_ID, "button-v1.json", { by: "agent:designer", ref: "seat-probe", at: PROBE_AT })],
      ["writeNotNeeded --by agent:judge", () => writeNotNeeded(consumer, "designer", PROBE_ID, { reason: "seat probe", since: PROBE_AT.slice(0, 10), decidedBy: "agent:judge" })],
      ["writeTargetPin --by agent:writer", () => writeTargetPin(dir, { agent: "designer", slotId: PROBE_TARGET, candidate: "hero-v1.json", decidedBy: "agent:writer", basis: "agent", at: PROBE_AT, createdBy: cliActor("clossys conform") })],
      ["appendRetireCandidate --by agent:writer", () => appendRetireCandidate(consumer, "designer", PROBE_ID, { name: "button-v2.json", sha256: "0".repeat(64), reason: "superseded: seat probe", by: "agent:writer", at: PROBE_AT })],
      ["appendRetireCandidate --by owner", () => appendRetireCandidate(consumer, "designer", PROBE_ID, { name: "button-v2.json", sha256: "0".repeat(64), reason: "superseded: seat probe", by: "owner", at: PROBE_AT })],
      ["appendRetireSlot --by planner", () => appendRetireSlot(consumer, "designer", PROBE_ID, { reason: "not-needed: seat probe", by: "planner", at: PROBE_AT })],
      ["writeCandidate --by agent:judge", () => writeCandidate(consumer, "designer", PROBE_ID, "button", { name: "button" }, { provenance: { by: "agent:judge" }, at: PROBE_AT })],
    ];
    for (const [what, call] of writers) {
      const before = filesOf(consumer);
      let refusal: string | undefined;
      try { call(); } catch (error) { refusal = error instanceof Error ? error.message : String(error); }
      const changed = changedFiles(before, filesOf(consumer));
      if (refusal === undefined) out.push(`${what} writes: the writer holds no seat guard`);
      else if (!SEAT_REFUSAL.test(refusal)) out.push(`${what} is refused, but not by the seat guard (${refusal.split("\n")[0]})`);
      if (changed.length) out.push(`${what} wrote ${changed.join(", ")}`);
    }
  } catch (error) {
    out.push(`the seat probe does not run: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  return out;
}

/** The release side of Q11 on one consumer (`root` holds clossys/): the gate as runGates calls it, never a copy. */
export function openFixFacts(root: string): RequestMachinery["openFix"] {
  try {
    const wired = Object.keys(gateRunners(root, "-", undefined)).includes(REQUESTS_OPEN_FIX);
    const closure = new Set(releaseResolutions(root).map(resolution => `${resolution.agent}/${resolution.slotId}`));
    const findings = openFixes(root);
    const refused = new Set(findings.map(finding => finding.subject));
    const unread = new Set(findings.filter(finding => finding.subject === "producer/queue.fix").map(finding => finding.detail.split(" ")[0]!));
    return { wired, closure, refused, unread };
  } catch (error) {
    return { wired: false, closure: new Set(), refused: new Set(), unread: new Set(), error: error instanceof Error ? error.message : String(error) };
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
  let seatGuard: string[] | undefined;
  return {
    routingIssues: issues, ownerPacketRow: rows.some(row => row.to === "owner-packet"),
    ownerClassCount: facts ? facts.classes.length : (() => { try { return ownerClasses(join(producer, "loops")).length; } catch { return 0; } })(),
    fixRaisers, printedGaps: printedGapCodes(interview), gapCodes: gapCodesOf(interview).length, releaseGates: [...RELEASE_GATES], runs: readRuns(consumer), reasked: decisions.reasked,
    get seatGuardIssues() { return seatGuard ??= seatGuardIssues(repo); },
    get openFix() { return openFix ??= openFixFacts(dirname(consumer)); },
  };
}

const CONTENT_AGENTS = ["director", "designer", "writer", "publisher"] as const;
const about = (agent: string, doc: Record<string, unknown>): boolean =>
  (typeof doc.from === "string" && doc.from.startsWith(`${agent}/`)) || doc.assignee === agent || (typeof doc.target === "string" && doc.target.startsWith(`${agent}/`));

export function readAgentRequests(repo: string, consumer: string, agent: string, hashed: ReadonlySet<string>): AgentRequestFacts {
  const declared = readDeclarations(agent, join(repo, "packages"))?.requests;
  const handling = declared?.handling;
  const facts = routingOf(repo, consumer).facts;
  const entries: QueueFact[] = listWorkEntries(consumer).flatMap((read): QueueFact[] => {
    if (!read.request) {
      // An entry that does not read is a finding, never dropped: kept with its issues for every content agent it names,
      // and for all four when it names none (a producer or owner field, a target no agent owns, a field that is not a
      // string), so Q1 (and Q7, when it says it is closed) report it. Producer has no conform row of its own.
      const doc = object(read.doc) ? read.doc : {};
      if (CONTENT_AGENTS.some(named => about(named, doc)) && !about(agent, doc)) return [];
      const kind = typeof doc.kind === "string" ? doc.kind : basename(dirname(dirname(read.file))).replace(/^queue\./, "");
      const id = typeof doc.id === "string" ? doc.id : basename(read.file).replace(/\.json$/, "");
      const rule = closureRows(consumer, doc);
      return [{ kind, id, doc, issues: read.issues.length ? read.issues : ["does not read as a clossys.queue-entry/2 work entry"], file: relative(dirname(consumer), read.file), ...(rule.length ? { recheck: rule } : {}) }];
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
      kind: request.kind, id: request.id, doc, issues: requestIssues(doc, dirname(consumer)),
      ...(routeIssue ? { routeIssue } : {}), ...(owned ? { ownerClass: { step: `${owned.loop}/${owned.version}#${owned.step}`, queue: owned.queue } } : {}),
      ...(resultIssue ? { resultIssue } : {}),
      ...(request.status === "closed" && request.kind !== "slot" ? (({ failures, note }) => ({ recheck: failures, ...(note ? { recheckNote: note } : {}) }))(recheckOf(consumer, request)) : {}),
    }];
  });
  const decisions = readDecisionEntries(consumer);
  // The /1 fixes this agent answers for (foundry-build-0048 U7 r3): its own by subject, and every one that does not read
  // (no subject, issues, a hidden file) or names no content agent's slot, for all four, as an invalid /2 entry naming no
  // agent is. One filter feeds both Q1's facts and Q10's legacy list.
  const judged = decisions.fixes.map(fix => fix.issues.length || fix.subject === undefined || CONTENT_AGENTS.some(named => fix.subject!.startsWith(`${named}/`))
    ? { fix, foreign: false } : { fix: { ...fix, issues: [`subject ${fix.subject} is no content agent's slot: no agent answers for it`] }, foreign: true });
  const legacy = judged.filter(({ fix }) => fix.issues.length > 0 || fix.subject?.startsWith(`${agent}/`));
  for (const { fix, foreign } of legacy) {
    if (!fix.issues.length) continue;
    // `file` marks a queue.fix file that does not read (Q11: the gate refuses it by name); a valid entry about a foreign
    // subject reads, so the gate judges it by its subject like any other.
    entries.push({ kind: "fix", id: fix.id ?? basename(fix.path).replace(/\.json$/, ""), doc: object(fix.doc) ? fix.doc : {}, issues: fix.issues, ...(foreign ? {} : { file: fix.path }) });
  }
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
    legacyFixes: legacy.map(({ fix }) => ({ id: fix.id ?? basename(fix.path).replace(/\.json$/, ""), subject: fix.subject ?? "producer/queue.fix", status: fix.closed ? fix.status ?? "open" : "open" })),
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
