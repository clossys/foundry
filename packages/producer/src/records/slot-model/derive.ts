/**
 * F10: deterministic `inputs` and `uses` for slot.json.
 *
 * - Director `inputs` are its contract inputs; a brief's `feeds` become the
 *   downstream slot's `inputs`.
 * - Writer `inputs` are the briefs that feed it plus the leaf's `requires`.
 * - Designer `uses` are contract composes/requires plus the candidate's
 *   `registryDependencies` and element deps, mapped to slot ids.
 * - Publisher page `uses` are frame + sections + copy slots; a publication uses
 *   its pages. Their `inputs` equal their `uses`.
 *
 * A ref that names no IA slot is dropped (and counted). `usedBy` is computed by
 * the reader, never stored.
 */
import { DESIGNER_LAYERS } from "./foundry-ia.js";
import type { SlotAgent, SlotKind } from "./types.js";

export interface DeriveContext {
  /** Every slot id in every agent's IA. */
  readonly known: ReadonlySet<string>;
  /** Downstream slot -> Director briefs whose feeds name it. */
  readonly feeds: ReadonlyMap<string, readonly string[]>;
}
export interface RawRefs { readonly inputs?: readonly string[]; readonly uses?: readonly string[] }
export interface Derived { readonly inputs: string[]; readonly uses: string[]; readonly dropped: string[] }

/** Map a raw reference (`writer:x.y@2`, `button`, `@scope/registry/components.x`) to a known slot id. */
export function toSlotId(ref: string, known: ReadonlySet<string>): string | undefined {
  const bare = ref.replace(/^[a-z]+:/, "").replace(/@\d+$/, "").replace(/^.*\//, "");
  if (known.has(bare)) return bare;
  for (const layer of DESIGNER_LAYERS) if (known.has(`${layer}.${bare}`)) return `${layer}.${bare}`;
  return undefined;
}

function mapAll(refs: readonly string[], self: string, ctx: DeriveContext, dropped: Set<string>): string[] {
  const out = new Set<string>();
  for (const ref of refs) {
    const id = toSlotId(ref, ctx.known);
    if (!id) { dropped.add(ref); continue; }
    if (id !== self) out.add(id);
  }
  return [...out].sort();
}

export function deriveRefs(agent: SlotAgent, kind: SlotKind, slot: string, raw: RawRefs, ctx: DeriveContext): Derived {
  const dropped = new Set<string>();
  const fed = ctx.feeds.get(slot) ?? [];
  const uses = mapAll(raw.uses ?? [], slot, ctx, dropped);
  let inputs: string[];
  if (agent === "publisher" || kind === "page" || kind === "publication") inputs = uses;
  else inputs = mapAll([...fed, ...(raw.inputs ?? [])], slot, ctx, dropped);
  return { inputs, uses, dropped: [...dropped].sort() };
}

/** Invert Director feeds: downstream slot -> feeding briefs (sorted, deduped). */
export function feedsIndex(briefFeeds: Iterable<readonly [string, readonly string[]]>, known: ReadonlySet<string>): Map<string, string[]> {
  const index = new Map<string, Set<string>>();
  for (const [brief, feeds] of briefFeeds) for (const ref of feeds) {
    const id = toSlotId(ref, known);
    if (!id) continue;
    if (!index.has(id)) index.set(id, new Set());
    index.get(id)!.add(brief);
  }
  return new Map([...index].map(([id, set]) => [id, [...set].sort()]));
}
