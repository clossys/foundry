/**
 * Adopting an agent's own loops into a consumer (foundry-build-0048 U9a): the agent's loops L1 in its ia.json
 * (agent-loops-ia.ts), its five `loop.<name>` slots (kind `loop`, standard `loop`, a contract naming the Producer
 * loop each extends) and, in each, a submitted copy of the agent's package loop candidate. All in one guarded write:
 * when the slot model check has an issue after it that it did not have before, every file is put back byte for byte.
 *
 * Adoption writes no pin. A loop slot is pinned only through the pin gate (`clossys pin`, the one CHOOSE choke point),
 * which `clossys loop` calls with the planner basis (cli/loop.ts).
 *
 * The actor is judged before anything is written (Q9, foundry-build-0048 U7 r5): the planner (`planner` or
 * `planner:<ref>`, recorded as `planner`) or an owner answer ref that resolves (records/seat-owner.ts assertActor).
 * Bare `owner`, agent seats and free text are refused, so the ia events this writes always name a judged actor.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { resolveAgent } from "../agents.js";
import { LEDGER_FILE, skillPath } from "../records/ledger.js";
import { cliActor } from "../records/pin.js";
import { assertActor } from "../records/seat-owner.js";
import { checkSlotModel } from "../records/slot-check.js";
import { positionIa, serializeSlot, validateSlot } from "../records/slot.js";
import { candidatesDir, iaPath, jsonBytes, slotDir, slotFile } from "../records/slot-model/layout.js";
import { slotPositions } from "../records/slot-model/foundry-ia.js";
import type { IaDoc } from "../records/slot-model/types.js";
import { isModelDir, modelExists, readModelBytes, readModelText } from "../records/slots.js";
import { appendIaEvent, appendSlotDocEvent, dropEmptyModelDir, removeModelFile, replaceModelFile, writeCandidateBytes } from "../records/slot-write.js";
import type { Slot } from "../records/types.js";
import { AGENT_LOOPS, holdsAgentLoops, withAgentLoopsIa, type AgentLoopName, type LoopAgent } from "./agent-loops-ia.js";
import { agentPackageLoopFile, AGENT_LOOPS_DIR, LOOP_KIND, LOOP_STANDARD } from "./agent-loops.js";
import { loopStem } from "./names.js";

/** The candidate file an adopted loop slot holds: the package candidate's own name. */
export const adoptedLoopCandidate = (loop: AgentLoopName): string => `${loopStem(loop)}-v1.json`;

/** The base an adopted loop slot declares: its agent package's loop candidate, `loops/<loop>/<stem>-v1.json`. */
export const adoptedLoopBasePath = (loop: AgentLoopName): string => `${AGENT_LOOPS_DIR}/${loop}/${adoptedLoopCandidate(loop)}`;

/**
 * The loop runner's consumer edge on an agent loop slot (foundry-build-0048 CONSISTENCY D5 option 3): the slot is
 * used by the Producer loop it extends, named by that loop's package version
 * (`producer/<loop>/package:<stem>-v1.json`). It is a recorded edge, not an exemption: ia.orphans walks it backward
 * from the runner's roots (check/ia-orphans.ts RUNNER_ROOTS), and a slot without it is an orphan.
 */
export const runnerEdge = (loop: AgentLoopName): { readonly to: string; readonly rel: "consumedBy" } =>
  ({ to: `producer/${loop}/package:${adoptedLoopCandidate(loop)}`, rel: "consumedBy" });

const hasRunnerEdge = (slot: Pick<Slot, "refs">, loop: AgentLoopName): boolean =>
  (slot.refs ?? []).some(ref => ref.rel === "consumedBy" && ref.to === runnerEdge(loop).to);

/**
 * The slot.json `clossys loop` writes for `agent`'s `loop` (computed, never stored elsewhere): from the agent package's
 * `version`, the bytes of its loop candidate at `adoptedLoopBasePath` and the loop's IA position. The adopt verb
 * writes it and the strict checks recompute it from the slot's declared base (check/declared-base.ts).
 */
