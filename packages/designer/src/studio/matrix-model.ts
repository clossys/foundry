import { isPrefixOf, type CatalogData, type ChangeSet, type Finding, type LibraryData, type Placement, type PlacementNode, type LayerId, type Tier } from "../catalog-core/index.js";
import { studioEngine, type StudioEngine } from "./engine.js";
import { evaluationFor, type StudioEvaluation } from "./evaluation.js";
import { allNodes, buildCandidates, currentConsumerCandidate, buildSlotTree, nodeKey, scopeTargets, type Candidate, type Scope, type SlotTreeNode } from "./model.js";

type Input = { catalog: CatalogData; library: LibraryData; working: LibraryData; engine?: StudioEngine; cache?: Map<string, Candidate[]>; evaluation?: StudioEvaluation };
export interface MatrixRow {
  id: string; label: string; scope: Scope; target: string; leaves: readonly string[]; depth: number;
  tier?: Tier; emphasized: boolean; basket: "node" | "leaf"; candidates: readonly Candidate[];
  /** False means alternatives have not been requested; the current consumer selection may already be projected. */
  candidatesReady?: boolean;
}

/** Placement fields are additive presentation hints; the catalog's contracts remain unchanged. */
const basketOf = (node: PlacementNode): "node" | "leaf" => (node as PlacementNode & { basket?: unknown }).basket === "leaf" ? "leaf" : "node";

/** The layer belongs in the header, so only its placement nodes reach the explorer. */
export const purePlacementTree = (placements: readonly Placement[]): SlotTreeNode[] => buildSlotTree(placements).flatMap(layer => layer.children ?? []);

export function matrixSources({ catalog, library }: Pick<Input, "catalog" | "library">): string[] {
  const rank = (source: string): number => source === library.source.id ? 0 : source === "foundry" ? 1 : 2;
  const slots = new Set(catalog.slots.map(slot => slot.id));
  return [...new Set([library.source.id, ...catalog.sources.map(source => source.id), ...[...catalog.fills, ...library.fills].filter(doc => slots.has(doc.$extensions["com.clossys.fill"].slot)).map(doc => doc.$extensions["com.clossys.fill"].source)])]
    .sort((a, b) => rank(a) - rank(b) || (a < b ? -1 : a > b ? 1 : 0));
}

/** Cache lifetime is one immutable working selection in one Studio instance. Engine inputs never change underneath it. */
function candidatesAt(input: Input, scope: Scope, target: string, slotId: string): Candidate[] {
  const key = JSON.stringify([scope, target, slotId]);
  const cached = input.cache?.get(key);
  if (cached) return cached;
  const candidates = buildCandidates({ ...input, slotId, scope, target });
  input.cache?.set(key, candidates);
  return candidates;
}

/** Group choices expand through the existing leaf-pick helper; no matrix row is a new stored scope. */
export function matrixRows(input: Input & { changes: ChangeSet; expanded: ReadonlySet<string>; placements?: readonly Placement[]; nodeId?: string; leafId?: string; evaluateRows?: ReadonlySet<string> }): MatrixRow[] {
  input = { ...input, evaluation: evaluationFor(input) };
  const { catalog, library, working, expanded } = input;
  const rows: MatrixRow[] = [];
  const branch = input.nodeId ? allNodes(catalog.placements).find(node => node.id === input.nodeId) : undefined;
  const allowed = input.leafId ? new Set([input.leafId]) : branch ? new Set(branch.leaves) : undefined;
  let index = 0;
  const requested = (id: string): boolean => input.evaluateRows === undefined || input.evaluateRows.has(id);
  const candidatesFor = (scope: Scope, target: string, leaves: readonly string[]): Candidate[] => {
    if (!requested(target)) {
      if (scope !== "slot") return [];
      const current = currentConsumerCandidate({ ...input, scope, target, slotId: target });
      return current ? [{ ...current, index: index++ }] : [];
    }
    const bySource = new Map<string, Candidate>();
    const representatives = scope === "node" ? [...new Set(matrixSources(input).flatMap(source => {
      const doc = [...catalog.fills, ...library.fills].find(doc => doc.$extensions["com.clossys.fill"].source === source && leaves.includes(doc.$extensions["com.clossys.fill"].slot));
      return doc ? [doc.$extensions["com.clossys.fill"].slot] : [];
    }))] : leaves;
    for (const slotId of representatives) {
      for (const candidate of candidatesAt(input, scope, target, slotId)) {
        if (!bySource.has(candidate.source)) bySource.set(candidate.source, candidate);
      }
    }
    return matrixSources(input).flatMap(source => {
      const candidate = bySource.get(source);
      if (!candidate) return [];
      const members = scope === "member" ? candidate.members.filter(member => member.id === target) : candidate.members;
      return [{ ...candidate, index: index++, members, resolved: { ...candidate.resolved, members: Object.fromEntries(members.map(member => [member.id, member.member])) } }];
    });
  };
  const leaf = (id: string, depth: number, basket: "node" | "leaf"): void => {
    if (allowed && !allowed.has(id)) return;
    const slot = catalog.slots.find(slot => slot.id === id);
    if (!slot) return;
    rows.push({ id, label: id, scope: "slot", target: id, leaves: [id], depth, ...(slot.contract.kind === "token" ? { tier: slot.contract.tier } : {}), basket, emphasized: basket === "leaf", candidatesReady: requested(id), candidates: candidatesFor("slot", id, [id]) });
    if (expanded.has(id)) for (const member of scopeTargets({ catalog, library, slotId: id, scope: "member" })) {
      rows.push({ id: member, label: member, scope: "member", target: member, leaves: [id], depth: depth + 1, basket, emphasized: false, candidatesReady: requested(member), candidates: candidatesFor("member", member, [id]) });
    }
  };
  const visit = (layer: string, node: PlacementNode, depth: number): void => {
    const id = nodeKey(layer, node.id);
    const leaves = allNodes(catalog.placements).find(branch => branch.id === id)?.leaves.filter(leaf => !allowed || allowed.has(leaf)) ?? [];
    if (leaves.length === 0) return;
    if (!input.leafId) rows.push({ id, label: node.label, scope: "node", target: id, leaves, depth, basket: basketOf(node), emphasized: basketOf(node) === "node", candidatesReady: requested(id), candidates: candidatesFor("node", id, leaves) });
    if ("children" in node) node.children.forEach(child => visit(layer, child, depth + 1));
    else node.leaves.forEach(id => leaf(id, depth + 1, basketOf(node)));
  };
  for (const placement of input.placements ?? catalog.placements) {
    if (branch) {
      const find = (nodes: readonly PlacementNode[]): PlacementNode | undefined => {
        for (const node of nodes) {
          if (nodeKey(placement.layer, node.id) === branch.id) return node;
          if ("children" in node) { const found = find(node.children); if (found) return found; }
        }
        return undefined;
      };
      const node = find(placement.nodes);
      if (node) visit(placement.layer, node, 0);
    } else placement.nodes.forEach(node => visit(placement.layer, node, 0));
  }
  return rows;
}

