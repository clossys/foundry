/**
 * Producer's router over the one queue (foundry-build-0048 U7). Every clossys.queue-entry/2 is routed by one function,
 * `routeEntry`, from one data table, `routing.json` (`clossys.routing/1`): ordered rows, first match wins, one
 * catch-all and it is last. A row names closed match and destination names; this module computes each from data and
 * guesses nothing:
 *
 * - match `live`: the target slot is placed (a consumer slot folder of a content agent);
 * - match `owner-class`: the target is in a class an owner step of a Producer loop version reserves, read from the
 *   step's `when` selector (`ownerClasses`); the classes are never copied into the table;
 * - match `home`: the target agent holds a placed slot with the need's first id segment (its L2 home);
 * - match `agent`: the target names a content agent; match `any`: always.
 * - to `handler`: the target agent's declared `requests.handling.<handling>` (conform.json); `owner-packet`: an MC
 *   packet to the owner on the matching owner step's queue, its options authored by the owning agent's declared skill;
 *   `scope`: the target agent's loop.scope skill; `decider`: a decision kind keeps its own assignee; `owner-clarify`:
 *   a queue.clarify to the owner (escalate `package` when the target is package code).
 *
 * The route records the row id and the table's sha256, so `rederive` re-runs the same function and compares.
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { whenMatches, type SlotSubject } from "../loop/slots.js";
import { PRODUCER_ROOT } from "../records/ledger.js";
import { listSlots } from "../records/slots.js";
import type { EntryRoute, LoopStep, SlotRequest } from "../records/types.js";

export const ROUTING_SCHEMA = "clossys.routing/1";
export const ENTRY_KINDS = ["pick", "approve", "clarify", "fix", "slot", "change"] as const;
export type EntryKind = (typeof ENTRY_KINDS)[number];
export const WORK_KINDS = ["slot", "change", "fix"] as const;
export type WorkKind = (typeof WORK_KINDS)[number];
const MATCHES = ["live", "owner-class", "home", "agent", "any"] as const;
/** The kinds an owner class reserves: a change or a new slot in the class is the owner's (a fix goes to its handler). */
const OWNER_KINDS = ["change", "slot"] as const;
const DESTINATIONS = ["handler", "owner-packet", "scope", "decider", "owner-clarify"] as const;
const ROUTED_AGENTS = ["director", "designer", "writer", "publisher"] as const;
export type RoutedAgent = (typeof ROUTED_AGENTS)[number];
const isRoutedAgent = (value: string): value is RoutedAgent => (ROUTED_AGENTS as readonly string[]).includes(value);

export interface RoutingRow {
  readonly id: string;
  readonly kinds: readonly EntryKind[] | "*";
  readonly match: (typeof MATCHES)[number];
  readonly to: (typeof DESTINATIONS)[number];
  readonly handling?: WorkKind;
}
export interface RoutingTable { readonly schema: typeof ROUTING_SCHEMA; readonly about?: string; readonly rows: readonly RoutingRow[] }

export const ROUTING_FILE = new URL("../../src/queue/routing.json", import.meta.url);
export const routingText = (): string => readFileSync(ROUTING_FILE, "utf8");
export const tableSha = (text: string): string => createHash("sha256").update(text).digest("hex");

