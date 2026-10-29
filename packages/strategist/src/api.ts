import { compileBrief, type Brief } from "./brief.js";
import { discoverBriefContracts, mergeBriefContracts, type BriefContract } from "./brief-contracts.js";
import type { Cell, CellId, CellRef, StrategyRootIssue } from "./format/types.js";
import { readStrategyRoot } from "./store.js";

/** Structural inventory only: quality, coherence and completion are separate checks. */
export interface StatusReport {
  scope: "core" | "full"; archetype: string; cells: number;
  active: CellRef[]; missing: CellId[]; stale: CellRef[]; issues: StrategyRootIssue[];
}
export interface Strategy {
  getCell(id: CellId, version?: number): Cell | undefined;
  getActive(id: CellId): Cell | undefined;
  getBrief(contractId: string): Brief;
  isStale(ref: CellRef): boolean;
  status(options?: { scope?: "core" | "full" }): StatusReport;
}

/** Opens one read-only snapshot; reopen after activation to observe pointer changes. */
export function openStrategy(root: string, options: { contracts?: BriefContract[]; archetype?: string } = {}): Strategy {
  const model = readStrategyRoot(root);
  const archetype = options.archetype ?? model.tree?.archetype ?? "default";
  if (archetype !== "default" && !Object.hasOwn(model.catalog.archetypes.extras, archetype)) throw new Error("Unknown strategy archetype");
  const discovered = discoverBriefContracts(root, model.catalog);
  const merged = mergeBriefContracts([...discovered.contracts, ...(options.contracts ?? [])], model.catalog);
  const issues = [...discovered.issues, ...merged.issues];
  if (issues.length) throw new Error(`Invalid brief contracts: ${issues.map(issue => `${issue.path}: ${issue.message}`).join("; ")}`);
  const contracts = new Map(merged.contracts.map(contract => [contract.id, contract]));
  function getCell(id: CellId, version?: number): Cell | undefined {
    return model.cells.filter(cell => cell.id === id && (version === undefined || cell.version === version)).sort((a, b) => b.version - a.version)[0];
  }
  function getActive(id: CellId): Cell | undefined {
    const version = model.tree?.active[id];
    return version == null ? undefined : getCell(id, version);
  }
  function isStale(ref: CellRef): boolean {
    return model.tree?.active[ref.cell] !== ref.version;
  }
  return {
    getCell, getActive, isStale,
    getBrief(contractId) {
      const contract = contracts.get(contractId);
      if (!contract) throw new Error(`Unknown brief contract: ${contractId}`);
      return compileBrief(model, contract);
    },
    status({ scope = "core" } = {}) {
      const ids = [...new Set(scope === "full" ? model.catalog.cells.map(cell => cell.id) : Array.isArray(model.tree?.core) ? model.tree.core : [...model.catalog.archetypes.default, ...(model.catalog.archetypes.extras[archetype] ?? [])])].sort();
      const active: CellRef[] = []; const missing: CellId[] = []; const stale = new Map<string, CellRef>();
      for (const id of ids) {
        const cell = getActive(id);
        if (!cell || cell.status !== "active") { missing.push(id); continue; }
        active.push({ cell: id, version: cell.version });
        for (const ref of cell.cites) if (ref.kind === "cell" && isStale(ref.ref)) stale.set(`${ref.ref.cell}@${ref.ref.version}`, ref.ref);
      }
      return { scope, archetype, cells: ids.length, active, missing, stale: [...stale.values()].sort((a, b) => a.cell.localeCompare(b.cell) || a.version - b.version), issues: structuredClone(model.issues) };
    },
  };
}
