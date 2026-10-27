/** One usage edge between leaves: `from` uses `to` (a frame uses a section, a component uses a token). */
export interface UsageEdge { readonly from: string; readonly to: string }

const reach = (start: string, next: ReadonlyMap<string, readonly string[]>, into: Set<string>) => {
  const queue = [start];
  for (let index = 0; index < queue.length; index++) {
    for (const neighbour of next.get(queue[index]!) ?? []) {
      if (into.has(neighbour)) continue;
      into.add(neighbour); queue.push(neighbour);
    }
  }
};

/**
 * The leaves lit around a selection (Designer D5g): the selection, everything
 * it uses transitively (down), and everything that uses it transitively (up).
 * Siblings reached only by going down and back up stay dim. No selection lights
 * nothing; a selection with no edges lights only itself.
 */
export function litSet(edges: readonly UsageEdge[], selected: string | undefined): Set<string> {
  const lit = new Set<string>();
  if (selected === undefined) return lit;
  const down = new Map<string, string[]>(), up = new Map<string, string[]>();
  for (const edge of edges) {
    down.set(edge.from, [...(down.get(edge.from) ?? []), edge.to]);
    up.set(edge.to, [...(up.get(edge.to) ?? []), edge.from]);
  }
  lit.add(selected);
  reach(selected, down, lit);
  const upward = new Set<string>([selected]);
  reach(selected, up, upward);
  for (const leaf of upward) lit.add(leaf);
  return lit;
}