export function adoptedLoopSlot(agent: LoopAgent, loop: AgentLoopName, input: { readonly version: string; readonly packageBytes: string | Buffer; readonly position: Parameters<typeof positionIa>[1]; readonly at: string }): Slot {
  return {
    schema: "clossys.slot/2", id: loop, agent, kind: LOOP_KIND, status: "starter",
    ia: positionIa(loop, input.position),
    createdBy: cliActor("clossys loop"), createdAt: input.at, refs: [runnerEdge(loop)],
    base: { package: `@clossys/${agent}`, version: input.version, path: adoptedLoopBasePath(loop), sha256: sha(input.packageBytes) },
    standard: LOOP_STANDARD,
    brief: { purpose: `${agent}'s own ${loop}: Producer's standard ${loop} with ${agent}'s own steps, skills and tiers.`, mustDo: [], inputs: [], acceptance: [] },
    contract: { loop, extends: `producer/${loop}`, requirements: [] }, tighten: [], family: { options: 1, varyOn: null, values: [] },
  } as unknown as Slot;
}

export interface AdoptResult {
  /** True when this call wrote the loops (false: the consumer already held all of them, at most gaining the runner's edge). */
  readonly adopted: boolean;
  /** Files written, relative to the workspace root. */
  readonly wrote: readonly string[];
  /** Slot model issues the write would have added; non-empty means nothing was written. */
  readonly refused: readonly string[];
}

const sha = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
const issueKeys = (consumer: string) => checkSlotModel(consumer).map(issue => `${issue.code} ${issue.path} ${issue.message}`);
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** True when the consumer holds the agent's loops L1 and all five loop slots, each with the runner's edge. */
export function holdsAdoptedLoops(root: string, agent: LoopAgent): boolean {
  const consumer = join(root, "clossys");
  const file = iaPath(consumer, agent);
  if (!modelExists(file)) return false;
  const ia = JSON.parse(readModelText(file)) as IaDoc;
  return holdsAgentLoops(agent, ia) && AGENT_LOOPS.every(loop => modelExists(slotFile(slotDir(consumer, agent, loop)))) && unedged(consumer, agent).length === 0;
}

/** The agent's held loop slots that do not yet record the runner's edge (adopted before CONSISTENCY D5). */
function unedged(consumer: string, agent: LoopAgent): { readonly loop: AgentLoopName; readonly dir: string; readonly bytes: string }[] {
  return AGENT_LOOPS.flatMap(loop => {
    const dir = slotDir(consumer, agent, loop);
    if (!modelExists(slotFile(dir))) return [];
    const slot = JSON.parse(readModelText(slotFile(dir))) as Slot;
    if (hasRunnerEdge(slot, loop)) return [];
    return [{ loop, dir, bytes: serializeSlot({ ...slot, refs: [...(slot.refs ?? []), runnerEdge(loop)] } as Slot) }];
  });
}

/** The agent's package loop candidate, as a seed id and a candidate source ref. */
const packageSeed = (agent: LoopAgent, loop: AgentLoopName): string => `@clossys/${agent}:${AGENT_LOOPS_DIR}/${loop}/${adoptedLoopCandidate(loop)}`;

/** The consumer copy of the agent's package loop candidate: the same content under the consumer slot's id. */
function consumerCandidateBytes(agent: LoopAgent, loop: AgentLoopName, packageBytes: string): string {
  const doc = JSON.parse(packageBytes) as Record<string, unknown>;
  const header = isObject(doc.clossys) ? doc.clossys : {};
  const name = adoptedLoopCandidate(loop);
  const clossys = { ...header, id: `${agent}/${loop}/${name}`, slot: `${agent}/${loop}`, source: { kind: "package-default", ref: [packageSeed(agent, loop)] } };
  return jsonBytes({ ...doc, clossys });
}

/**
 * Write the agent's loops into the consumer once: ia.json gains the loops L1 (and, where the IA is layered, the loops
 * layer), each loop slot gets its slot.json and a submitted candidate copied from the agent's package. Idempotent:
 * a consumer that already holds them is left as it is.
 */
