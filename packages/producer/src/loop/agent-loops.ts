/**
 * Agent-owned loops (foundry-build-0048 U9a, owner 2026-11-17: "each agent is built to standard with their own loops,
 * and all agents are connected via loops overseen by the producer").
 *
 * Each content agent (Director, Designer, Writer, Publisher) holds five loop slots in its own tree, under one `loops`
 * L1: `<agent>/loop.<scope|slot|create|choose|cascade>`. Each is pinned to a candidate that extends Producer's standard
 * loop of the same name (`packages/producer/loops/loop.<name>/<name>-v1.json`). The agent ships its own package
 * candidates under `packages/<agent>/loops/loop.<name>/<name>-v1.json`; the consumer pins one through the pin gate.
 *
 * Producer owns the standard loops, the runner and the extension rules below; the agent owns its loop candidates.
 * An agent may change its own steps (their wording, skills, tiers, extra reads and writes in its own tree, and steps
 * of its own added beside the standard's). It may not drop or reorder the standard's required steps, their deciders,
 * exit checks, failure routes or owner-class `when` data, and it may not name another agent: cross-agent work runs
 * only through Producer's connection loops (`loop.connected`, check/loop-connected.ts).
 *
 * Pure tables and judges: the loader (version.ts), the certifier (constitution/certify/loop.ts), `loop.agent-standard`
 * and `loop.connected` read them.
 */
import { existsSync, readFileSync } from "node:fs";
import { join, posix } from "node:path";
import { resolveAgent } from "../agents.js";
import { readCandidateFile } from "../records/candidate.js";
import { resolveSlot } from "../records/resolve.js";
import type { AgentId, CandidateName, LoopStep, LoopVersion, Sha256 } from "../records/types.js";
import { loopReachableIssues } from "../check/loop-reachable.js";
import { readPackageLoop, type LoopFile } from "./files.js";
import { LOOP_TRIGGERS, OWNER_OF_SLOT, loopStem, type LoopName } from "./names.js";

import { AGENT_LOOPS, LOOP_AGENTS, isAgentLoop, isLoopAgent, type AgentLoopName, type LoopAgent } from "./agent-loops-ia.js";

export { AGENT_LOOPS, LOOP_AGENTS, isAgentLoop, isLoopAgent, type AgentLoopName, type LoopAgent };

/** The Producer loops that connect agents (request routing, cascade, release, audit); only these cross agent trees. */
export const CONNECTION_LOOPS = ["loop.scope", "loop.slot", "loop.choose", "loop.cascade", "loop.release", "loop.audit"] as const satisfies readonly LoopName[];

/** The slot kind and standard id of an agent loop slot (its IA place is agent-loops-ia.ts). */
export const LOOP_KIND = "loop";
export const LOOP_STANDARD = "loop";
/** The package folder an agent ships its loop candidates in (`packages/<agent>/loops/<slot-id>/`). */
export const AGENT_LOOPS_DIR = "loops";

/**
 * flows.md N3 handoffs: Director feeds Designer and Writer; Designer and Writer feed Publisher. Each edge must be a
 * read, in the downstream agent's own loops, of a path the upstream agent's loops write (its pins).
 */
export const CHAIN_HANDOFFS: readonly (readonly [LoopAgent, LoopAgent])[] = [
  ["director", "designer"], ["director", "writer"], ["designer", "publisher"], ["writer", "publisher"],
];

/** One read agent loop version: a loop file that names the agent owning it. */
export type AgentLoopFile = LoopFile & { readonly agent: LoopAgent };
export type AgentLoopRead = AgentLoopFile | { readonly ok: false; readonly reason: string };

/** The package file of an agent's own loop candidate, from the installed agent package. */
export function agentPackageLoopFile(agent: LoopAgent, loop: AgentLoopName): string {
  return join(resolveAgent(agent).packageRoot, AGENT_LOOPS_DIR, loop, `${loopStem(loop)}-v1.json`);
}

