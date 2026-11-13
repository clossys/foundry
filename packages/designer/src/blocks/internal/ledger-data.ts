import type { ReactNode } from "react";
import type { StatusMarkTone } from "../../components/StatusMark.js";

/** One static row. The words carry the meaning; tone reinforces them. */
export interface LedgerRowData {
  id: string;
  label: ReactNode;
  detail?: ReactNode;
  status?: { tone: StatusMarkTone; label: ReactNode };
  flag?: boolean;
}
export interface LedgerGroupData {
  id: string;
  label: ReactNode;
  rows?: readonly LedgerRowData[];
  owner?: { initials: ReactNode; name: ReactNode; note?: ReactNode };
  note?: ReactNode;
}

export function hasLedgerContent(node: ReactNode): boolean {
  if (node === undefined || node === null || typeof node === "boolean") return false;
  if (typeof node === "string") return node.trim().length > 0;
  if (Array.isArray(node)) return node.some(hasLedgerContent);
  // Numeric zero is content; opaque React components are caller-owned.
  return true;
}
export function assertLedgerIds(what: string, ids: readonly string[]): void {
  if (ids.some(id => typeof id !== "string" || !id || /\s/.test(id)) || new Set(ids).size !== ids.length) {
    throw new TypeError(`${what}: identifiers must be nonempty, unique and contain no whitespace.`);
  }
}
export function assertLedgerRows(rows: readonly LedgerRowData[], flagLabel: ReactNode, minimum = 1, maximum = 6): void {
  if (rows.length < minimum || rows.length > maximum) throw new RangeError(`Ledger: expected ${minimum} to ${maximum} rows, got ${rows.length}.`);
  assertLedgerIds("Ledger rows", rows.map(row => row.id));
  const flags = rows.filter(row => row.flag).length;
  if (flags > 1 || (flags > 0 && !hasLedgerContent(flagLabel))) throw new TypeError("Ledger: at most one flagged row, with a caller-provided flagLabel, is allowed.");
  if (rows.some(row => row.status) && rows.some(row => !row.status && !hasLedgerContent(row.detail))) throw new TypeError("Ledger: a row among status rows requires detail or status.");
}