export function adoptAgentLoops(root: string, agent: LoopAgent, input: { readonly by: string; readonly at: string }): AdoptResult {
  const by = /^planner(:.+)?$/.test(input.by) ? "planner" : input.by;
  assertActor(root, by, agent, "loop adopt", { also: ["planner"] });
  if (holdsAdoptedLoops(root, agent)) return { adopted: false, wrote: [], refused: [] };
  const consumer = join(root, "clossys");
  const iaFile = iaPath(consumer, agent);
  if (!modelExists(iaFile)) return { adopted: false, wrote: [], refused: [`clossys/agents/${agent}/ia.json does not exist; run clossys init first`] };
  const iaText = readModelText(iaFile);
  const ia = withAgentLoopsIa(agent, JSON.parse(iaText) as IaDoc);
  const iaChanged = jsonBytes(ia) !== iaText;
  const positions = slotPositions(agent, ia);
  const { packageRoot } = resolveAgent(agent);
  const version = (JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as { version: string }).version;

  const slots = AGENT_LOOPS.filter(loop => !modelExists(slotFile(slotDir(consumer, agent, loop)))).map(loop => {
    const packageFile = agentPackageLoopFile(agent, loop);
    const packageBytes = readFileSync(packageFile, "utf8");
    const slot = adoptedLoopSlot(agent, loop, { version, packageBytes, position: positions.get(loop), at: input.at });
    const issues = validateSlot(slot);
    if (issues.length) throw new Error(`${agent}/${loop}: the adopted slot.json is invalid: ${issues.map(issue => `${issue.path} ${issue.message}`).join("; ")}`);
    return { loop, dir: slotDir(consumer, agent, loop), bytes: serializeSlot(slot), candidate: consumerCandidateBytes(agent, loop, packageBytes) };
  });

  const edges = unedged(consumer, agent);

  // Everything the write touches, as it was, so a refused write is undone byte for byte.
  const paths = [
    iaFile, join(dirname(iaFile), LEDGER_FILE),
    ...slots.flatMap(each => [slotFile(each.dir), join(each.dir, LEDGER_FILE), join(candidatesDir(each.dir), adoptedLoopCandidate(each.loop))]),
    ...edges.flatMap(each => [slotFile(each.dir), join(each.dir, LEDGER_FILE)]),
  ];
  const before = paths.map(path => ({ path, bytes: modelExists(path) ? readModelBytes(path) : null }));
  const undo = () => {
    for (const entry of before) { if (entry.bytes === null) removeModelFile(entry.path); else replaceModelFile(entry.path, entry.bytes); }
    for (const each of slots) for (const dir of [candidatesDir(each.dir), each.dir]) if (isModelDir(dir)) dropEmptyModelDir(dir);
  };
  const known = new Set(issueKeys(consumer));
  try {
    if (iaChanged || slots.length) {
      replaceModelFile(iaFile, jsonBytes(ia));
      appendIaEvent(consumer, agent, { by, at: input.at, fields: { kind: "ia", decision: "adopt-loops" } });
    }
    for (const each of slots) {
      replaceModelFile(slotFile(each.dir), each.bytes);
      appendSlotDocEvent(consumer, agent, each.loop, { by, at: input.at, verb: "ia", skill: skillPath("producer", "ia"), fields: { kind: "ia", decision: "create", overlaps: [] } });
      // The selection ladder (candidate-ladder.ts): the agent's package candidate adapted to this slot (its header names the consumer slot).
      writeCandidateBytes(consumer, agent, each.loop, adoptedLoopCandidate(each.loop), each.candidate, { at: input.at, fields: { rung: agent === "designer" ? "L3" : "adapt", seed: packageSeed(agent, each.loop), reason: `${agent}'s package ${each.loop} candidate, its header re-addressed to this consumer slot; content unchanged` } });
    }
    // A loop slot adopted before the runner recorded its edge gains it here, in the same guarded write.
    for (const each of edges) {
      replaceModelFile(slotFile(each.dir), each.bytes);
      appendSlotDocEvent(consumer, agent, each.loop, { by, at: input.at, verb: "ia", skill: skillPath("producer", "ia"), fields: { kind: "ia", decision: "runner-edge", overlaps: [] } });
    }
  } catch (error) { undo(); throw error; }
  const added = issueKeys(consumer).filter(issue => !known.has(issue));
  if (added.length) { undo(); return { adopted: false, wrote: [], refused: added }; }
  const rel = (path: string) => relative(root, path).split(sep).join("/");
  return { adopted: iaChanged || slots.length > 0, wrote: paths.filter(path => modelExists(path)).map(rel), refused: [] };
}
