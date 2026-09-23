import type { PackItem, PackManifest } from "./types.js";

export interface PackItemReadiness {
  itemId: string;
  /** True when every item this one needs is itself approved or verified, and not blocked. */
  ready: boolean;
  /** Needed ids that are not yet satisfied — empty when ready is true. */
  blockedBy: readonly string[];
}

export interface PackReadiness {
  /** Per-item readiness, in the same order as `plan()`'s topological order. */
  items: readonly PackItemReadiness[];
  /** True only when every item in the pack is ready. */
  ready: boolean;
}

function isSatisfied(item: PackItem | undefined): boolean {
  if (!item) return false; // an unknown need is a schema defect, never treated as satisfied
  if (item.condition === "blocked") return false;
  return item.status === "approved" || item.status === "verified";
}

/**
 * "Publisher plans first" (#1204): a topological order over the pack's
 * `needs` graph, foundation and identity items first, surfaces last. Assumes
 * `validatePackManifest` has already confirmed the graph has no cycle —
 * this function throws if it still finds one, rather than silently
 * producing a partial order.
 */
export function planPackOrder(manifest: PackManifest): readonly string[] {
  const byId = new Map(manifest.items.map((item) => [item.id, item]));
  const order: string[] = [];
  const state = new Map<string, "visiting" | "done">();

  const visit = (id: string): void => {
    if (state.get(id) === "done") return;
    if (state.get(id) === "visiting") throw new Error(`planPackOrder: needs cycle reaches "${id}" — validate the manifest with validatePackManifest first.`);
    state.set(id, "visiting");
    for (const need of byId.get(id)?.needs ?? []) {
      if (byId.has(need)) visit(need);
    }
    state.set(id, "done");
    order.push(id);
  };

  for (const item of manifest.items) visit(item.id);
  return order;
}

/**
 * Readiness computed from the `needs` graph (#1204's "Done when" list): an
 * item is ready once every item it needs is itself approved or verified,
 * and none of them is blocked. A missing dependency is never silently
 * treated as satisfied.
 */
export function computePackReadiness(manifest: PackManifest): PackReadiness {
  const byId = new Map(manifest.items.map((item) => [item.id, item]));
  const order = planPackOrder(manifest);
  const items = order.map((itemId): PackItemReadiness => {
    const item = byId.get(itemId);
    const blockedBy = (item?.needs ?? []).filter((need) => !isSatisfied(byId.get(need)));
    return { itemId, ready: blockedBy.length === 0, blockedBy };
  });
  return { items, ready: items.every((entry) => entry.ready) };
}

/**
 * "Publisher ... seals last" (#1204): the ids eligible to move from
 * `approved` to `verified` right now — already approved, not blocked, and
 * every item they need is itself already verified. Sealing is the caller's
 * job (it writes `verifiedAt` and a publication record); this only answers
 * "what may be sealed."
 */
export function sealableItemIds(manifest: PackManifest): readonly string[] {
  const byId = new Map(manifest.items.map((item) => [item.id, item]));
  return manifest.items
    .filter((item) => item.status === "approved" && item.condition !== "blocked")
    .filter((item) => (item.needs ?? []).every((need) => byId.get(need)?.status === "verified"))
    .map((item) => item.id);
}
