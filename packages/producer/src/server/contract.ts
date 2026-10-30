import type { AgentKind } from "../agents.js";

/** Same-origin, read-only Studio transport. Source is returned by the detail API. */
export type NativeCellData =
  | { agent: "director"; kind: "director"; sections: { title: string; value: string }[] }
  | { agent: "writer"; kind: "writer"; locales: string[]; records: { locale: string; record: Record<string, unknown>; bindings: Record<string, unknown>[] }[] }
  | { agent: "designer"; kind: "token" | "asset" | "component" | "section" | "frame"; layer: string; valueKind?: string; fill: Record<string, unknown>; rationale: string | null; originKinds: string[]; sources: string[] };

export interface CellSummary {
  id: string;
  version: number;
  status: "draft" | "active" | "retired";
  path: string;
  fields: Record<string, unknown>;
  native?: NativeCellData;
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
