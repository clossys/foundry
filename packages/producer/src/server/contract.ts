import type { AgentKind } from "../agents.js";

/** Same-origin, read-only Studio transport. Source is returned by the detail API. */
export interface CellSummary {
  id: string;
  version: number;
  status: "draft" | "active" | "retired";
  path: string;
  fields: Record<string, unknown>;
}
export interface AgentCells {
  agent: AgentKind;
  packageName: string;
  state: "ready" | "missing" | "error";
  cells: CellSummary[];
  tree?: Record<string, unknown>;
  message?: string;
}
export interface CellsResponse { agents: AgentCells[] }
export interface ChangeEvent { agent: AgentKind | null; id: string | null; reload: true }
export const TOKEN_HEADER = "X-Clossys-Token";
