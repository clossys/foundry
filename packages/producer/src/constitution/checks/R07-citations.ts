/**
 * R07 Slot dependencies and cascade, over every candidate and pin of every slot:
 * - R07.1 every slot a candidate cites (source.ref, composition parts, version cites, Publisher
 *   frame/sections/copy, `@/` imports by install path) is in its slot's dependency set
 *   (slot.json `inputs` ∪ `uses`);
 * - R07.2 no citation carries a version (`<slot>@<n>`);
 * - R07.3 pin.json has no `recited` key;
 * - R07.4 the dependency graph of the live slots is acyclic (Tarjan) and only points upstream
 *   (director → designer/writer → publisher; Producer seats are outside the graph).
 * R07.5 cascade by certification key: every pinned candidate's recorded verdict holds for the pinSet now, or
 *   its slot is marked needs-refresh (../cascade.ts staleRows; loop.cascade re-verdicts).
 * R07.6 frame regions are composed, never inlined: ../rules/r07.ts.
 */
import type { ConstitutionContext, Row, RuleModule, SlotRecord } from "../types.js";
import { frameRegions } from "../rules/r07.js";
import { staleRows } from "../cascade.js";
import { allSlots, candidateCitations, dependencySet, installOwners, isObject, listed, liveSlotRecords, row, slotHomes, versionCites } from "./shared.js";

export function undeclaredCitations(ctx: ConstitutionContext): Row[] {
  const homes = slotHomes(ctx);
  const owners = installOwners(ctx);
  const rows: Row[] = [];
  for (const slot of allSlots(ctx)) {
    if (slot.agent === "producer") continue;
    const deps = dependencySet(slot) ?? new Set<string>();
    for (const candidate of slot.candidates) {
      const undeclared = candidateCitations(slot, candidate, homes, owners).filter(cite => !cite.slots.some(target => deps.has(target)));
      if (!undeclared.length) continue;
      const named = [...new Set(undeclared.map(cite => `${cite.slots.join("|")} (${cite.via})`))].sort();
      const why = dependencySet(slot) ? "not in slot.json inputs/uses" : "slot has no readable slot.json";
      rows.push(row("R07", "R07.1", slot, `cites ${named.length} slot${named.length === 1 ? "" : "s"} ${why}: ${listed(named, 3)}`, candidate.path, candidate.name));
    }
  }
  return rows;
}

export function versionCitations(ctx: ConstitutionContext): Row[] {
  const homes = slotHomes(ctx);
  const rows: Row[] = [];
  for (const slot of allSlots(ctx)) for (const candidate of slot.candidates) {
    const cites = versionCites(candidate.text, homes).filter(cite => cite.slot !== slot.id);
    if (!cites.length) continue;
    rows.push(row("R07", "R07.2", slot, `${cites.length} version citation${cites.length === 1 ? "" : "s"}: ${listed([...new Set(cites.map(cite => cite.text))].sort(), 3)}`, candidate.path, candidate.name));
  }
  return rows;
}

export function recitedPins(ctx: ConstitutionContext): Row[] {
  const rows: Row[] = [];
  for (const slot of allSlots(ctx)) {
    const pin = slot.pin?.value;
    if (isObject(pin) && Object.hasOwn(pin, "recited")) rows.push(row("R07", "R07.3", slot, "pin.json carries recited (citations resolve through the cited pin)", slot.pin!.path));
  }
  return rows;
}

const RANK: Readonly<Record<string, number>> = { director: 0, designer: 1, writer: 1, publisher: 2 };

/** Strongly connected components with more than one member, or a self-loop (Tarjan, iterative). */
export function cycles(graph: ReadonlyMap<string, readonly string[]>): string[][] {
  let index = 0;
  const indices = new Map<string, number>(), low = new Map<string, number>(), onStack = new Set<string>(), stack: string[] = [];
  const found: string[][] = [];
  for (const start of [...graph.keys()].sort()) {
    if (indices.has(start)) continue;
    const work: { node: string; edge: number }[] = [{ node: start, edge: 0 }];
    indices.set(start, index); low.set(start, index); index++; stack.push(start); onStack.add(start);
    while (work.length) {
      const frame = work[work.length - 1]!;
      const edges = graph.get(frame.node) ?? [];
      if (frame.edge < edges.length) {
        const next = edges[frame.edge++]!;
        if (!graph.has(next)) continue;
        if (!indices.has(next)) {
          indices.set(next, index); low.set(next, index); index++; stack.push(next); onStack.add(next);
          work.push({ node: next, edge: 0 });
        } else if (onStack.has(next)) low.set(frame.node, Math.min(low.get(frame.node)!, indices.get(next)!));
        continue;
      }
      work.pop();
      const parent = work[work.length - 1];
      if (parent) low.set(parent.node, Math.min(low.get(parent.node)!, low.get(frame.node)!));
      if (low.get(frame.node) === indices.get(frame.node)) {
        const component: string[] = [];
        let member: string;
        do { member = stack.pop()!; onStack.delete(member); component.push(member); } while (member !== frame.node);
        if (component.length > 1 || (graph.get(frame.node) ?? []).includes(frame.node)) found.push(component.sort());
      }
    }
  }
  return found;
}

export function acyclicUpstream(ctx: ConstitutionContext): Row[] {
  const live = new Map<string, SlotRecord>();
  for (const slot of liveSlotRecords(ctx)) if (slot.agent !== "producer" && !live.has(slot.id)) live.set(slot.id, slot);
  const graph = new Map<string, string[]>();
  for (const [id, slot] of live) graph.set(id, [...(dependencySet(slot) ?? [])].sort());
  const rows: Row[] = [];
  for (const component of cycles(graph)) for (const id of component) {
    const slot = live.get(id)!;
    rows.push(row("R07", "R07.4", slot, `dependency cycle: ${listed(component, 6)}`, slot.slot?.path ?? slot.dir));
  }
  for (const [id, deps] of graph) {
    const slot = live.get(id)!;
    const downstream = deps.filter(dep => live.has(dep) && RANK[live.get(dep)!.agent]! > RANK[slot.agent]!);
    if (downstream.length) rows.push(row("R07", "R07.4", slot, `depends downstream on ${listed(downstream.map(dep => `${live.get(dep)!.agent}:${dep}`))}`, slot.slot?.path ?? slot.dir));
  }
  return rows;
}

export const R07: RuleModule = {
  rule: "R07",
  checks: {
    "R07.1": undeclaredCitations,
    "R07.2": versionCitations,
    "R07.3": recitedPins,
    "R07.4": acyclicUpstream,
    "R07.5": staleRows,
    "R07.6": frameRegions,
  },
};