function readAgentLoopFile(file: string, agent: LoopAgent, loop: AgentLoopName, source: "pin" | "package"): AgentLoopRead {
  const ref = `${agent}/${loop}`;
  if (!existsSync(file)) return { ok: false, reason: `${ref}: ${file} does not exist` };
  const read = readCandidateFile(file, { agent, slotId: loop, packageDefault: source === "package" });
  if (read.issues.length) return { ok: false, reason: `${ref}: ${read.name}: ${read.issues.join("; ")}` };
  let content: unknown;
  try { content = (JSON.parse(readFileSync(file, "utf8")) as { content?: unknown }).content; } catch (error) {
    return { ok: false, reason: `${ref}: ${read.name} is not JSON: ${error instanceof Error ? error.message : String(error)}` };
  }
  return {
    ok: true, loop, agent, source, candidate: read.name as CandidateName, file, sha256: read.sha256 as Sha256, content,
    ref: `${ref}/${source === "package" ? "package:" : ""}${read.name}`,
  };
}

/** The agent's package candidate of one loop (what `clossys loop <agent>/<loop> --adopt` submits). */
export function readAgentPackageLoop(agent: LoopAgent, loop: AgentLoopName): AgentLoopRead {
  let file: string;
  try { file = agentPackageLoopFile(agent, loop); } catch (error) { return { ok: false, reason: `${agent}/${loop}: ${error instanceof Error ? error.message : String(error)}` }; }
  return readAgentLoopFile(file, agent, loop, "package");
}

/** True when the consumer holds the agent's loop slot (`clossys/agents/<agent>/loop.<name>/slot.json`). */
export const hasAgentLoopSlot = (root: string, agent: LoopAgent, loop: AgentLoopName): boolean =>
  existsSync(join(root, "clossys", "agents", agent, loop, "slot.json"));

/**
 * The consumer's pinned version of the agent's loop: undefined when the consumer holds no such slot (the Producer
 * standard runs), an error when the slot is there but unpinned or its pin does not resolve (never a silent fallback).
 * The pin's basis is the agent's or the planner's or the owner's: the agent owns its loop candidates.
 */
