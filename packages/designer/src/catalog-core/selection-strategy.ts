import type { Finding } from "./types.js";

/** A citation to an immutable Strategist cell version. */
export interface SelectionCellRef { cell: string; version: number }
export interface SelectionStrategy {
  contract: "designer.identity";
  refs: readonly SelectionCellRef[];
  fingerprint: string;
}

/** The read-only subset of Strategist's Strategy API needed by a selection. */
export interface SelectionStrategyReader {
  getCell(id: string, version?: number): { id: string; version: number } | undefined;
  isStale(ref: SelectionCellRef): boolean;
  getBrief(contractId: string): {
    contract: string; state: "ready" | "missing" | "stale";
    cells: readonly SelectionCellRef[]; missing: readonly string[]; stale: readonly SelectionCellRef[];
    fingerprint: string;
  };
}
export interface SelectionStrategyResult {
  state: "ready" | "missing" | "stale" | "unavailable" | "invalid";
  findings: readonly Finding[];
}
const object = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const exact = (value: Record<string, unknown>, keys: readonly string[]) => Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const cellId = /^[a-z]+(?:-[a-z]+)*\.[a-z]+(?:-[a-z]+)*\.[a-z]+(?:-[a-z]+)*$/;
const token = (ref: SelectionCellRef) => `${ref.cell}@${ref.version}`;

/** Reports currency from active pointers and the compiler's fingerprint; never hashes or fabricates provenance. */
export function validateSelectionStrategy(value: unknown, reader?: SelectionStrategyReader): SelectionStrategyResult {
  const findings: Finding[] = [];
  const add = (message: string, severity: Finding["severity"] = "error", subject = "designer.identity") => findings.push({ code: "C10", rule: "strategy", severity, subject, message: `strategy: ${message}` });
  if (value === undefined || value === null) {
    add("missing designer.identity brief provenance"); return { state: "missing", findings };
  }
  if (!object(value) || !exact(value, ["contract", "refs", "fingerprint"]) || value.contract !== "designer.identity"
    || typeof value.fingerprint !== "string" || !/^[a-f0-9]{64}$/.test(value.fingerprint) || !Array.isArray(value.refs) || value.refs.length === 0) {
    add("expected designer.identity contract, sha256 fingerprint and nonempty CellRefs"); return { state: "invalid", findings };
  }
  const refs: SelectionCellRef[] = [];
  for (const ref of value.refs) {
    if (!object(ref) || !exact(ref, ["cell", "version"]) || typeof ref.cell !== "string" || !cellId.test(ref.cell)
      || typeof ref.version !== "number" || !Number.isSafeInteger(ref.version) || ref.version < 1) {
      add("expected CellRefs with a cell id and positive integer version"); return { state: "invalid", findings };
    }
    if (refs.some(previous => previous.cell === ref.cell)) { add(`duplicate cell ref ${ref.cell}`); return { state: "invalid", findings }; }
    refs.push({ cell: ref.cell, version: ref.version });
  }
  if (!reader) {
    add("reference and fingerprint verification unavailable without a strategy reader", "notice");
    return { state: "unavailable", findings };
  }
  const brief = reader.getBrief("designer.identity");
  if (brief.contract !== "designer.identity") {
    add("reader returned a brief for a different contract"); return { state: "invalid", findings };
  }
  if (brief.state === "missing") add(`missing required cells: ${brief.missing.join(", ")}`);
  for (const ref of refs) {
    if (!reader.getCell(ref.cell, ref.version)) add(`dangling ref ${token(ref)}`, "error", token(ref));
    else if (reader.isStale(ref)) add(`stale ref ${token(ref)}`, "notice", token(ref));
  }
  const expected = new Set(brief.cells.map(ref => ref.cell));
  if (refs.some(ref => !expected.has(ref.cell)) || brief.cells.some(ref => !refs.some(selected => selected.cell === ref.cell))) add("selection refs differ from the compiled identity brief", "notice");
  if (value.fingerprint !== brief.fingerprint) add("stale brief fingerprint; compile and cite the current designer.identity brief", "notice");
  if (brief.state === "stale") add(`stale designer.identity brief${brief.stale.length ? `: ${brief.stale.map(token).join(", ")}` : ""}`, "notice");
  return { state: brief.state === "missing" ? "missing" : findings.some(finding => finding.severity === "error") ? "invalid" : findings.length ? "stale" : "ready", findings };
}
