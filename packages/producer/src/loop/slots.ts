/**
 * Slot-side helpers of `clossys run`: the next slot to fill (flows.md N3), a step's `when`, and the angle-bracket
 * names a step's strings carry (`<ref>`, `<owner of slot>`, `<slot standard>`, ...), filled per slot.
 */
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { resolveSlot } from "../records/resolve.js";
import { packagePath } from "../package-path.js";
import { readSlot, slotSchemaOf, SLOT_SCHEMA, consumerSlotFolders } from "../records/slot.js";
import type { AgentId, LoopStep, Slot } from "../records/types.js";
import { CHAIN_ORDER, LIVE_AGENTS, OWNER_OF_SLOT } from "./names.js";

export interface SlotSubject {
  readonly agent: AgentId;
  readonly slotId: string;
  readonly slot: Slot;
}

export const refOf = (subject: Pick<SlotSubject, "agent" | "slotId">): string => `${subject.agent}/${subject.slotId}`;

/** Reads a consumer slot/2; undefined when the folder has none (or an older schema). */
export function readSubject(root: string, agent: AgentId, slotId: string): SlotSubject | undefined {
  const file = join(root, "clossys", "agents", agent, slotId, "slot.json");
  if (!existsSync(file) || slotSchemaOf(file) !== SLOT_SCHEMA) return undefined;
  return { agent, slotId, slot: readSlot(file) };
}

/** Every consumer slot/2 of the content agents, in chain order and then IA order. */
export function chainOrderedSlots(root: string): SlotSubject[] {
  const out: SlotSubject[] = [];
  for (const folder of consumerSlotFolders(root)) {
    if (folder.agent === "producer" || !folder.hasSlot) continue;
    const subject = readSubject(root, folder.agent, folder.id);
    if (subject) out.push(subject);
  }
  const key = (s: SlotSubject): (string | number)[] => [CHAIN_ORDER[s.agent], s.slot.ia.l0, s.slot.ia.l1, s.slot.ia.l2, s.slot.ia.order, s.agent, s.slotId];
  return out.sort((a, b) => {
    const ka = key(a), kb = key(b);
    for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i]! < kb[i]! ? -1 : 1;
    return 0;
  });
}

/** flows.md N3: the next consumed slot still on a package default (or unresolved), in chain order. */
export function nextFillSlot(root: string, skip: ReadonlySet<string> = new Set()): SlotSubject | undefined {
  for (const subject of chainOrderedSlots(root)) {
    if (skip.has(refOf(subject)) || subject.slot.status === "retired" || subject.slot.status === "parked") continue;
    if (resolveSlot(root, subject.agent, subject.slotId).state !== "pinned") return subject;
  }
  return undefined;
}

/** The next slot marked needs-refresh (flows.md F7), in chain order. */
export function nextRefreshSlot(root: string, skip: ReadonlySet<string> = new Set()): SlotSubject | undefined {
  return chainOrderedSlots(root).find(subject => !skip.has(refOf(subject)) && subject.slot.status === "needs-refresh");
}

/**
 * A step's `when`: absent, the step runs for every slot. `slots` lists `<agent>/<slot-id>`; `ia` lists IA paths,
 * either `<agent>[/<l0>[/<l1>[/<l2>]]]` or `<l0>[/<l1>[/<l2>]]`. Either list matching is enough. A run with no slot
 * (release, audit) skips every step that has a `when`.
 */
export function whenMatches(when: LoopStep["when"], subject: SlotSubject | undefined): boolean {
  if (when === undefined) return true;
  if (!subject) return false;
  const ref = refOf(subject);
  if ((when.slots ?? []).includes(ref)) return true;
  const ia = [subject.slot.ia.l0, subject.slot.ia.l1, subject.slot.ia.l2].join("/");
  const full = `${subject.agent}/${ia}`;
  const under = (path: string, prefix: string): boolean => path === prefix || path.startsWith(`${prefix}/`);
  return (when.ia ?? []).some(value => {
    const first = value.split("/")[0]!;
    return (LIVE_AGENTS as readonly string[]).includes(first) ? under(full, value) : under(ia, value);
  });
}

/** Fills `<name>` tokens that `vars` knows; returns the text and the names left unfilled. */
export function fillNames(text: string, vars: Readonly<Record<string, string>>): { text: string; unfilled: string[] } {
  const unfilled: string[] = [];
  const out = text.replace(/<([a-z][a-z0-9 -]*)>/g, (whole, name: string) => {
    const value = vars[name];
    if (value === undefined) { if (!unfilled.includes(name)) unfilled.push(name); return whole; }
    return value;
  });
  return { text: out, unfilled };
}

/**
 * A step's argv (B8): the cli is split into tokens before any name is filled, so a filled value (an owner's quote, a
 * path, a candidate name) stays one argument and can never add a flag or an argument of its own.
 */
export function stepArgv(template: string, vars: Readonly<Record<string, string>>): { argv: string[]; text: string; unfilled: string[] } {
  const tokens = template.match(/(?:<[a-z][a-z0-9 -]*>|\S)+/g) ?? [];
  const filled = fillNames(template, vars);
  return { argv: tokens.map(token => fillNames(token, vars).text), text: filled.text, unfilled: filled.unfilled };
}

/** The per-slot names (producer.md 10.4.1: `<owner of slot>`, `<ref>` and the other angle-bracket names). */
export function slotVars(subject: SlotSubject): Record<string, string> {
  const ref = refOf(subject);
  return {
    [OWNER_OF_SLOT.slice(1, -1)]: subject.agent,
    ref, slot: ref, agent: subject.agent, "slot-id": subject.slotId,
    "slot standard": subject.slot.standard,
    inputs: subject.slot.brief.inputs.map(input => input.to).join(" "),
  };
}

/** The consumedBy dependants of a slot, as `<agent>/<slot-id>` refs that exist in the consumer. */
export function dependantsOf(root: string, subject: SlotSubject): SlotSubject[] {
  const out: SlotSubject[] = [];
  for (const ref of subject.slot.refs) {
    if (ref.rel !== "consumedBy") continue;
    const [agent, slotId] = ref.to.split("/") as [AgentId, string];
    const dependant = slotId ? readSubject(root, agent, slotId) : undefined;
    if (dependant && !out.some(seen => refOf(seen) === refOf(dependant))) out.push(dependant);
  }
  return out;
}

/**
 * A decider's skill (system.md 14.1: `packages/<agent>/actions/<action-id>/skill.md`, the same path a candidate records
 * in `createdBy.skill`) with `<agent>` filled; undefined when the installed agent package has no such file.
 */
export function skillFor(root: string, skill: string | undefined, agent: AgentId): string | undefined {
  if (skill === undefined) return undefined;
  const path = fillNames(skill, { agent }).text;
  return existsSync(packagePath(root, path)) ? path : undefined;
}

/** The candidate files of a consumer slot, sorted. */
export function slotCandidates(root: string, subject: Pick<SlotSubject, "agent" | "slotId">): string[] {
  const dir = join(root, "clossys", "agents", subject.agent, subject.slotId, "candidates");
  return existsSync(dir) ? readdirSync(dir).filter(name => /-v[1-9][0-9]*\.(md|json|svg)$/.test(name)).sort() : [];
}
