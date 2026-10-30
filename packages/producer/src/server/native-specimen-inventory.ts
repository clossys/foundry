import { join } from "node:path";
import type { AgentKind } from "../agents.js";
import { inventory, readCells, summary } from "./cells.js";
import type { AgentCells, CellSummary } from "./contract.js";

export interface NativeSpecimenCell extends CellSummary {
  agent: AgentKind;
  /** Canonical shared parser body only. Full source remains the cell-detail resource. */
  sourceBody: string;
}
export interface AgentSpecimenInventory {
  agent: AgentKind;
  state: AgentCells["state"];
  sourceDirectory: string;
  sourceComplete: boolean;
  index: AgentCells;
  /** Every stored version, including active, draft and retired. */
  cells: NativeSpecimenCell[];
  issues: string[];
  provenance: { packageName: string; parser: string };
}
const parsers: Record<AgentKind, string> = {
  director: "parseCell", designer: "parseLibraryCell", writer: "parseWriterCell", publisher: "listCells",
};

/** Read the configured consumer root through the installed native stores, without compiling. */
export async function agentSpecimenInventory(root: string, agent: AgentKind): Promise<AgentSpecimenInventory> {
  const index = await inventory(root, agent);
  const result: AgentSpecimenInventory = {
    agent, state: index.state, sourceDirectory: join("clossys", "agents", agent), sourceComplete: false,
    index, cells: [], issues: [], provenance: { packageName: index.packageName, parser: parsers[agent] },
  };
  if (index.state !== "ready") {
    result.issues.push(index.message ?? "The native source inventory is unavailable.");
    return result;
  }
  try {
    const cells = await readCells(root, agent);
    // Revalidate pointers in this read as well as the IA index read.
    await readCells(root, agent, true);
    result.cells = cells.map(cell => ({ ...summary(cell), agent, sourceBody: cell.document.body.map(line => line.text).join("\n") }));
    if (!cells.length) result.issues.push("The native source inventory contains no cells.");
    if (index.cells.some(cell => !cells.some(version => version.id === cell.id && version.version === cell.version && version.status === cell.status)) || new Set(cells.map(cell => cell.id)).size !== index.cells.length) result.issues.push("The native source changed while the inventory was read.");
    result.sourceComplete = result.issues.length === 0;
  } catch {
    result.state = "error";
    result.cells = [];
    result.issues.push("The native source could not be evaluated; check cell profiles, versions and paths.");
  }
  return result;
}

export interface NativePlanData {
  index: { agent: AgentKind; state: AgentCells["state"]; cells: (CellSummary & { title: string })[]; tree?: Record<string, unknown>; error?: string };
  cells: (NativeSpecimenCell & { title: string; content: string })[];
  sourceComplete: boolean;
  issues: string[];
}
/** Typed source IO for the existing Studio item projector; no rendering or coverage claim. */
export function planDataInterop(source: AgentSpecimenInventory): NativePlanData {
  const title = (cell: CellSummary) => typeof cell.fields.title === "string" && cell.fields.title.trim() ? cell.fields.title : cell.id.split(".").at(-1)!;
  return {
    index: { agent: source.agent, state: source.sourceComplete ? source.state : source.state === "ready" ? "error" : source.state, cells: source.index.cells.map(cell => ({ ...cell, title: title(cell) })), ...(source.index.tree ? { tree: source.index.tree } : {}), ...(source.issues.length ? { error: source.issues.join(" ") } : {}) },
    cells: source.cells.map(cell => ({ ...cell, title: title(cell), content: cell.sourceBody })),
    sourceComplete: source.sourceComplete, issues: [...source.issues],
  };
}
