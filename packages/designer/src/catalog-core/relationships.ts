import { allFills, choose, resolve, type EngineInput } from "./resolve.js";
import { compare, flatten, leafOf, metaOf, references } from "./model.js";
import { originOf } from "./library.js";
export interface ConsumptionLeaf { id: string; themes: readonly string[]; assets: readonly string[]; consumedBy: readonly string[]; resolved: number; total: number }
export interface ConsumptionReport {
  leaves: readonly ConsumptionLeaf[];
  orphans: readonly { from: string; target: string }[];
  counts: { themes: number; assets: number; themeEdges: number; assetEdges: number; resolvedMembers: number; members: number; orphanEdges: number; unusedThemes: number; unusedAssets: number };
}
/** Generated from materialized consumer fills; no hand-maintained usage counters. */
export function consumptionReport(input: EngineInput): ConsumptionReport {
  const resolved = resolve(input); const selected = choose(input).chosen; const entries = new Map(input.catalog.slots.map(slot => [slot.id, { id: slot.id, themes: new Set<string>(), assets: new Set<string>(), consumedBy: new Set<string>(), resolved: 0, members: new Set<string>(slot.contract.members.mode === "closed" ? slot.contract.members.names.map(name => `${slot.id}.${name}`) : (slot.contract.members.required ?? []).map(name => `${slot.id}.${name}`)) }]));
  const orphans: { from: string; target: string }[] = [];
  for (const fill of allFills(input)) {
    const meta = metaOf(fill); const entry = entries.get(meta.slot); if (!entry) continue;
    const members = flatten(fill);
    Object.keys(members).forEach(id => entry.members.add(id));
    if (!Object.values(selected).some(member => member.fill === fill)) continue;
    const reads = new Set([...(meta.reads?.themes ?? []), ...(meta.reads?.assets ?? []), ...Object.values(members).flatMap(token => {
      const origin = originOf(token);
      return [...references(token).map(leafOf), ...(origin?.kind === "composed" && Array.isArray(origin.reads) ? origin.reads.filter((read): read is string => typeof read === "string") : [])];
    })]);
    for (const target of reads) {
      const dest = entries.get(target);
      if (!dest) orphans.push({ from: meta.slot, target });
      else { (target.startsWith("themes.") ? entry.themes : entry.assets).add(target); dest.consumedBy.add(meta.slot); }
    }
  }
  for (const member of Object.values(resolved.members)) { const entry = entries.get(member.slot); if (entry) entry.resolved++; }
  const leaves = [...entries.values()].sort((a, b) => compare(a.id, b.id)).map(entry => ({ id: entry.id, themes: [...entry.themes].sort(compare), assets: [...entry.assets].sort(compare), consumedBy: [...entry.consumedBy].sort(compare), resolved: entry.resolved, total: entry.members.size }));
  const uniqueOrphans = [...new Map(orphans.map(edge => [`${edge.from}/${edge.target}`, edge])).values()].sort((a, b) => compare(a.from, b.from) || compare(a.target, b.target));
  return { leaves, orphans: uniqueOrphans, counts: { themes: leaves.filter(l => l.id.startsWith("themes.")).length, assets: leaves.filter(l => l.id.startsWith("assets.")).length, themeEdges: leaves.reduce((n, l) => n + l.themes.length, 0), assetEdges: leaves.reduce((n, l) => n + l.assets.length, 0), resolvedMembers: Object.keys(resolved.members).length, members: leaves.reduce((n, l) => n + l.total, 0), orphanEdges: uniqueOrphans.length, unusedThemes: leaves.filter(l => l.id.startsWith("themes.") && l.consumedBy.length === 0).length, unusedAssets: leaves.filter(l => l.id.startsWith("assets.") && l.consumedBy.length === 0).length } };
}