/** Every issue of a routing table: rows of closed names only, unique ids, and exactly one catch-all, last. */
export function routingIssues(table: unknown): string[] {
  if (typeof table !== "object" || table === null) return ["routing.json is not an object"];
  const doc = table as Record<string, unknown>;
  const out: string[] = [];
  if (doc.schema !== ROUTING_SCHEMA) out.push(`routing.json schema must be ${ROUTING_SCHEMA}`);
  for (const key of Object.keys(doc)) if (!["schema", "about", "rows"].includes(key)) out.push(`routing.json has an unknown key ${key}`);
  if (!Array.isArray(doc.rows) || !doc.rows.length) return [...out, "routing.json rows must be a non-empty list"];
  const ids = new Set<string>();
  doc.rows.forEach((raw, index) => {
    const at = `rows[${index}]`;
    if (typeof raw !== "object" || raw === null) { out.push(`${at} is not an object`); return; }
    const row = raw as Record<string, unknown>;
    // A row holds closed names only: a `when`, `ia` or `slots` key (a copied owner class) or any other key is refused.
    for (const key of Object.keys(row)) if (!["id", "kinds", "match", "to", "handling"].includes(key)) out.push(`${at} has an unknown key ${key} (rows name closed matches; owner classes are read from the loop versions)`);
    if (typeof row.id !== "string" || !/^[a-z][a-z0-9.-]*$/.test(row.id)) out.push(`${at}.id must be a row id`);
    else if (ids.has(row.id)) out.push(`${at}.id ${row.id} is not unique`); else ids.add(row.id);
    if (row.kinds !== "*" && !(Array.isArray(row.kinds) && row.kinds.length && row.kinds.every(kind => (ENTRY_KINDS as readonly unknown[]).includes(kind)))) out.push(`${at}.kinds must be "*" or a non-empty list of ${ENTRY_KINDS.join(", ")}`);
    if (!(MATCHES as readonly unknown[]).includes(row.match)) out.push(`${at}.match must be one of ${MATCHES.join(", ")}`);
    if (!(DESTINATIONS as readonly unknown[]).includes(row.to)) out.push(`${at}.to must be one of ${DESTINATIONS.join(", ")}`);
    if ((row.to === "handler") !== (row.handling !== undefined)) out.push(`${at}: a handler row names handling (and only a handler row)`);
    if (row.handling !== undefined && !(WORK_KINDS as readonly unknown[]).includes(row.handling)) out.push(`${at}.handling must be one of ${WORK_KINDS.join(", ")}`);
  });
  const catchAll = (row: unknown) => typeof row === "object" && row !== null && (row as RoutingRow).kinds === "*" && (row as RoutingRow).match === "any";
  const catchAlls = doc.rows.map((row, index) => catchAll(row) ? index : -1).filter(index => index >= 0);
  if (catchAlls.length !== 1) out.push(`routing.json must hold exactly one catch-all row (kinds "*", match any), found ${catchAlls.length}: an unmatched entry would be dropped`);
  else if (catchAlls[0] !== doc.rows.length - 1) out.push(`the catch-all row must be last (it is rows[${catchAlls[0]}]): rows after it never match`);
  if (catchAlls.length === 1 && (doc.rows[catchAlls[0]!] as RoutingRow).to !== "owner-clarify") out.push("the catch-all routes to owner-clarify: nothing unmatched is guessed");
  // Owner-reserved rows win whatever the order: for change and slot, the first row that could take the entry (the
  // catch-all aside) is the owner-class -> owner-packet row, so no agent row sees an owner-reserved target first.
  for (const kind of OWNER_KINDS) {
    const covers = (row: unknown) => typeof row === "object" && row !== null && !catchAll(row) && ((row as RoutingRow).kinds === "*" || (Array.isArray((row as RoutingRow).kinds) && ((row as RoutingRow).kinds as readonly unknown[]).includes(kind)));
    const first = doc.rows.findIndex(covers);
    const row = first >= 0 ? doc.rows[first] as RoutingRow : undefined;
    if (!row || row.match !== "owner-class" || row.to !== "owner-packet") out.push(`the first row for kind ${kind} must be the owner class row (match owner-class, to owner-packet)${row ? `, not ${String(row.id)}` : ""}: an owner class would route to an agent`);
  }
  return out;
}

/** The table, refused when invalid (nothing routes by an invalid table). */
export function readRoutingTable(text: string = routingText()): { table: RoutingTable; sha: string } {
  let doc: unknown;
  try { doc = JSON.parse(text); } catch (error) { throw new RoutingError(`routing.json is not JSON: ${error instanceof Error ? error.message : String(error)}`); }
  const issues = routingIssues(doc);
  if (issues.length) throw new RoutingError(`routing.json is refused: ${issues.join("; ")}`);
  return { table: doc as RoutingTable, sha: tableSha(text) };
}

export class RoutingError extends Error {
  constructor(message: string) { super(message); this.name = "RoutingError"; }
}

// ------------------------------------------------------------------------------------------------ owner classes

/** One owner-reserved class: an owner step of a loop version and the `when` selector that scopes it. */
export interface OwnerClass { readonly loop: string; readonly version: string; readonly step: string; readonly queue: "queue.pick" | "queue.approve" | "queue.clarify"; readonly when: NonNullable<LoopStep["when"]> }

/**
 * The owner-reserved classes, read from Producer's loop versions (`loops/<loop>/<version>.json`): every step decided
 * by the human owner with a `when` selector. A selector by `ia` or `slots` scopes slots (Director, legal prose,
 * themes, assets, voice); one by `decision` scopes request decisions (a new leaf: tree shape).
 *
 * Fails closed: a missing loops folder, a loop version that does not parse, or no slot-scoped class at all refuses
 * (RoutingError) instead of returning fewer classes, since a class not read would route an owner-reserved slot to an
 * agent.
 */
