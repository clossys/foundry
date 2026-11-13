import type { CoverageEdge } from "./types.js";

/** Strongly connected components, not every path around the same cycle. */
export function graphCycles(nodes: ReadonlySet<string>, edges: readonly CoverageEdge[]): string[][] {
  const adjacency = new Map([...nodes].map(id => [id, [] as string[]]));
  for (const edge of edges) if (nodes.has(edge.from) && nodes.has(edge.to)) adjacency.get(edge.from)!.push(edge.to);
  const index = new Map<string, number>(), low = new Map<string, number>(), stack: string[] = [], active = new Set<string>(), cycles: string[][] = [];
  let next = 0;
  const visit = (id: string): void => {
    index.set(id, next); low.set(id, next++); stack.push(id); active.add(id);
    for (const to of adjacency.get(id)!) {
      if (!index.has(to)) { visit(to); low.set(id, Math.min(low.get(id)!, low.get(to)!)); }
      else if (active.has(to)) low.set(id, Math.min(low.get(id)!, index.get(to)!));
    }
    if (low.get(id) !== index.get(id)) return;
    const component: string[] = [];
    let member: string;
    do { member = stack.pop()!; active.delete(member); component.push(member); } while (member !== id);
    if (component.length > 1 || adjacency.get(id)!.includes(id)) cycles.push(component.sort());
  };
  for (const id of [...nodes].sort()) if (!index.has(id)) visit(id);
  return cycles.sort((a, b) => a.join("\0").localeCompare(b.join("\0")));
}

export function reachableFrom(roots: readonly string[], edges: readonly CoverageEdge[]): Set<string> {
  const adjacency = new Map<string, string[]>();
  for (const edge of edges) adjacency.set(edge.from, [...adjacency.get(edge.from) ?? [], edge.to]);
  const seen = new Set<string>(), pending = [...roots];
  while (pending.length) {
    const id = pending.pop()!;
    if (seen.has(id)) continue;
    seen.add(id); pending.push(...adjacency.get(id) ?? []);
  }
  return seen;
}