export function readAgentLoopPin(root: string, agent: LoopAgent, loop: AgentLoopName): AgentLoopRead | undefined {
  if (!hasAgentLoopSlot(root, agent, loop)) return undefined;
  const resolved = resolveSlot(root, agent, loop);
  if (resolved.state !== "pinned") {
    const why = resolved.pinIssue ?? (resolved.state === "unresolved" ? resolved.reason : "no pin (the package candidate is a sample, not a pin)");
    return { ok: false, reason: `${agent}/${loop} is not pinned: ${why}` };
  }
  return readAgentLoopFile(resolved.file, agent, loop, "pin");
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const sameList = (a: readonly string[] | undefined, b: readonly string[] | undefined) => JSON.stringify(a ?? []) === JSON.stringify(b ?? []);

/** A standard step names this agent: its decider is this agent or the per-slot owner placeholder. */
const namesAgent = (step: LoopStep, agent: LoopAgent): boolean => step.decider.by === "agent" && (step.decider.agent === agent || step.decider.agent === OWNER_OF_SLOT);
/** A standard step another agent decides: it belongs to that agent's own loop, not this one. */
const othersStep = (step: LoopStep, agent: LoopAgent): boolean => step.decider.by === "agent" && step.decider.agent !== agent && step.decider.agent !== OWNER_OF_SLOT;

/**
 * The standard's required steps for one agent: every code and owner step, and every step this agent decides (its own
 * named steps and the per-slot owner's). Steps another agent decides belong to that agent's loop.
 */
export function requiredSteps(standard: LoopVersion, agent: LoopAgent): LoopStep[] {
  return standard.steps.filter(step => !othersStep(step, agent));
}

/** Agent-tree prefixes a path may name (`<agent>/...`, `clossys/agents/<agent>/...`). */
const AGENT_PATH = /^(?:clossys\/agents\/)?(director|designer|writer|publisher|producer)\//;
/** The agent tree a read or write path names, if it names one by id (judged on the posix-normalized path). */
export const pathAgent = (path: string): string | undefined => AGENT_PATH.exec(posix.normalize(path))?.[1];
/** A path that leaves the tree it is written against: absolute, or through a `..` segment. */
export const escapesTree = (path: string): boolean => path.startsWith("/") || path.split(/[\\/]/).includes("..");

/** The cli of a Producer built-in code step: routing findings, the cascade, the strict tree checks, the IA sync. */
const BUILT_IN_CLI = /^clossys check --route\b|<dependants>|^clossys check --strict\b|^clossys ia sync\b/;
/** A cli that pins or answers an owner entry: only the standard's own step may carry it, as the standard has it. */
const PIN_CLI = /\bclossys (?:pin|pick|verdict|approve|answer)\b/;
/** A write that can land on a slot's pin.json (`<agent>/<slot>/pin.json`, a slot directory, or a glob over it). */
const writesPin = (path: string, agent: LoopAgent): boolean => {
  const pattern = pathPattern(path, agent);
  return pattern !== undefined && patternsMeet(pattern, ["*", "*", "pin.json"]);
};

/**
 * Why an agent's loop version is not a conforming extension of Producer's standard loop of the same name; empty when
 * it is. `content` is the agent version's `content`, `standard` the Producer package v1 content.
 */
export function loopExtensionIssues(agent: LoopAgent, loop: AgentLoopName, content: unknown, standard: LoopVersion): string[] {
  const ref = `${agent}/${loop}`;
  if (!isObject(content) || !Array.isArray(content.steps) || !Array.isArray(content.trigger)) return [`${ref}: the version content is not a loop version (trigger, steps)`];
  const version = content as unknown as LoopVersion;
  const issues: string[] = [];
  for (const trigger of standard.trigger) if (!version.trigger.includes(trigger)) issues.push(`${ref}: drops trigger ${trigger} of producer/${loop}`);
  for (const trigger of version.trigger) if (!LOOP_TRIGGERS[loop].includes(trigger)) issues.push(`${ref}: trigger ${trigger} does not start ${loop}`);
  if (typeof standard.maxRounds === "number" && typeof version.maxRounds === "number" && version.maxRounds > standard.maxRounds) {
    issues.push(`${ref}: maxRounds ${version.maxRounds} exceeds the standard's ${standard.maxRounds}`);
  }
  if (typeof version.maxRounds !== "number" || !Number.isInteger(version.maxRounds) || version.maxRounds < 1) issues.push(`${ref}: maxRounds must be a whole number of rounds (1 or more)`);
  if (version.exit !== standard.exit) issues.push(`${ref}: changes the standard's exit (${standard.exit})`);
  if (version.repeat !== standard.repeat) issues.push(`${ref}: changes the standard's repeat (${standard.repeat})`);
  const byId = new Map(version.steps.filter(isObject).map(step => [step.id, step] as const));
  const required = requiredSteps(standard, agent);
  let last = -1;
  for (const want of required) {
    const step = byId.get(want.id);
    if (!step) { issues.push(`${ref}: drops required step ${want.id} of producer/${loop}`); continue; }
    const at = version.steps.indexOf(step);
    if (at < last) issues.push(`${ref}: step ${want.id} runs before a required step the standard runs first (the standard's order is kept)`);
    last = Math.max(last, at);
    const got = step.decider, need = want.decider;
    if (got?.by !== need.by) { issues.push(`${ref}: step ${want.id} is decided by ${String(got?.by)}, the standard's by ${need.by}`); continue; }
    if (need.by === "human" && got.by === "human" && (got.who !== need.who || got.raise !== need.raise)) issues.push(`${ref}: step ${want.id} changes the owner's ${need.raise} to ${got.who} ${got.raise}`);
    if (need.by === "code" && step.cli !== want.cli) issues.push(`${ref}: step ${want.id} changes the code step's cli (${want.cli})`);
    if (need.by === "agent" && got.by === "agent") {
      if (got.agent !== agent && got.agent !== OWNER_OF_SLOT) issues.push(`${ref}: step ${want.id} is decided by ${got.agent}; an agent loop's own steps are the agent's`);
      if (got.verb !== need.verb) issues.push(`${ref}: step ${want.id} changes verb ${need.verb} to ${got.verb}`);
    }
    for (const check of want.checks) if (!(step.checks ?? []).includes(check)) issues.push(`${ref}: step ${want.id} drops exit check ${check}`);
    if (want.onFail && (step.onFail?.raise !== want.onFail.raise || step.onFail?.then !== want.onFail.then)) issues.push(`${ref}: step ${want.id} changes its failure route (${want.onFail.raise} then ${want.onFail.then})`);
    if (!want.onFail && step.onFail !== undefined) issues.push(`${ref}: step ${want.id} adds a failure route; the standard stops the run when it fails`);
    if (want.when === undefined && step.when !== undefined) issues.push(`${ref}: step ${want.id} adds a when; the standard runs it for every subject`);
    if (want.when !== undefined) {
      if (step.when === undefined) issues.push(`${ref}: step ${want.id} drops its when (${JSON.stringify(want.when)})`);
      else for (const [key, values] of Object.entries(want.when) as [keyof NonNullable<LoopStep["when"]>, string[]][]) {
        const got = (step.when[key] ?? []) as string[];
        for (const value of values) if (!got.includes(value)) issues.push(`${ref}: step ${want.id} drops when.${key} ${value}`);
      }
      if (step.when) for (const key of Object.keys(step.when)) if (!Object.hasOwn(want.when, key)) issues.push(`${ref}: step ${want.id} adds when.${key}, which narrows a standard step`);
    }
    if (need.by !== "agent" && !sameList(step.writes, want.writes)) issues.push(`${ref}: step ${want.id} changes what the ${need.by} step writes`);
    if (need.by !== "agent" && !sameList(step.reads, want.reads)) issues.push(`${ref}: step ${want.id} changes what the ${need.by} step reads`);
  }
  // A failing step hands on to a route step only where the standard has that route step right after it.
  for (let index = 0; index + 1 < version.steps.length; index++) {
    const step = version.steps[index]!, next = version.steps[index + 1]!;
    if (!isObject(step) || !isObject(next) || typeof next.cli !== "string" || !/^clossys check --route\b/.test(next.cli) || step.onFail !== undefined) continue;
    const at = standard.steps.findIndex(each => each.id === step.id);
    const after = at < 0 ? undefined : standard.steps[at + 1];
    if (after === undefined || after.id !== next.id || after.cli !== next.cli) issues.push(`${ref}: step ${String(next.id)} routes the findings of ${String(step.id)}, which the standard does not; a failed step would pass on`);
  }
  // Steps the agent adds: its own, deciding only in its own tree.
  const standardIds = new Set(standard.steps.map(step => step.id));
  for (const step of version.steps) {
    if (!isObject(step) || standardIds.has(step.id)) {
      if (isObject(step) && standard.steps.some(each => each.id === step.id && othersStep(each, agent))) issues.push(`${ref}: step ${step.id} is ${String((standard.steps.find(each => each.id === step.id)!.decider as { agent?: string }).agent)}'s step in producer/${loop}, not ${agent}'s`);
      continue;
    }
    if (step.decider?.by !== "agent" || step.decider.agent !== agent) issues.push(`${ref}: added step ${String(step.id)} is not decided by ${agent}; Producer's code and owner steps are the standard's`);
  }
  // No step names another agent as its decider, and no agent step writes another agent's tree.
  for (const step of version.steps) {
    if (!isObject(step)) continue;
    if (step.decider?.by === "agent" && step.decider.agent !== agent && step.decider.agent !== OWNER_OF_SLOT) issues.push(`${ref}: step ${step.id} names ${step.decider.agent}; an agent loop reaches another agent only through a request or a cascade`);
    if (step.decider?.by !== "agent") continue;
    // The standard's own step of this id, when it is this agent's: what it may carry as the standard has it.
    const own = standard.steps.find(each => each.id === step.id && namesAgent(each, agent));
    const cli = typeof step.cli === "string" ? step.cli : "";
    if (BUILT_IN_CLI.test(cli)) issues.push(`${ref}: step ${step.id} runs ${cli}, a Producer code step; an agent step never routes, cascades, syncs or judges the tree`);
    if (PIN_CLI.test(cli) && own?.cli !== cli) issues.push(`${ref}: step ${step.id} runs ${cli}; only the standard's own step pins or answers, as the standard has it (the owner's choose gate)`);
    for (const path of Array.isArray(step.writes) ? step.writes : []) {
      if (escapesTree(path)) { issues.push(`${ref}: step ${step.id} writes ${path}, outside the tree (absolute or through ..)`); continue; }
      const normal = posix.normalize(path);
      const pattern = pathPattern(normal, agent);
      if (pattern === undefined || !ownWriteRoot(pattern, agent)) issues.push(`${ref}: step ${step.id} writes ${path}, which can land outside ${agent}'s own tree, its .clossys/checks/${agent}/ folder and Producer's queue entries; raise a request instead`);
      if (writesPin(normal, agent) && !(own?.writes ?? []).includes(path)) issues.push(`${ref}: step ${step.id} writes ${path}, a slot pin; an agent loop pins only at the standard's own pick step (the owner's choose gate)`);
    }
  }
  return issues;
}

/** The Producer standard of one loop, read from this installed Producer package. */
export function standardOf(loop: AgentLoopName): { ok: true; standard: LoopVersion; file: LoopFile } | { ok: false; reason: string } {
  const read = readPackageLoop(loop);
  if (!read.ok) return read;
  return { ok: true, standard: read.content as LoopVersion, file: read };
}

// ---------------------------------------------------------------------------
// loop.connected: every agent loop is wired into the chain through Producer's loops.
// ---------------------------------------------------------------------------

/** Every agent's five loop versions (their `content`) and Producer's standard loops, as the connected check reads them. */
export interface LoopSet {
  readonly versions: ReadonlyMap<LoopAgent, ReadonlyMap<AgentLoopName, unknown>>;
  readonly standards: ReadonlyMap<LoopName, LoopVersion>;
  /** Versions that could not be read, by `<agent>/<loop>`: reported, never replaced by a fallback. */
  readonly unread?: ReadonlyMap<string, string>;
  /**
   * The agents a consumer runs (its IA places them or it holds their loop slots). A chain handoff is judged only between
   * two of them: a handoff into or out of an agent the consumer does not run is no chain it runs. Absent: every agent.
   */
  readonly runs?: ReadonlySet<LoopAgent>;
}

/**
 * A read or write path as segments, for the agent whose loop names it (`*` for a Producer standard step): the
 * `clossys/agents/` prefix dropped; `<slot>` becomes the agent's slots (the agent, then one wildcard); `<dependant>`
 * and `<requester>` any agent's slot (two wildcards); `<agent>` the agent; every other placeholder one wildcard. A
 * `*` segment is exactly one segment (a slot id never spans two); `**` is one or more, from a trailing slash (a
 * directory prefix) or from a `clossys/agents/` glob of one wildcard then a file, which names every agent's slots.
 * `<inputs>` (the slot's own input refs, resolved per slot) is no fixed path: undefined.
 */
export function pathPattern(path: string, agent: LoopAgent | "*"): string[] | undefined {
  if (path === "<inputs>") return undefined;
  const agents = path.startsWith("clossys/agents/");
  let rel = agents ? path.slice("clossys/agents/".length) : path;
  rel = rel.replace(/^<slot>(?=\/|$)/, `${agent}/*`).replace(/^<(?:dependant|requester)>(?=\/|$)/, "*/*").replaceAll("<agent>", agent).replace(/<[^>]+>/g, "*");
  const segments = rel.split("/");
  if (segments.at(-1) === "") segments[segments.length - 1] = "**";
  if (agents && segments.length === 2 && segments[0] === "*") segments[0] = "**";
  return segments;
}

const segmentRegex = (segment: string) => new RegExp(`^${segment.split("*").map(part => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`);
function segmentsMeet(a: string, b: string): boolean {
  if (a === "*" || b === "*" || a === "**" || b === "**" || a === b) return true;
  if (a.includes("*")) return segmentRegex(a).test(b.replaceAll("*", "x")) || (b.includes("*") && segmentRegex(b).test(a.replaceAll("*", "x")));
  if (b.includes("*")) return segmentRegex(b).test(a);
  return false;
}

/** True when some concrete path matches both patterns (a whole-segment `*` stands for one or more segments). */
export function patternsMeet(a: readonly string[], b: readonly string[]): boolean {
  const memo = new Map<string, boolean>();
  const meet = (i: number, j: number): boolean => {
    if (i === a.length || j === b.length) return i === a.length && j === b.length;
    const key = `${i},${j}`;
    const known = memo.get(key);
    if (known !== undefined) return known;
    const result = (segmentsMeet(a[i]!, b[j]!) && meet(i + 1, j + 1)) || (a[i] === "**" && meet(i, j + 1)) || (b[j] === "**" && meet(i + 1, j));
    memo.set(key, result);
    return result;
  };
  return meet(0, 0);
}

const stepsOf = (content: unknown): LoopStep[] => (isObject(content) && Array.isArray(content.steps) ? content.steps.filter(isObject) as unknown as LoopStep[] : []);
const isAgentStep = (step: LoopStep): boolean => step.decider?.by === "agent";
/** Producer's request and cascade queues: the one place an agent step may write outside its own tree. */
const QUEUE_WRITE = /^producer\/queue\.[a-z]+\/entries(?:\/|$)/;
/**
 * Whether every path a write pattern can resolve to lies in one of the agent's own write roots: its own tree
 * (`<agent>/...`), its own check folder (`.clossys/checks/<agent>/...`) or Producer's queue entries
 * (`producer/queue.<name>/entries/...`). Each root's segments must be literal: a `*` or `**` there (from a glob or from
 * `<dependant>`, `<requester>`, `clossys/agents/*` and the like) could name another agent's tree, so it is refused.
 */
export function ownWriteRoot(pattern: readonly string[], agent: LoopAgent): boolean {
  const [first, second, third] = pattern;
  if (first === agent) return pattern.length >= 2;
  if (first === ".clossys" && second === "checks" && third === agent) return pattern.length >= 4;
  return first === "producer" && /^queue\.[a-z]+$/.test(second ?? "") && third === "entries";
}

/** The agent tree a pattern's first segment names: an agent id, `*` (any agent's), or undefined (no agent tree, e.g. `.clossys/`). */
const treeOf = (pattern: readonly string[]): string | undefined => {
  const first = pattern[0]!;
  return first === "*" || first === "**" || ["director", "designer", "writer", "publisher", "producer"].includes(first) ? first : undefined;
};

/**
 * Why the agents' loops are not one connected chain overseen by Producer; empty when they are:
 *
 * (a) every write of an agent step in an agent loop is read by a Producer connection loop (its code and owner steps;
 *     loop.audit reads everything and so proves nothing) or by another agent's loop;
 * (b) every flows.md N3 handoff (CHAIN_HANDOFFS) is a read, in the downstream agent's own loop steps, of a path the
 *     upstream agent's loop steps write;
 * (c) a write into another agent's tree (or any agent's, by placeholder) sits only on a Producer step the agent loop
 *     keeps exactly as the standard has it (request routing, cascade, release);
 * (d) an agent step writes only its own tree, `.clossys/` checks and Producer's request queues: it reaches another
 *     agent by raising a request or a cascade event, never by writing that agent's slot;
 * (e) Producer's connection loops are all there, and every agent holds all five loops.
 */
export function loopConnectedIssues(set: LoopSet): string[] {
  const issues: string[] = [];
  for (const loop of CONNECTION_LOOPS) if (!set.standards.has(loop)) issues.push(`producer/${loop}: Producer's connection loop is missing`);
  for (const [ref, reason] of set.unread ?? []) issues.push(`${ref}: cannot be read: ${reason}`);
  for (const agent of LOOP_AGENTS) for (const loop of AGENT_LOOPS) {
    if (!set.versions.get(agent)?.has(loop) && !set.unread?.has(`${agent}/${loop}`)) issues.push(`${agent}/${loop}: the agent holds no version of ${loop}`);
  }
  // What Producer's connection loops read (their code and owner steps), and what each agent's own steps read.
  const producerReads: string[][] = [];
  for (const loop of CONNECTION_LOOPS) {
    if (loop === "loop.audit") continue;
    for (const step of stepsOf(set.standards.get(loop))) if (!isAgentStep(step)) for (const path of step.reads ?? []) { const pattern = pathPattern(path, "*"); if (pattern) producerReads.push(pattern); }
  }
  const agentReads = new Map<LoopAgent, string[][]>();
  const agentWrites = new Map<LoopAgent, { loop: AgentLoopName; step: string; path: string; pattern: string[] }[]>();
  for (const [agent, loops] of set.versions) {
    const reads: string[][] = [], writes: { loop: AgentLoopName; step: string; path: string; pattern: string[] }[] = [];
    for (const [loop, content] of loops) {
      const standard = set.standards.get(loop);
      for (const step of stepsOf(content)) {
        const ref = `${agent}/${loop}`;
        if (isAgentStep(step)) {
          for (const path of step.reads ?? []) { const pattern = pathPattern(path, agent); if (pattern) reads.push(pattern); }
          for (const path of step.writes ?? []) {
            const pattern = pathPattern(path, agent);
            if (!pattern) continue;
            writes.push({ loop, step: step.id, path, pattern });
            // (d): judged by the same write roots the extension rule and the runner use.
            if (!ownWriteRoot(pattern, agent)) issues.push(`${ref}: step ${step.id} writes ${path}, outside ${agent}'s tree; an agent loop reaches another agent only by raising a request or a cascade event`);
          }
          continue;
        }
        // (c) a Producer step inside an agent loop: a cross-tree write only as the standard has it.
        const same = stepsOf(standard).find(each => each.id === step.id && !isAgentStep(each));
        for (const path of step.writes ?? []) {
          const pattern = pathPattern(path, agent);
          const tree = pattern ? treeOf(pattern) : undefined;
          if (tree === undefined || tree === agent || QUEUE_WRITE.test(pattern!.join("/"))) continue;
          if (!same || !(same.writes ?? []).includes(path) || same.decider.by !== step.decider?.by) issues.push(`${ref}: step ${step.id} writes ${path} across agent trees; only Producer's own request, cascade and release steps do`);
        }
      }
    }
    agentReads.set(agent, reads);
    agentWrites.set(agent, writes);
  }
  // (a) every agent write is consumed outside the agent.
  for (const [agent, writes] of agentWrites) {
    const others = [...agentReads].filter(([other]) => other !== agent).flatMap(([, reads]) => reads);
    for (const write of writes) {
      if (!producerReads.some(read => patternsMeet(read, write.pattern)) && !others.some(read => patternsMeet(read, write.pattern))) {
        issues.push(`${agent}/${write.loop}: step ${write.step} writes ${write.path}, which no Producer connection loop and no other agent's loop reads`);
      }
    }
  }
  // (b) the chain handoffs.
  for (const [up, down] of CHAIN_HANDOFFS) {
    if (set.runs && !(set.runs.has(up) && set.runs.has(down))) continue;
    const upWrites = (agentWrites.get(up) ?? []).filter(write => write.pattern[0] === up);
    const handed = (agentReads.get(down) ?? []).filter(read => read[0] === up).some(read => upWrites.some(write => patternsMeet(read, write.pattern)));
    if (!handed) issues.push(`handoff ${up} -> ${down}: no step of ${down}'s loops reads what ${up}'s loops write (its pins); the chain is broken here`);
  }
  return issues;
}

/** Every agent's package loop candidates and Producer's standards, from the installed packages. */
export function packageLoopSet(): LoopSet {
  const versions = new Map<LoopAgent, Map<AgentLoopName, unknown>>(), unread = new Map<string, string>();
  for (const agent of LOOP_AGENTS) {
    const loops = new Map<AgentLoopName, unknown>();
    for (const loop of AGENT_LOOPS) {
      const read = readAgentPackageLoop(agent, loop);
      if (read.ok) loops.set(loop, read.content); else unread.set(`${agent}/${loop}`, read.reason);
    }
    versions.set(agent, loops);
  }
  return { versions, standards: producerStandards(), unread };
}

/**
 * The versions each agent's loops run for one consumer, as the runner loads them (version.ts loadLoopVersion): its pin
 * where it holds the slot, else Producer's standard as it runs for that agent (the standard's steps but the ones other
 * agents decide). Never the agent's package candidate: the runner does not run an unpinned candidate.
 */
export function consumerLoopSet(root: string): LoopSet {
  const versions = new Map<LoopAgent, Map<AgentLoopName, unknown>>(), unread = new Map<string, string>();
  const standards = producerStandards();
  const runs = new Set<LoopAgent>();
  for (const agent of LOOP_AGENTS) {
    const loops = new Map<AgentLoopName, unknown>();
    if (placesAgent(root, agent) || AGENT_LOOPS.some(loop => hasAgentLoopSlot(root, agent, loop))) runs.add(agent);
    for (const loop of AGENT_LOOPS) {
      const read = readAgentLoopPin(root, agent, loop);
      const standard = standards.get(loop);
      if (read === undefined) {
        if (standard) loops.set(loop, { ...standard, steps: requiredSteps(standard, agent) });
        else unread.set(`${agent}/${loop}`, `Producer's standard ${loop} cannot be read`);
      } else if (read.ok) loops.set(loop, read.content);
      else unread.set(`${agent}/${loop}`, read.reason);
    }
    versions.set(agent, loops);
  }
  return { versions, standards, unread, runs };
}

/**
 * True when the consumer places the agent: its IA (`clossys/agents/<agent>/ia.json`) holds at least one node. An empty
 * or unreadable IA places nothing (conform's W2 reads the same `nodes`).
 */
export function placesAgent(root: string, agent: LoopAgent): boolean {
  const file = join(root, "clossys", "agents", agent, "ia.json");
  if (!existsSync(file)) return false;
  try {
    const ia = JSON.parse(readFileSync(file, "utf8")) as { nodes?: unknown };
    return Array.isArray(ia.nodes) && ia.nodes.some(node => typeof node === "object" && node !== null);
  } catch {
    return false;
  }
}

/** Producer's package v1 of every connection loop and agent loop it can read. */
export function producerStandards(): Map<LoopName, LoopVersion> {
  const out = new Map<LoopName, LoopVersion>();
  for (const loop of new Set<LoopName>([...CONNECTION_LOOPS, ...AGENT_LOOPS])) {
    const read = readPackageLoop(loop);
    if (read.ok) out.set(loop, read.content as LoopVersion);
  }
  return out;
}

/**
 * One agent loop version judged as the agent standard check and the certifier judge it: it extends Producer's
 * standard (loopExtensionIssues) and can reach its exit (loop.reachable).
 */
export function agentLoopIssues(agent: LoopAgent, loop: AgentLoopName, content: unknown, options: { readonly packageVersion?: boolean } = {}): string[] {
  const standard = standardOf(loop);
  if (!standard.ok) return [`${agent}/${loop}: Producer's standard ${loop} cannot be read: ${standard.reason}`];
  return [
    ...loopExtensionIssues(agent, loop, content, standard.standard),
    ...loopReachableIssues(loop, content, { packageVersion: options.packageVersion ?? false }).map(issue => `${agent}/${issue}`),
  ];
}
