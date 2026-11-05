import { validateContentRevisionIntegrity } from "../../content/revisions.js";
import { computeStageReport } from "../../content/stage-engine.js";
import type { StageKey } from "../../content/stage-engine.js";
import { rollUpStageStatuses } from "../../content/stages.js";
import type { StageStatus } from "../../content/stages.js";
import { ADMIN_ROUTES } from "./types.js";
import type { Board, CoverageInput, CoverageReport, Edge, FillState, Finding, Leaf, Node } from "./types.js";
import { inspectReferences } from "./references.js";

const stages = ["define", "assemble", "review", "approve", "publish"] as const;
const compare = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
const slotKey = (id: string) => `publisher:slot/${id}`;
const candidateKey = (id: string) => `publisher:candidate/${id}`;
const formatKey = (id: string) => `publisher:format/${id}`;
const stateRank: FillState[] = ["absent", "draft", "checked", "approved"];
const complete = (value: StageStatus) => value === "Done" || value === "Not applicable";
const unknownRequired = (row: Finding) => ["IA-UNRESOLVED-INPUT", "IA-OUT-OF-SCOPE", "IA-COPY-LOCALE"].includes(row.code) && row.priority === "P1";
const stageMap = (define: StageStatus, other: StageStatus): Record<StageKey, StageStatus> => ({ define, assemble: other, review: other, approve: other, publish: other });

/** Tarjan over actual consumption edges; schema ownership is a separate validated relation. */
function cycles(nodes: Map<string, Node>, edges: readonly Edge[]): string[][] {
  const adjacency = new Map<string, Set<string>>();
  for (const edge of edges) if (edge.kind === "uses" && nodes.get(edge.from)?.registered && nodes.get(edge.to)?.registered)
    (adjacency.get(edge.from) ?? adjacency.set(edge.from, new Set()).get(edge.from)!).add(edge.to);
  const indexes = new Map<string, number>(), low = new Map<string, number>(), stack: string[] = [], onStack = new Set<string>(), result: string[][] = [];
  const visit = (id: string): void => {
    indexes.set(id, indexes.size); low.set(id, indexes.get(id)!); stack.push(id); onStack.add(id);
    for (const next of [...adjacency.get(id) ?? []].sort(compare)) {
      if (!indexes.has(next)) { visit(next); low.set(id, Math.min(low.get(id)!, low.get(next)!)); }
      else if (onStack.has(next)) low.set(id, Math.min(low.get(id)!, indexes.get(next)!));
    }
    if (low.get(id) !== indexes.get(id)) return;
    const group: string[] = []; let next: string;
    do { next = stack.pop()!; onStack.delete(next); group.push(next); } while (next !== id);
    if (group.length > 1 || adjacency.get(id)?.has(id)) result.push(group.sort(compare));
  };
  for (const id of [...nodes.keys()].sort(compare)) if (!indexes.has(id)) visit(id);
  return result.sort((a, b) => compare(a[0]!, b[0]!));
}