export interface MatrixBoard {
  id: string; label: string; rows: readonly MatrixRow[]; leaves: readonly string[];
}

/** L2 groups are portable boards; shallow catalogs use their leaf-bearing root. */
export function matrixBoards(input: Pick<Input, "catalog" | "library" | "working">, rows: readonly MatrixRow[]): MatrixBoard[] {
  const roots = input.catalog.placements.flatMap(placement =>
    placement.nodes.flatMap(node => ("children" in node ? node.children : [node]).map(node => ({ layer: placement.layer, node }))));
  return roots.flatMap(({ layer, node }) => {
    const id = nodeKey(layer, node.id);
    const start = rows.findIndex(row => row.id === id);
    const first = rows[start];
    if (!first) return [];
    const end = rows.findIndex((row, index) => index > start && row.scope === "node" && row.depth <= first.depth);
    const boardRows = rows.slice(start, end < 0 ? undefined : end);
    return [{ id, label: node.label, rows: boardRows, leaves: first.leaves }];
  });
}

export type CheckCategory = "contract" | "accessibility" | "coherence" | "modes" | "provenance" | "coverage";
export interface MatrixSummary {
  total: number; resolved: number; errors: number; notices: number;
  categories: readonly { id: CheckCategory; supported: boolean; codes: readonly string[]; errors?: number; notices?: number }[];
  issues: readonly { finding: Finding; slotId?: string }[];
}

/** Measurements come from the real consumer-library checks; resolution counts no candidate values. */
export function matrixSummary(input: Input & { layer?: LayerId }): MatrixSummary {
  const { catalog, library, working } = input;
  const slots = catalog.slots.filter(slot => !input.layer || slot.layer === input.layer);
  const { resolved: profile, checked } = evaluationFor(input).evaluate();
  const resolved = slots.filter(slot => Object.values(profile.members).some(member => member.slot === slot.id)).length;
  const categories: MatrixSummary["categories"] = (["contract", "accessibility", "coherence", "modes", "provenance", "coverage"] as const).map(id => {
    const codes = id === "contract" ? ["C1"] : id === "accessibility" ? ["C9"] : id === "coherence" ? ["C2", "C3", "C7"] : id === "modes" ? ["C5"] : id === "provenance" ? ["C6", "C8", "C10"] : ["C4"];
    const findings = checked.findings.filter(finding => codes.includes(finding.code));
    return { id, supported: codes.length > 0, codes, ...(codes.length ? { errors: findings.filter(finding => finding.severity === "error").length, notices: findings.filter(finding => finding.severity === "notice").length } : {}) };
  });
  return { total: slots.length, resolved,
    errors: checked.findings.filter(finding => finding.severity === "error").length, notices: checked.findings.filter(finding => finding.severity === "notice").length, categories,
    issues: checked.findings.map(finding => {
      const fill = [...catalog.fills, ...library.fills].find(doc => doc.$extensions["com.clossys.fill"].id === finding.subject);
      const slotId = fill?.$extensions["com.clossys.fill"].slot ?? slots.find(slot => slot.id === finding.subject || isPrefixOf(slot.id, finding.subject))?.id;
      return { finding, ...(slotId ? { slotId } : {}) };
    }) };
}
