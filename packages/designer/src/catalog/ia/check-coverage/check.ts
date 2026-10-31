import { checkIAPlacement } from "../../../catalog-core/ia-placement.js";
import type { Board, CoverageInput, CoverageReport, Fill, FillState, Finding, Layer, Leaf } from "./types.js";
export const LAYERS: readonly Layer[] = ["themes", "assets", "components", "sections", "frames"];
const sorted = (items: Iterable<string>): string[] => [...new Set(items)].sort();
const states = (): Record<FillState, number> => ({ absent: 0, draft: 0, checked: 0, approved: 0 });

/** Metadata labels/evidence declarations never count as execution. Each result binds exact fill bytes. */
function stateOf(fills: readonly Fill[]): FillState {
  if (!fills.length) return "absent";
  let state: FillState = "draft";
  for (const fill of fills) {
    const checks = fill.checks?.filter(check => check.sourceHash === fill.hash && /^sha256:[a-f0-9]{64}$/.test(check.sourceHash)) ?? [];
    if (!checks.length || checks.some(check => !check.results.length || check.results.some(result => typeof result.code !== "string" || !result.code.trim() || result.passed !== true))) continue;
    const signoff = fill.signoff;
    if (signoff?.by === "owner" && /^\d{4}-\d{2}-\d{2}$/.test(signoff.date) && Number.isFinite(Date.parse(signoff.date)) && signoff.ref.trim()) return "approved";
    state = "checked";
  }
  return state;
}

/** Strongly connected components: one finding per cycle, rather than one per traversal path. */
function cyclesOf(nodes: Iterable<string>, next: Map<string, Set<string>>): string[][] {
  let index = 0;
  const order = new Map<string, number>(), low = new Map<string, number>();
  const stack: string[] = [], active = new Set<string>(), cycles: string[][] = [];
  const visit = (id: string): void => {
    order.set(id, index); low.set(id, index++); stack.push(id); active.add(id);
    for (const target of sorted(next.get(id) ?? [])) {
      if (!order.has(target)) { visit(target); low.set(id, Math.min(low.get(id)!, low.get(target)!)); }
      else if (active.has(target)) low.set(id, Math.min(low.get(id)!, order.get(target)!));
    }
    if (low.get(id) !== order.get(id)) return;
    const group: string[] = [];
    for (;;) { const item = stack.pop()!; active.delete(item); group.push(item); if (item === id) break; }
    if (group.length > 1 || next.get(id)?.has(id)) cycles.push(group.sort());
  };
  for (const id of sorted(nodes)) if (!order.has(id)) visit(id);
  return cycles.sort((a, b) => a.join().localeCompare(b.join()));
}

