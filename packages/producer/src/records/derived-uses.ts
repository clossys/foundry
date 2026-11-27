/**
 * The `derive.uses` step's records write (CP1-USES): each slot's computed `uses` (scripts/check-generated-derived.mjs
 * deriveUses: what its pinned candidate, else its stock reference item, imports or references) as clossys.slot/2
 * `refs` entries `{to: "<agent>/<id>", rel: "uses"}`, through the one logged slot writer (records/slot-write.ts
 * writeSlotUses: slot lock, atomic replace, one `slot` event per changed slot, R14.1).
 *
 * - A slot whose derived set equals its current uses refs is not touched, so a second run writes nothing.
 * - A slot with no source (no pin, no stock item) has no derived value and is never written: a missing value is not [].
 * - A slot/2 doc carrying a stray top-level `uses` key (not a slot/2 field) is repaired first, its refs kept, with an event.
 * - A package-synced slot (`base` not null) whose derived set differs is not written: its refs are computed from the
 *   package base (records/slot-write.ts currentSlotWrite refuses the change), so it is reported as a package gap.
 * - A write the writer refuses (a slot/1 doc, a slot not in ia.json, an id no agent holds) is reported, never forced.
 */
import { AGENT_LISTS } from "../agent-lists.generated.js";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isCurrentSlot } from "./slot-current.js";
import { writeSlotUses } from "./slot-write.js";
import type { ModelAgent } from "./slot-model/index.js";
import type { Ref } from "./types.js";

/** The agents whose slots carry `uses` (the derivation's agents). */
export const USES_AGENTS: readonly ModelAgent[] = AGENT_LISTS.content;

export interface DerivedUsesResult {
  /** `<agent>/<id>` of every slot.json written, in order. */
  readonly written: readonly string[];
  /** `<agent>/<id>: <why>` for every write the slot writer refused. */
  readonly refused: readonly string[];
  /** `<agent>/<id>: <package>` for every package-synced slot whose derived set differs (change it in the package). */
  readonly synced?: readonly string[];
}

const slotJson = (consumer: string, agent: string, id: string) => join(consumer, "agents", agent, id, "slot.json");
const readDoc = (consumer: string, agent: string, id: string): Record<string, unknown> | undefined => {
  try { return JSON.parse(readFileSync(slotJson(consumer, agent, id), "utf8")) as Record<string, unknown>; } catch { return undefined; }
};
/** The `to` of every `uses` ref a slot/2 doc holds, as written. */
const usesRefs = (doc: Record<string, unknown>): Ref["to"][] =>
  (Array.isArray(doc.refs) ? doc.refs : []).flatMap(ref => ref && typeof ref === "object" && (ref as Ref).rel === "uses" && typeof (ref as Ref).to === "string" ? [(ref as Ref).to] : []);
/** Every slot folder of one agent. */
function slotIdsOf(consumer: string, agent: string): string[] {
  const dir = join(consumer, "agents", agent);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter(name => existsSync(join(dir, name, "slot.json"))).sort();
}

/** The agent whose tree holds slot `id`: the slot's own agent first, else the first of USES_AGENTS. */
export function holderOf(consumer: string, agent: string, id: string): ModelAgent | undefined {
  return [agent, ...USES_AGENTS.filter(each => each !== agent)].find(each => existsSync(slotJson(consumer, each, id))) as ModelAgent | undefined;
}

function write(consumer: string, agent: ModelAgent, id: string, uses: readonly Ref["to"][], at: string, written: string[], refused: string[]): void {
  try { if (writeSlotUses(consumer, agent, id, uses, { at })) written.push(`${agent}/${id}`); }
  catch (error) { refused.push(`${agent}/${id}: ${error instanceof Error ? error.message : String(error)}`); }
}

/** Remove the stray top-level `uses` key from every slot/2 doc that carries one, keeping its refs (one event each). */
export function repairStrayUses(consumer: string, input: { readonly at: string }): DerivedUsesResult {
  const written: string[] = [], refused: string[] = [];
  for (const agent of USES_AGENTS) for (const id of slotIdsOf(consumer, agent)) {
    const doc = readDoc(consumer, agent, id);
    if (!doc || !isCurrentSlot(doc) || !Object.hasOwn(doc, "uses")) continue;
    write(consumer, agent, id, usesRefs(doc), input.at, written, refused);
  }
  return { written, refused };
}

/**
 * Write `derived` (`<agent>/<id>` to the sorted slot ids its source uses; a slot with no source is absent) as each
 * slot's `uses` refs, each id at the agent that holds it. Only a slot whose set differs from its current uses refs is
 * written.
 */
export function writeDerivedUses(consumer: string, derived: ReadonlyMap<string, readonly string[]>, input: { readonly at: string }): DerivedUsesResult {
  const written: string[] = [], refused: string[] = [], synced: string[] = [];
  for (const [key, ids] of derived) {
    const [agent, id] = key.split("/") as [ModelAgent, string];
    const doc = readDoc(consumer, agent, id);
    if (!doc) { refused.push(`${key}: slot.json cannot be read`); continue; }
    if (!isCurrentSlot(doc)) { refused.push(`${key}: slot.json is not a clossys.slot/2 (clossys migrate slot-1-to-2 first)`); continue; }
    const missing = ids.filter(use => !holderOf(consumer, agent, use));
    if (missing.length) { refused.push(`${key}: no agent holds ${missing.join(", ")}`); continue; }
    const uses = ids.map(use => `${holderOf(consumer, agent, use)!}/${use}` as Ref["to"]);
    const current = usesRefs(doc);
    const same = current.length === new Set(current).size && current.length === uses.length && uses.every(to => current.includes(to));
    if (same) continue;
    const base = (doc as Record<string, unknown>).base as { package?: unknown } | null | undefined;
    if (base) { synced.push(`${key}: ${String(base.package)}`); continue; }
    write(consumer, agent, id, uses, input.at, written, refused);
  }
  return { written, refused, synced };
}
