/**
 * The slots and IA paths a loop step's `when` may name (`loop.reachable`, B2): every slot the installed Director,
 * Designer and Writer packages place, at the slot/2 position `clossys ia sync` writes for it (the package IA ids
 * as they are, e.g. `writer/lexicon/lexicon.voice/voice-tone`, `director/strategy/context/context.market`), plus the
 * consumer's own slot/2 folders. A `when` that names anything else can never match a slot, so the step it guards is
 * unreachable.
 */
import type { AgentId, LoopStep } from "../records/types.js";
import { designerIa, directorIa, slotPositions, writerIa, type FoundryIa } from "../records/slot-model/foundry-ia.js";
import { chainOrderedSlots, whenMatches, type SlotSubject } from "./slots.js";

export interface SlotPlace { readonly agent: AgentId; readonly slotId: string; readonly ia: { readonly l0: string; readonly l1: string; readonly l2: string } }
export interface KnownSlots { readonly places: readonly SlotPlace[]; readonly refs: ReadonlySet<string> }

/** One package IA's slots at their slot/2 positions (ia sync copies the position: records/slot-model/ia-sync.ts). */
export function placesOf(foundry: FoundryIa): SlotPlace[] {
  const out: SlotPlace[] = [];
  for (const [slotId, position] of slotPositions(foundry.agent, foundry.ia)) {
    const l0 = position.l0 ?? position.l1.split(".")[0]!;
    out.push({ agent: foundry.agent as AgentId, slotId, ia: { l0, l1: position.l1, l2: position.l2 } });
  }
  return out;
}

let packaged: readonly SlotPlace[] | undefined;
/** The package-placed slots of the three content agents (read once per process). */
export function packagePlaces(): readonly SlotPlace[] {
  packaged ??= [directorIa, designerIa, writerIa].flatMap(read => placesOf(read()));
  return packaged;
}

/** The package slots, plus the consumer's slot/2 folders when a consumer root is given. */
export function knownSlots(root?: string): KnownSlots {
  const places: SlotPlace[] = [...packagePlaces()];
  if (root !== undefined) for (const subject of chainOrderedSlots(root)) places.push({ agent: subject.agent, slotId: subject.slotId, ia: subject.slot.ia });
  return { places, refs: new Set(places.map(place => `${place.agent}/${place.slotId}`)) };
}

const asSubject = (place: SlotPlace): SlotSubject => ({ agent: place.agent, slotId: place.slotId, slot: { ia: place.ia } as SlotSubject["slot"] });

/** The `when` values of a step that no known slot matches. */
export function unreachableWhen(when: LoopStep["when"], known: KnownSlots): string[] {
  if (when === undefined) return [];
  const out: string[] = [];
  for (const ref of when.slots ?? []) if (!known.refs.has(ref)) out.push(`slots ${ref}`);
  for (const path of when.ia ?? []) {
    if (!known.places.some(place => whenMatches({ ia: [path] }, asSubject(place)))) out.push(`ia ${path}`);
  }
  return out;
}
