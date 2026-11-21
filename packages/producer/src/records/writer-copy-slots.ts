/**
 * Which Writer slots hold keyed copy, read from Writer's own tree data (foundry-build-0048 U14), never from an id prefix.
 *
 * Writer's current tree (src/catalog/ia/{voice,prose,copy}.json, read through `writerIa()`) names each slot's kind:
 * `copy` slots hold keyed copy records (headlines, labels, page metadata); `prose` slots hold long-form pieces that
 * resolve by `<slot>#<record>` (privacy, terms, articles), not keyed records; `voice` slots hold the voice rules the copy
 * follows. A consumer slot holds keyed copy when it is placed in the consumer's Writer IA and:
 *  - it is a Writer tree slot of the copy kind, or
 *  - it is not a Writer tree slot (an owner-signed consumer extension) and it is not placed under an L0 with no copy
 *    slot (the voice and prose groups).
 * An id `@clossys/writer/src/catalog/retired.json` lists is never copy: a retired id stays unreadable, whatever store still
 * places it. Of a copy slot's pinned records only the keyed record bodies (`.md`) are keyed copy; a `.json` field
 * record resolves by `<slot>#<record>` through records/resolve.ts.
 *
 * Every keyed copy reader takes this one rule: the pinned Writer copy (`writer-copy.ts`), the interview's key holders
 * (`pipeline/interview.ts`), the compile lock's Writer inputs (`publish/compile-publications.ts`) and Studio's copy
 * registry (`scripts/generate-studio-map.mjs` (not shipped)). Each slot's L0 comes from `nodeLayers`, as `listSlots` positions do.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveAgent } from "../agents.js";
import { nodeLayers, writerIa, type FoundryIa } from "./slot-model/foundry-ia.js";
import type { TargetSlotKind } from "./types.js";
import { listSlots, readPins, type SlotEntry } from "./slots.js";
import type { PinDoc } from "./slot-model/types.js";

/** The Writer tree kinds whose slots hold keyed copy records. Prose slots hold pieces, voice slots hold rules. */
export const WRITER_COPY_KINDS: ReadonlySet<TargetSlotKind> = new Set<TargetSlotKind>(["copy"]);

export interface WriterCopyRule {
  /** Each Writer tree slot id and its tree kind. */
  readonly treeKinds: ReadonlyMap<string, TargetSlotKind>;
  /** The tree L0 groups none of whose slots holds keyed copy (voice, prose). */
  readonly nonCopyGroups: ReadonlySet<string>;
  /** The ids `@clossys/writer/src/catalog/retired.json` lists. */
  readonly retired: ReadonlySet<string>;
}

let memo: WriterCopyRule | undefined;

/** The ids `@clossys/writer/src/catalog/retired.json` lists; none when the installed package ships no such file. */
export function writerRetired(root: string = resolveAgent("writer").packageRoot): ReadonlySet<string> {
  let rows: unknown;
  try { rows = JSON.parse(readFileSync(join(root, "src/catalog/retired.json"), "utf8")); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return new Set(); throw error; }
  if (!Array.isArray(rows)) throw new Error(`${join(root, "src/catalog/retired.json")} is not an array of retired leaves`);
  return new Set(rows.flatMap(row => row && typeof row.id === "string" ? [row.id as string] : []));
}

/** The rule as Writer's installed tree and retired list state it. */
export function writerCopyRule(foundry: FoundryIa = writerIa(), retired: ReadonlySet<string> = writerRetired()): WriterCopyRule {
  const treeKinds = new Map<string, TargetSlotKind>();
  for (const [id, slot] of foundry.slots) if (slot.targetKind !== undefined) treeKinds.set(id, slot.targetKind);
  const groups = new Map<string, boolean>();
  const layers = nodeLayers("writer", foundry.ia);
  for (const node of foundry.ia.nodes) {
    const group = layers.get(node.id) ?? node.id;
    const copy = node.children.some(child => child.slots.some(id => WRITER_COPY_KINDS.has(treeKinds.get(id)!)));
    groups.set(group, (groups.get(group) ?? false) || copy);
  }
  return { treeKinds, nonCopyGroups: new Set([...groups].filter(([, copy]) => !copy).map(([group]) => group)), retired };
}

const rule = (): WriterCopyRule => (memo ??= writerCopyRule());

/** Whether a placed Writer slot holds copy (see the module comment). */
export function isWriterCopySlot(entry: Pick<SlotEntry<"writer">, "id" | "position">, given: WriterCopyRule = rule()): boolean {
  if (given.retired.has(entry.id)) return false;
  const kind = given.treeKinds.get(entry.id);
  if (kind !== undefined) return WRITER_COPY_KINDS.has(kind);
  return entry.position.l0 === undefined || !given.nonCopyGroups.has(entry.position.l0);
}

/** The consumer's placed Writer copy slots, in IA order. */
export function writerCopySlots(consumer: string, given?: WriterCopyRule): SlotEntry<"writer">[] {
  return listSlots(consumer, "writer").filter(entry => isWriterCopySlot(entry, given));
}

/** One pinned copy record: a slot's single pin, or one record of its pin map. */
export interface WriterCopyPin { readonly entry: SlotEntry<"writer">; readonly pin: PinDoc }

/**
 * Every pinned record of every Writer copy slot whose candidate is a keyed Writer record body (`.md`), in IA then
 * record order: a pin map contributes each record, not only its first. A `.json` field record (`content.fields`)
 * carries no record ids to key; it resolves by `<slot>#<record>` through records/resolve.ts.
 */
export function writerCopyPins(consumer: string, given?: WriterCopyRule): WriterCopyPin[] {
  return writerCopySlots(consumer, given)
    .filter(entry => entry.pin)
    .flatMap(entry => readPins(consumer, "writer", entry.id).filter(pin => pin.candidate.endsWith(".md")).map(pin => ({ entry, pin })));
}
