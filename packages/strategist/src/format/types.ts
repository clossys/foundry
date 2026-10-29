import type { StrategyCatalog } from "../catalog.js";
import type { ValidationIssue } from "../validation.js";

export type CellId = string;
export interface CellRef { cell: CellId; version: number }
export type Ref = { kind: "cell"; ref: CellRef } | { kind: "msg"; session: string; line: string } | { kind: "finding"; id: string };
export interface Bullet {
  /** Leading Key label, without the colon. */
  key?: string;
  /** Text after the label, including any terminal reference prose/punctuation. */
  text: string;
  /** Parsed refs from text; serializers must not append these a second time. */
  refs: Ref[];
  /** One-based physical line in the source document. */
  line: number;
}
export interface Cell {
  id: CellId; version: number; status: "draft" | "active" | "retired"; updated: string;
  cites: Ref[]; feeds: string[]; functions: string[]; confirmed?: Ref; note?: string;
  direction: Bullet[]; because: Bullet[]; watch: Bullet[]; path: string;
}
export interface FormatIssue extends ValidationIssue { line: number }
export type FormatResult<T> = { ok: true; value: T } | { ok: false; issues: FormatIssue[] };
export interface StrategyTreeNode {
  id: string; name: string;
  children: { id: string; name: string; cells: CellId[] }[];
}
export interface StrategyTree {
  schemaVersion: 1; catalog: string; archetype: string; core: "archetype" | CellId[];
  tree?: StrategyTreeNode[]; active: Record<CellId, number | null>;
}
export interface SessionLine {
  id: string; role: "user" | "strategist"; text: string; line: number; refs: Ref[];
}
export interface Session { id: string; path: string; lines: SessionLine[]; index: Record<string, SessionLine> }
export interface Finding {
  id: string; source: string; observed: string; by: string;
  value?: string | number | boolean; unit?: string; aliases?: string[];
  bullets: Bullet[]; path: string;
}
export interface StrategyRequest {
  id: string; raisedBy: string; kind: "missing" | "contradiction" | "tripwire" | "drift" | "reading" | "change";
  cells: CellId[]; detail: string; status: "open" | "drafted" | "resolved" | "declined";
  opened: string; resolvedBy: Ref | null;
}
export interface StrategyRootIssue {
  /** Root-relative file/directory path; '.' identifies the root itself. */
  path: string; line: number;
  reason: "unreadable" | "outside-root" | "invalid-json" | "invalid-format" | "invalid-path";
  message: string;
}
export interface StrategyModel {
  root: string; catalog: StrategyCatalog; tree: StrategyTree | undefined;
  cells: Cell[]; sessions: Session[]; findings: Finding[]; requests: StrategyRequest[];
  /** Exact UTF-8 source contents keyed by root-relative paths, for fingerprints. */
  files: Record<string, string>; issues: StrategyRootIssue[];
}