/** Observes only supplied/source records. Never fills, changes state, approves or activates. */
export function checkPublisherIACoverage(input: CoverageInput): CoverageReport {
  const findings: Finding[] = [...input.diagnostics ?? []], needs = [...input.needs];
  const finding = (code: string, priority: Finding["priority"], subject: string, message: string, target?: string) => {
    const row = { code, priority, subject, message, ...(target === undefined ? {} : { target }) };
    if (!findings.some(old => old.code === code && old.subject === subject && old.target === target && old.message === message)) findings.push(row);
  };
  const nodes = new Map<string, Node>(), leaves: Leaf[] = [], boards: Board[] = [], edges: Edge[] = [];
  const node = (id: string, pkg: Node["package"], kind: Node["kind"], registered = true): Node => {
    const prior = nodes.get(id);
    if (prior) { prior.registered = false; finding("IA-DUPLICATE", "P0", id, "Identity is registered more than once."); return prior; }
    const value: Node = { id, package: pkg, kind, registered, uses: [], usedBy: [], admin: "unknown" };
    nodes.set(id, value); return value;
  };
  const edge = (from: string, to: string, evidence: string, kind: Edge["kind"] = "uses") => {
    if (!edges.some(old => old.from === from && old.to === to && old.kind === kind && old.evidence === evidence)) edges.push({ from, to, evidence, kind });
  };
  for (const entry of input.designer) node(`designer:${entry.id}`, "designer", "item");
  for (const entry of input.writer) node(`writer:${entry.id}`, "writer", entry.kind);
  for (const entry of input.designer) if (entry.passageSchema) {
    edge(`designer:${entry.id}`, `writer:${entry.passageSchema}`, "Designer section copy schema");
    const schema = input.writer.find(row => row.kind === "schema" && row.id === entry.passageSchema);
    if (schema && schema.sectionId !== entry.id) finding("IA-SCHEMA-OWNER", "P0", `designer:${entry.id}`, "Designer section and Writer schema do not name each other.", `writer:${entry.passageSchema}`);
  }
  for (const entry of input.writer) {
    if (entry.schema) edge(`writer:${entry.id}`, `writer:${entry.schema}`, "Writer passage schema");
    if (entry.sectionId) {
      edge(`writer:${entry.id}`, `designer:${entry.sectionId}`, "Writer schema section owner", "describes");
      const owner = input.designer.find(row => row.id === entry.sectionId);
      if (owner && owner.passageSchema !== entry.id) finding("IA-SCHEMA-OWNER", "P0", `writer:${entry.id}`, "Writer schema and Designer section do not name each other.", `designer:${entry.sectionId}`);
    }
    for (const ref of entry.refs ?? []) edge(`writer:${entry.id}`, `writer:${ref}`, "Writer record reference");
  }
  for (const value of input.edges) edge(value.from, value.to, value.evidence, value.kind);

  const registry = input.registry;
  // The signed membership snapshot has no routes/placement. Do not borrow those from fixtures.
  const declarations = new Set(input.declaredSlots);
  if (declarations.size !== input.declaredSlots.length) finding("IA-DUPLICATE", "P0", "publisher:slots", "Declared slot membership contains duplicate identities.");
  const excluded = registry?.slots.filter(row => !ADMIN_ROUTES.includes(row.route as typeof ADMIN_ROUTES[number])) ?? [];
  const slots = registry?.slots.filter(row => !excluded.includes(row)) ?? [];
  const scopedIds = new Set<string>(slots.map(row => row.id));
  const excludedIds = new Set<string>(excluded.map(row => row.id));
  // Out-of-scope pages are known link targets, never audited/placed as admin leaves.
  for (const value of excluded) node(slotKey(value.id), "publisher", "slot");
  const candidates = registry?.candidates.filter(row => scopedIds.has(row.slotId)) ?? [];
  for (const value of registry?.candidates ?? []) if (!scopedIds.has(value.slotId) && !excludedIds.has(value.slotId)) {
    finding("IA-DANGLING", "P0", candidateKey(value.id), "Candidate has no registered slot.", slotKey(value.slotId));
  }
  for (const id of [...new Set([...declarations, ...scopedIds])].sort(compare)) {
    if (excludedIds.has(id)) continue;
    const entries = slots.filter(row => row.id === id), value = entries[0];
    const base = node(slotKey(id), "publisher", "slot", entries.length === 1);
    if (!value) finding("IA-MISSING-LEAF", "P0", base.id, registry ? "Declared slot is not registered in the supplied snapshot." : "Declared slot has no observed ContentRegistry record; this does not prove host absence.");
    if (entries.length > 1) finding("IA-DUPLICATE", "P0", base.id, "Slot identity is ambiguous.");
    if (value && !declarations.has(id)) finding("IA-OUTSIDE-TREE", "P0", base.id, "Registered slot is outside declared membership.");
    if (value && !input.contentTree.nodes.some(l1 => l1.id === value.l1 && l1.children.some(l2 => l2.id === value.l2)))
      finding("IA-OUTSIDE-TREE", "P0", base.id, "Registered slot placement is outside the declared tree.");
    const leaf: Leaf = { ...base, kind: "slot", path: value ? { l1: value.l1, l2: value.l2 } : null, state: "absent", candidates: [] };
    leaves.push(leaf); nodes.set(leaf.id, leaf);
    for (const candidate of candidates.filter(row => row.slotId === id)) edge(leaf.id, candidateKey(candidate.id), "Slot candidate inventory", "inventory");
    const active = candidates.filter(row => row.slotId === id && row.id === value?.activeCandidateId && row.state === "active");
    if (active.length === 1) edge(leaf.id, candidateKey(active[0]!.id), "Slot selected active candidate");
    if (value?.activeCandidateId && !candidates.some(row => row.id === value.activeCandidateId && row.slotId === id))
      finding("IA-DANGLING", "P0", leaf.id, "Active candidate identity does not resolve within its owning slot.", candidateKey(value.activeCandidateId));
  }
  const treeFormats = new Map<string, { l1: string; l2: string }>();
  for (const l1 of input.formatTree.nodes) for (const l2 of l1.children) for (const id of l2.leaves) {
    if (treeFormats.has(id)) finding("IA-DUPLICATE", "P0", formatKey(id), "Format appears more than once in the tree.");
    treeFormats.set(id, { l1: l1.id, l2: l2.id });
  }
  for (const id of [...new Set([...treeFormats.keys(), ...input.formats.map(row => row.id)])].sort(compare)) {
    const values = input.formats.filter(row => row.id === id), value = values[0], path = treeFormats.get(id) ?? null;
    const base = node(formatKey(id), "publisher", "format", values.length === 1);
    if (!value) finding("IA-MISSING-LEAF", "P0", base.id, "Declared format has no registered definition.");
    if (values.length > 1) finding("IA-DUPLICATE", "P0", base.id, "Format identity is ambiguous.");
    if (value && (!path || value.medium !== path.l1 || value.family !== path.l2)) finding("IA-OUTSIDE-TREE", "P0", base.id, "Format registry placement differs from the tree.");
    // Built/concept are declarations, not executed check or owner approval records.
    const leaf: Leaf = { ...base, kind: "format", path, state: value ? "draft" : "absent" };
    leaves.push(leaf); nodes.set(leaf.id, leaf);
  }
  if (input.formats.length) needs.push("Formats have declarations but no per-format executed/owner approval contract; built never implies checked or approved. ContentRegistry does not bind formats; no format usage is inferred from placement or typeSettings.");

  const localReferences = new Map<string, { path: string; rule: string; message: string }[]>();
  const copy = (from: string, field: { source: string; ref?: { id: string; locale?: string }; locale: string }, evidence: string, expectedSchema?: string): void => {
    if (field.source !== "writer" || !field.ref) { finding("IA-COPY-REF", "P0", from, `${evidence} has no registered Writer CopyRef; legacy inline values are not a resolved connection.`); return; }
    edge(from, `writer:${field.ref.id}`, evidence);
    const record = input.writer.find(row => row.kind === "record" && row.id === field.ref!.id);
    if (record && !record.locales?.includes(field.ref.locale ?? field.locale)) finding("IA-COPY-LOCALE", record.locales ? "P0" : "P1", from, "Copy reference has no observed record in the requested locale.", `writer:${record.id}`);
    if (record?.id.startsWith("ps.") && expectedSchema !== undefined && (!record.schema || record.schema !== expectedSchema))
      finding("IA-COPY-SCHEMA", "P0", from, "Passage record schema does not match the section's declared copy schema.", `writer:${record.id}`);
  };
  for (const candidate of candidates) {
    const id = candidateKey(candidate.id); node(id, "publisher", "candidate");
    const composition = candidate.composition;
    const references = inspectReferences(candidate, input, scopedIds);
    localReferences.set(id, references.findings);
    for (const row of references.findings) finding("IA-COMPOSITION-REFERENCE", "P0", id, `${row.path}: ${row.rule}`);
    for (const row of references.unresolved) {
      if (!nodes.has(row.target)) node(row.target, "publisher", "candidate");
      finding("IA-OUT-OF-SCOPE", "P1", id, row.message, row.target);
    }
    if (composition) {
      edge(id, `designer:${composition.frame.frameId}`, "Candidate frame");
      for (const asset of references.assets) edge(id, `designer:${asset.split(".").slice(0, 2).join(".")}`, "Candidate asset");
      for (const section of references.sections) {
        edge(id, `designer:${section.sectionId}`, `Candidate section ${section.key}`);
        for (const field of section.fields) copy(id, field, `Candidate copy ${section.key}.${field.key}`, input.designer.find(row => row.id === section.sectionId)?.passageSchema ?? "");
        if (section.ref) edge(id, candidateKey(section.ref.candidateId), `Pinned section ${section.ref.sectionKey}@${section.ref.revision}`);
      }
    }
    for (const field of candidate.pageMeta ?? []) copy(id, field, `Candidate page metadata ${field.key}`);
    for (const link of candidate.links) edge(id, slotKey(link.toSlotId), `Content link ${link.relation}`);
  }

  const dangling: CoverageReport["summary"]["dangling"] = [], unresolved: CoverageReport["summary"]["unresolved"] = [];
  for (const value of edges) {
    const from = nodes.get(value.from), to = nodes.get(value.to);
    if (from?.registered && value.kind === "uses") from.uses.push(value.to);
    if (to?.registered && value.kind === "uses") to.usedBy.push(value.from);
    if (from?.registered && to?.registered) continue;
    const missing = !from?.registered ? value.from : value.to;
    const unavailable = input.unavailable.some(pkg => missing.startsWith(`${pkg}:`));
    const list = unavailable ? unresolved : dangling;
    if (!list.some(old => old.from === value.from && old.to === value.to)) list.push({ from: value.from, to: value.to });
    finding(unavailable ? "IA-UNRESOLVED-INPUT" : "IA-DANGLING", unavailable ? "P1" : "P0", value.from,
      unavailable ? "Referenced package input is unavailable; resolution is unknown." : "Reference does not resolve to exactly one registered identity.", value.to);
  }
  const components = cycles(nodes, edges);
  for (const group of components) finding("IA-CYCLE", "P1", group[0]!, "Consumption cycle group: " + group.join(", "));
  const roots = ["designer:frames.app-shell", ...slots.filter(row => row.route !== undefined && ADMIN_ROUTES.includes(row.route as typeof ADMIN_ROUTES[number])).map(row => slotKey(row.id))];
  const reachable = new Set<string>(), pending = [...roots];
  while (pending.length) {
    const id = pending.pop()!; if (reachable.has(id) || !nodes.get(id)?.registered) continue;
    reachable.add(id); pending.push(...nodes.get(id)!.uses);
  }
  const adminComplete = input.unavailable.length === 0 && !findings.some(row => reachable.has(row.subject) && (row.priority === "P0" || unknownRequired(row))) && ADMIN_ROUTES.every(route => {
    const owners = slots.filter(row => row.route === route), owner = owners[0];
    const active = candidates.filter(candidate => candidate.slotId === owner?.id && candidate.id === owner?.activeCandidateId && candidate.state === "active");
    return owners.length === 1 && active.length === 1 && !!active[0]!.composition && validateContentRevisionIntegrity(active[0]!).length === 0 && (localReferences.get(candidateKey(active[0]!.id))?.length ?? 0) === 0;
  });
  if (!adminComplete) needs.push("All three admin page compositions were not observed; non-reachable items are unknown, not proven unused by the host.");
  for (const value of nodes.values()) {
    value.uses = [...new Set(value.uses)].sort(compare); value.usedBy = [...new Set(value.usedBy)].sort(compare);
    value.admin = reachable.has(value.id) ? "reachable" : adminComplete ? "unreachable" : "unknown";
  }
  for (const leaf of leaves.filter(row => row.kind === "slot")) {
    const current = candidates.filter(row => slotKey(row.slotId) === leaf.id && row.state !== "retired");
    const observations = current.map(candidate => {
      const id = candidateKey(candidate.id), integrity = validateContentRevisionIntegrity(candidate), proofs = input.evidence.filter(row => row.candidateId === candidate.id);
      for (const row of integrity) finding("IA-REVISION-INTEGRITY", "P0", id, `${row.path}: ${row.rule}`);
      if (proofs.length > 1) finding("IA-EVIDENCE-IDENTITY", "P0", id, "Exactly one current evidence record is permitted.");
      let statuses = stageMap("Failing", "Waiting");
      let state: FillState = "draft";
      if (!integrity.length && proofs.length <= 1) {
        const report = computeStageReport(candidate, proofs[0]);
        statuses = Object.fromEntries(stages.map(key => [key, report.stages[key].status])) as Record<StageKey, StageStatus>;
        const descendants = new Set<string>(), queue = [id];
        while (queue.length) { const current = queue.pop()!; if (descendants.has(current)) continue; descendants.add(current); queue.push(...nodes.get(current)?.uses ?? []); }
        const unknown = findings.some(row => descendants.has(row.subject) && unknownRequired(row));
        const blocked = unknown || (localReferences.get(id)?.length ?? 0) > 0 || findings.some(row => descendants.has(row.subject) && row.priority === "P0") || components.some(group => group.some(member => descendants.has(member)));
        if (blocked) { statuses.assemble = unknown ? rollUpStageStatuses([statuses.assemble, "Needs input"]) : "Failing"; for (const key of ["review", "approve", "publish"] as const) if (complete(statuses[key])) statuses[key] = "Waiting"; }
        if (!leaf.registered || findings.some(row => row.subject === leaf.id && row.priority === "P0")) {
          statuses.define = "Failing";
          for (const key of ["review", "approve", "publish"] as const) if (complete(statuses[key])) statuses[key] = "Waiting";
        }
        if (!blocked && proofs.length === 1 && stages.slice(0, 3).every(key => complete(statuses[key]))) {
          state = "checked";
          if (statuses.approve === "Done" && candidate.approval?.source === "owner") state = "approved";
        }
      }
      return { id, state, statuses };
    });
    leaf.candidates = observations.map(row => row.id).sort(compare);
    leaf.state = observations.length ? stateRank[Math.min(...observations.map(row => stateRank.indexOf(row.state)))]! : "absent";
    leaf.stages = Object.fromEntries(stages.map(key => [key, observations.length ? rollUpStageStatuses(observations.map(row => row.statuses[key])) : key === "define" ? "Needs input" : "Waiting"])) as Record<StageKey, StageStatus>;
  }
  for (const value of nodes.values()) {
    const ownedCandidate = value.kind === "candidate" && edges.some(row => row.kind === "inventory" && row.to === value.id && nodes.get(row.from)?.registered);
    if (value.registered && value.usedBy.length === 0 && !roots.includes(value.id) && !ownedCandidate && !excluded.some(row => slotKey(row.id) === value.id))
      finding("IA-ORPHAN", "P2", value.id, "No consumer is recorded in the observed graph; this is not proof of no host usage.");
  }
  for (const leaf of leaves) if (leaf.state === "absent") finding("IA-UNFILLED", leaf.admin === "reachable" ? "P1" : "P2", leaf.id, "No current fill/candidate was observed in the supplied inputs.");
  const unplaced = leaves.filter(row => row.path === null).map(row => row.id).sort(compare);
  const buildBoards = (layer: Board["layer"], tree: { nodes: readonly { id: string; children: readonly { id: string }[] }[] }) => {
    const own = leaves.filter(row => row.kind === (layer === "slots" ? "slot" : "format"));
    const addBoard = (id: string, level: Board["level"], values: Leaf[]) => boards.push({ id, layer, level, registeredLeaves: values.filter(row => row.registered).length, declaredLeaves: values.length, placementComplete: layer === "formats" || own.every(row => row.path !== null) });
    addBoard(layer, "L0", own);
    for (const l1 of tree.nodes) {
      addBoard(`${layer}:${l1.id}`, "L1", own.filter(row => row.path?.l1 === l1.id));
      for (const l2 of l1.children) addBoard(`${layer}:${l1.id}/${l2.id}`, "L2", own.filter(row => row.path?.l1 === l1.id && row.path.l2 === l2.id));
    }
  };
  buildBoards("slots", input.contentTree); buildBoards("formats", input.formatTree);
  const boardIds = new Set<string>();
  for (const board of boards) {
    if (boardIds.has(board.id)) finding("IA-DUPLICATE", "P0", board.id, "IA group identity is declared more than once.");
    boardIds.add(board.id);
  }
  const layerSummary = (layer: Board["layer"]) => {
    const own = leaves.filter(row => row.kind === (layer === "slots" ? "slot" : "format"));
    return { L0: boards.filter(row => row.layer === layer && row.level === "L0").length, L1: boards.filter(row => row.layer === layer && row.level === "L1").length,
      L2: boards.filter(row => row.layer === layer && row.level === "L2").length, L3: own.length, registered: own.filter(row => row.registered).length,
      states: Object.fromEntries(stateRank.map(state => [state, own.filter(row => row.state === state).length])) as Record<FillState, number> };
  };
  const orderedNodes = [...nodes.values()].sort((a, b) => compare(a.id, b.id));
  const summary: CoverageReport["summary"] = {
    levels: { L0: boards.filter(row => row.level === "L0").length, L1: boards.filter(row => row.level === "L1").length, L2: boards.filter(row => row.level === "L2").length, L3: leaves.length },
    registered: leaves.filter(row => row.registered).length,
    states: Object.fromEntries(stateRank.map(state => [state, leaves.filter(row => row.state === state).length])) as Record<FillState, number>,
    layers: { slots: layerSummary("slots"), formats: layerSummary("formats") }, dangling, unresolved, cycles: components,
    orphans: findings.filter(row => row.code === "IA-ORPHAN").map(row => row.subject).sort(compare), unplaced,
    priorities: { P0: findings.filter(row => row.priority === "P0").length, P1: findings.filter(row => row.priority === "P1").length, P2: findings.filter(row => row.priority === "P2").length },
    admin: { reachable: orderedNodes.filter(row => row.admin === "reachable").length, unreachable: orderedNodes.filter(row => row.admin === "unreachable").length, unknown: orderedNodes.filter(row => row.admin === "unknown").length },
    excludedSlots: excluded.map(row => row.id).sort(compare),
  };
  return { schemaVersion: 1, kind: "publisher-ia-coverage", basis: { registryObserved: registry !== undefined, adminInputsComplete: adminComplete,
    connections: "Explicit candidate/record references and reported Designer uses; permissions are not inferred consumption.", needs: [...new Set(needs)].sort(compare), inputHashes: input.inputHashes ?? {}, scope: ADMIN_ROUTES },
    boards, leaves: leaves.sort((a, b) => compare(a.id, b.id)), nodes: orderedNodes,
    edges: edges.sort((a, b) => compare(JSON.stringify(a), JSON.stringify(b))), findings: findings.sort((a, b) => compare(JSON.stringify(a), JSON.stringify(b))), summary };
}