export function ownerClasses(loopsDir: string = join(PRODUCER_ROOT, "loops")): OwnerClass[] {
  const out: OwnerClass[] = [];
  if (!existsSync(loopsDir)) throw new RoutingError(`no loop versions at ${loopsDir}: the owner classes cannot be read, so nothing routes`);
  for (const loop of readdirSync(loopsDir).filter(name => name.startsWith("loop.")).sort()) {
    const dir = join(loopsDir, loop);
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir).filter(name => name.endsWith(".json")).sort()) {
      let doc: { content?: { steps?: LoopStep[] } };
      try { doc = JSON.parse(readFileSync(join(dir, file), "utf8")) as typeof doc; } catch (error) {
        throw new RoutingError(`${loop}/${file} does not parse (${error instanceof Error ? error.message : String(error)}): its owner steps cannot be read, so nothing routes`);
      }
      for (const step of doc.content?.steps ?? []) {
        if (step.decider?.by !== "human" || step.when === undefined) continue;
        out.push({ loop, version: file.slice(0, -".json".length), step: step.id, queue: step.decider.raise, when: step.when });
      }
    }
  }
  if (!slotClasses(out).length) throw new RoutingError(`the loop versions at ${loopsDir} hold no owner step scoped by ia or slots: with no owner class every owner-reserved slot would route to an agent, so nothing routes`);
  return out;
}

/** The slot-scoped classes only (a `decision`-only selector applies when a request is decided, not when it is routed). */
export const slotClasses = (classes: readonly OwnerClass[]): OwnerClass[] => classes.filter(item => item.when.ia !== undefined || item.when.slots !== undefined);

// ------------------------------------------------------------------------------------------------ declarations

export interface Handler { readonly skill: string; readonly loop: string }
export interface RequestDeclarations { readonly issuing: readonly { readonly to: string; readonly kinds: readonly WorkKind[] }[]; readonly handling: Readonly<Record<WorkKind, Handler>> }
export interface AgentDeclarations { readonly requests?: RequestDeclarations; readonly skills?: Readonly<Record<string, string | null>> }

/** An agent package's conform.json (beside Producer's package), read for its request declarations. */
export function readDeclarations(agent: string, packagesDir: string = join(PRODUCER_ROOT, "..")): AgentDeclarations | undefined {
  try { return JSON.parse(readFileSync(join(packagesDir, agent, "conform.json"), "utf8")) as AgentDeclarations; } catch { return undefined; }
}

// ------------------------------------------------------------------------------------------------ the router

/** What the router reads besides the entry: the consumer's slots, the owner classes and the agents' declarations. */
export interface RoutingFacts {
  readonly table: RoutingTable;
  readonly sha: string;
  readonly classes: readonly OwnerClass[];
  readonly declarations: (agent: string) => AgentDeclarations | undefined;
  /** The placed slots of a content agent: id and IA position (l0, l1, l2). */
  readonly placed: (agent: string) => readonly { readonly id: string; readonly ia: { readonly l0: string; readonly l1: string; readonly l2: string } }[];
}

/** The facts of a consumer (`<root>/clossys`), with the table and loop versions this Producer ships. */
export function consumerFacts(consumer: string, options: { readonly text?: string; readonly loopsDir?: string; readonly packagesDir?: string } = {}): RoutingFacts {
  const { table, sha } = readRoutingTable(options.text);
  const cache = new Map<string, ReturnType<RoutingFacts["placed"]>>();
  return {
    table, sha, classes: ownerClasses(options.loopsDir),
    declarations: agent => readDeclarations(agent, options.packagesDir),
    placed: agent => {
      if (!isRoutedAgent(agent)) return [];
      if (!cache.has(agent)) cache.set(agent, placedSlots(consumer, agent));
      return cache.get(agent)!;
    },
  };
}

/**
 * The agent's placed slots: every IA position, then every slot folder holding a slot.json the IA does not list (its IA
 * read from the id's first segment). A slot record on disk is a slot whatever the IA says.
 */
export function placedSlots(consumer: string, agent: RoutedAgent): { id: string; ia: { l0: string; l1: string; l2: string } }[] {
  const out = listSlots(consumer, agent).map(entry => ({ id: entry.id, ia: { l0: entry.position.l0 ?? entry.position.l1.split("/")[0]!, l1: entry.position.l1, l2: entry.position.l2 } }));
  const dir = join(consumer, "agents", agent);
  if (!existsSync(dir)) return out;
  for (const id of readdirSync(dir).sort()) {
    if (out.some(slot => slot.id === id) || !existsSync(join(dir, id, "slot.json"))) continue;
    out.push({ id, ia: { l0: id.split(".")[0]!, l1: "", l2: "" } });
  }
  return out;
}

type Routable = Pick<SlotRequest, "target" | "assignee"> & { readonly kind: EntryKind };

const split = (target: string): { agent: string; id: string } => {
  const cut = target.indexOf("/");
  return { agent: target.slice(0, cut), id: target.slice(cut + 1) };
};