/** Pure, bottom-up completeness projection. It never mutates, fills, approves or regroups inputs. */
export function checkCoverage(input: CoverageInput): CoverageReport {
  const findings: Finding[] = [...input.diagnostics ?? []], boards: Board[] = [];
  const dangling = new Map<string, { from: string; to: string }>();
  const add = (code: string, priority: Finding["priority"], subject: string, message: string, target?: string): void => {
    findings.push({ code, priority, subject, ...(target === undefined ? {} : { target }), message });
    if ((code === "IA-DANGLING-REF" || code === "IA-DANGLING-FILL") && target !== undefined) dangling.set(JSON.stringify([subject, target]), { from: subject, to: target });
  };
  const slots = new Map(input.slots.map(slot => [slot.id, slot]));
  for (const id of sorted(input.slots.map(slot => slot.id))) if (input.slots.filter(slot => slot.id === id).length > 1) add("IA-DUPLICATE-ENTRY", "P0", id, "Registry id is duplicated.");
  const paths = new Map<string, { l1: string; l2: string }>(), declared = new Set<string>();
  for (const placement of input.placements) if (!placement || !LAYERS.includes(placement.layer)) add("IA-STRUCTURE", "P0", "placement", "IA declares an unknown L0 layer.");
  for (const layer of LAYERS) {
    const placements = input.placements.filter(row => row?.layer === layer);
    if (placements.length !== 1) add("IA-LAYER-BOARD", "P0", layer, "Exactly one L0 board is required for this layer.");
    for (const placement of placements) {
      for (const finding of checkIAPlacement(placement)) add("IA-STRUCTURE", "P0", finding.subject, finding.message);
      if (!Array.isArray(placement.nodes)) continue;
      const groups = new Set<string>(), layerLeaves: string[] = [];
      for (const group of placement.nodes) {
        if (!group || typeof group.id !== "string" || !Array.isArray(group.children)) continue;
        groups.add(group.id);
        const groupLeaves: string[] = [];
        for (const family of group.children) {
          if (!family || typeof family.id !== "string" || !Array.isArray(family.leaves)) continue;
          groups.add(family.id);
          const leaves = family.leaves.filter((id: unknown): id is string => typeof id === "string");
          for (const id of leaves) {
            if (declared.has(id)) add("IA-DUPLICATE-LEAF", "P0", id, "Leaf appears more than once in the declared tree.");
            declared.add(id); paths.set(id, { l1: group.id, l2: family.id });
            if (!slots.has(id)) add("IA-MISSING-LEAF", "P0", id, "Declared L3 leaf has no registered entry.");
            else if (slots.get(id)!.layer !== layer) add("IA-LEAF-LAYER", "P0", id, "Registry and tree disagree about the layer.");
          }
          groupLeaves.push(...leaves);
          boards.push({ id: `${layer}:${family.id}`, layer, level: "L2", declaredLeaves: leaves.length, registeredLeaves: leaves.filter(id => slots.has(id)).length });
        }
        layerLeaves.push(...groupLeaves);
        boards.push({ id: `${layer}:${group.id}`, layer, level: "L1", declaredLeaves: groupLeaves.length, registeredLeaves: groupLeaves.filter(id => slots.has(id)).length });
      }
      boards.push({ id: layer, layer, level: "L0", declaredLeaves: layerLeaves.length, registeredLeaves: layerLeaves.filter(id => slots.has(id)).length });
      for (const reference of Array.isArray(placement.crossReferences) ? placement.crossReferences : []) {
        if (!reference || !Array.isArray(reference.leaves)) continue;
        if (!groups.has(reference.node)) continue; // checkIAPlacement already reports this structural fault.
        for (const id of reference.leaves) if (!slots.has(id)) add("IA-DANGLING-REF", "P0", `${layer}:${reference.node}`, "IA cross-reference has no registered endpoint.", id);
      }
    }
  }
  for (const id of sorted(slots.keys())) if (!declared.has(id)) add("IA-UNPLACED-LEAF", "P0", id, "Registered leaf is outside the IA tree.");
  for (const fill of input.fills) if (!slots.has(fill.leaf)) add("IA-DANGLING-FILL", "P0", fill.id, "Fill targets an unregistered leaf.", fill.leaf);
  const external = [...input.external ?? []].sort((a, b) => a.id.localeCompare(b.id));
  const known = new Set([...slots.keys(), ...external.map(node => node.id)]);
  const edges = [...new Map(input.edges.map(edge => [JSON.stringify([edge.from, edge.to, edge.kind ?? "consumes", edge.evidence]), edge])).values()]
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  const uses = new Map<string, Set<string>>(), usedBy = new Map<string, Set<string>>();
  for (const root of sorted(input.adminRoots)) if (!known.has(root)) add("IA-DANGLING-REF", "P0", "admin", "Admin root has no registered endpoint.", root);
  const unresolved: { from: string; to: string }[] = [];
  for (const edge of edges) {
    if (!known.has(edge.from) || !known.has(edge.to)) {
      if (input.unavailablePackages?.some(pkg => (!known.has(edge.to) && edge.to.startsWith(`${pkg}:`)) || (!known.has(edge.from) && edge.from.startsWith(`${pkg}:`)))) {
        if (!unresolved.some(row => row.from === edge.from && row.to === edge.to)) unresolved.push({ from: edge.from, to: edge.to });
        continue;
      }
      const key = JSON.stringify([edge.from, edge.to]);
      if (!dangling.has(key)) { dangling.set(key, { from: edge.from, to: edge.to }); add("IA-DANGLING-REF", "P0", edge.from, "Connection has an unregistered endpoint.", edge.to); }
      continue;
    }
    if (edge.kind === "describes") continue;
    if (!uses.has(edge.from)) uses.set(edge.from, new Set()); uses.get(edge.from)!.add(edge.to);
    if (!usedBy.has(edge.to)) usedBy.set(edge.to, new Set()); usedBy.get(edge.to)!.add(edge.from);
  }
  const reachable = new Set<string>(), queue = [...input.adminRoots];
  for (let at = 0; at < queue.length; at++) {
    const id = queue[at]!;
    if (!known.has(id) || reachable.has(id)) continue;
    reachable.add(id); queue.push(...uses.get(id) ?? []);
  }
  const leaves: Leaf[] = sorted(new Set([...declared, ...slots.keys()])).map(id => {
    const fills = input.fills.filter(fill => fill.leaf === id);
    const row: Leaf = { id, layer: (slots.get(id)?.layer ?? id.split(".")[0]) as Layer, path: paths.get(id) ?? null,
      registered: slots.has(id), state: stateOf(fills), fills: sorted(fills.map(fill => fill.id)), uses: sorted(edges.filter(edge => edge.from === id && edge.kind !== "describes").map(edge => edge.to)), usedBy: sorted(usedBy.get(id) ?? []),
      admin: reachable.has(id) ? "reachable" : input.adminInputsComplete ? "unreachable" : "unknown" };
    if (row.registered) {
      if (!row.usedBy.length) add("IA-ORPHAN", "P2", id, "No consumer in the supplied connection graph; absent inputs remain explicit Needs.");
      if (row.state === "absent") add("IA-UNFILLED", row.admin === "unreachable" ? "P2" : "P1", id, `Leaf has no fill; admin reachability is ${row.admin}.`);
    }
    return row;
  });
  const cycles = cyclesOf(known, uses);
  for (const group of cycles) add("IA-CYCLE", "P1", group[0]!, `Directed consumption cycle: ${group.join(" -> ")}`);
  const layers = Object.fromEntries(LAYERS.map(layer => {
    const rows = leaves.filter(row => row.layer === layer), counts = states();
    for (const row of rows) counts[row.state]++;
    return [layer, { L0: boards.filter(board => board.layer === layer && board.level === "L0").length,
      L1: boards.filter(board => board.layer === layer && board.level === "L1").length, L2: boards.filter(board => board.layer === layer && board.level === "L2").length,
      L3: rows.filter(row => row.path !== null).length, registered: rows.filter(row => row.registered).length, states: counts }];
  })) as CoverageReport["summary"]["layers"];
  const summary: CoverageReport["summary"] = { levels: { L0: 0, L1: 0, L2: 0, L3: 0 }, states: states(), layers, priorities: { P0: 0, P1: 0, P2: 0 },
    dangling: [...dangling.values()], unresolved, orphans: leaves.filter(row => row.registered && !row.usedBy.length).map(row => row.id), cycles,
    admin: { reachable: 0, unreachable: 0, unknown: 0 } };
  for (const layer of LAYERS) for (const level of ["L0", "L1", "L2", "L3"] as const) summary.levels[level] += layers[layer][level];
  for (const row of leaves) { summary.states[row.state]++; summary.admin[row.admin]++; }
  const unique = [...new Map(findings.map(finding => [JSON.stringify(finding), finding])).values()]
    .sort((a, b) => a.priority.localeCompare(b.priority) || a.code.localeCompare(b.code) || a.subject.localeCompare(b.subject) || (a.target ?? "").localeCompare(b.target ?? ""));
  for (const finding of unique) summary.priorities[finding.priority]++;
  return { schemaVersion: 1, basis: { connections: "declared-and-reported", adminInputsComplete: input.adminInputsComplete, needs: sorted(input.needs ?? []) },
    boards, leaves, external, edges, findings: unique, summary };
}
