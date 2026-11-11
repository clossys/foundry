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
  /** Optional shared cell links; absence preserves the existing document shape. */
  links?: string[];
  direction: Bullet[]; because: Bullet[]; watch: Bullet[]; path: string;
  /** A slot candidate's pin: who decided it (`decidedBy`) and how (`basis`), as pin.json records them. */
  pin?: { decidedBy: string; basis: string };
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
  /** Reserved shared-contract field; only an empty list is supported. */
  retired?: [];
}
export interface SessionLine {
  id: string; role: "user" | "director"; text: string; line: number; refs: Ref[];
}
export interface Session { id: string; path: string; lines: SessionLine[]; index: Record<string, SessionLine> }
export interface Finding {
  id: string; source: string; observed: string; by: string;
  value?: string | number | boolean; unit?: string; aliases?: string[];
  /** A judgement finding: the verdict a judge gave on exactly these pinned cell versions. */
  judge?: string; verdict?: "pass" | "fail"; judged?: string[];
  /** The run record a judgement cites, `<step>#<run id>` in the local `.clossys/runs` store or its tracked copy `evidence/director/runs`. */
  run?: string;
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
  /**
   * Candidate versions present per slot (`<slot-id>/candidates/<name>-v<n>.md`), pinned or not.
   * Only the pinned candidate is a cell; the others make a citation of their version known
   * (stale) rather than unknown (dangling). Absent for models that list every version as a cell.
   */
  candidateVersions?: Record<string, number[]>;
  /**
   * The run records judgement findings cite (`<step>#<run id>`) that resolve in the local run
   * store `<repo>/.clossys/runs/<step>.jsonl` or the tracked copy
   * `<consumer>/evidence/director/runs/<step>.jsonl`. A cited run absent from both does not resolve.
   */
  runs?: Record<string, { step: string; run: string; exit: number }>;
}