/** The subject an owner-class selector reads: the placed slot's IA, else its L2 home's IA, else the id's first segment. */
function subjectOf(facts: RoutingFacts, target: string): SlotSubject | undefined {
  const { agent, id } = split(target);
  if (!isRoutedAgent(agent)) return undefined;
  const placed = facts.placed(agent);
  const own = placed.find(slot => slot.id === id) ?? homeOf(facts, target);
  const ia = own?.ia ?? { l0: id.split(".")[0]!, l1: "", l2: "" };
  return { agent, slotId: id, slot: { ia } } as unknown as SlotSubject;
}

/** The target agent's placed slot sharing the need's first id segment (the need's L2 home), if any. */
function homeOf(facts: RoutingFacts, target: string): ReturnType<RoutingFacts["placed"]>[number] | undefined {
  const { agent, id } = split(target);
  const head = id.split(".")[0]!;
  return facts.placed(agent).find(slot => slot.id.split(".")[0] === head);
}

/** The owner class an entry's target falls in, if any (first by loop and version order). */
export function ownerClassOf(facts: RoutingFacts, target: string): OwnerClass | undefined {
  const subject = subjectOf(facts, target);
  if (!subject) return undefined;
  return slotClasses(facts.classes).find(item => whenMatches({ ...(item.when.ia ? { ia: item.when.ia } : {}), ...(item.when.slots ? { slots: item.when.slots } : {}) }, subject));
}

function matches(facts: RoutingFacts, row: RoutingRow, entry: Routable): boolean {
  if (row.kinds !== "*" && !row.kinds.includes(entry.kind)) return false;
  const { agent, id } = split(entry.target);
  switch (row.match) {
    case "any": return true;
    case "agent": return isRoutedAgent(agent);
    case "live": return isRoutedAgent(agent) && facts.placed(agent).some(slot => slot.id === id);
    case "home": return isRoutedAgent(agent) && homeOf(facts, entry.target) !== undefined;
    case "owner-class": return ownerClassOf(facts, entry.target) !== undefined;
  }
}

/**
 * Routes one entry: the first row that matches and whose destination resolves from the declarations. A handler row
 * whose agent declares no handler for the kind does not match (the next row is tried), so the catch-all receives it.
 */
export function routeEntry(facts: RoutingFacts, entry: Routable): EntryRoute {
  const { agent } = split(entry.target);
  for (const row of facts.table.rows) {
    if (!matches(facts, row, entry)) continue;
    const base = { row: row.id, table: facts.sha };
    const declared = isRoutedAgent(agent) ? facts.declarations(agent) : undefined;
    if (row.to === "handler") {
      const handler = declared?.requests?.handling?.[row.handling!];
      if (!handler) continue;
      return { ...base, assignee: agent as RoutedAgent, handler: { skill: handler.skill, loop: handler.loop } };
    }
    if (row.to === "owner-packet") {
      const owned = ownerClassOf(facts, entry.target)!;
      const kind = entry.kind === "fix" || entry.kind === "change" || entry.kind === "slot" ? entry.kind : undefined;
      const skill = kind ? declared?.requests?.handling?.[kind]?.skill : undefined;
      return { ...base, assignee: "owner", packet: { queue: owned.queue, step: `${owned.loop}/${owned.version}#${owned.step}`, ...(skill ? { skill } : {}) } };
    }
    if (row.to === "scope") {
      const skill = declared?.skills?.scope;
      if (!skill) continue;
      return { ...base, assignee: agent as RoutedAgent, handler: { skill, loop: "loop.scope" } };
    }
    if (row.to === "decider") return { ...base, assignee: entry.assignee };
    return { ...base, assignee: "owner", packet: { queue: "queue.clarify" }, ...(agent === "producer" ? { escalate: "package" as const } : {}) };
  }
  // routingIssues guarantees a last catch-all, which always matches.
  throw new RoutingError(`no routing row matched ${entry.kind} ${entry.target}`);
}

/** The route an entry's recorded route should equal, re-derived now; undefined when they agree. */
export function rederive(facts: RoutingFacts, entry: Routable & { readonly route?: EntryRoute }): string | undefined {
  const now = routeEntry(facts, entry);
  const was = entry.route;
  if (!was) return "has no route (the router writes one when the entry is raised)";
  const key = (route: EntryRoute) => JSON.stringify([route.row, route.assignee, route.handler?.skill, route.handler?.loop, route.packet?.queue, route.packet?.step, route.escalate]);
  if (key(was) !== key(now)) return `route ${was.row} -> ${was.assignee} differs from the table now (${now.row} -> ${now.assignee})`;
  if (was.table !== now.table) return `was routed by another routing.json (${was.table.slice(0, 12)}), not ${now.table.slice(0, 12)}`;
  return undefined;
}
