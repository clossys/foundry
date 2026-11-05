import { isPlainObject } from "../validation.js";
import type { StrategyCatalog } from "../catalog.js";
import { CELL_ID_PATTERN, formatRef, isoDate, parseRef } from "./ref.js";
import { strings } from "./markdown.js";
import type { FormatIssue, FormatResult, Ref, StrategyRequest } from "./types.js";

export function validateRequest(value: unknown, catalog?: StrategyCatalog): FormatResult<StrategyRequest> {
  const issues: FormatIssue[] = []; const add = (path: string, message: string) => issues.push({ path, line: 1, message });
  if (!isPlainObject(value)) return { ok: false, issues: [{ path: "request", line: 1, message: "Expected a request object" }] };
  for (const key of Object.keys(value)) if (!["id", "raisedBy", "kind", "cells", "detail", "status", "opened", "resolvedBy"].includes(key)) add(key, "Unknown request field");
  if (typeof value.id !== "string" || !/^REQ-\d{4}$/.test(value.id)) add("id", "Expected REQ-NNNN");
  for (const key of ["raisedBy", "detail"]) if (typeof value[key] !== "string" || !(value[key] as string).trim()) add(key, "Expected a nonempty string");
  if (typeof value.kind !== "string" || !["missing", "contradiction", "tripwire", "drift", "reading", "change"].includes(value.kind)) add("kind", "Unknown request kind");
  if (typeof value.status !== "string" || !["open", "drafted", "resolved", "declined"].includes(value.status)) add("status", "Unknown request status");
  const known = catalog && new Set(catalog.cells.map(c => c.id));
  if (!strings(value.cells) || !value.cells.length || value.cells.some(id => !CELL_ID_PATTERN.test(id) || known && !known.has(id)) || new Set(value.cells).size !== value.cells.length) add("cells", "Expected unique known cell ids");
  if (!isoDate(value.opened)) add("opened", "Expected a calendar date YYYY-MM-DD");
  // Accept wire refs or the typed representation produced by this validator.
  let resolvedBy: Ref | undefined;
  if (typeof value.resolvedBy === "string") resolvedBy = parseRef(value.resolvedBy);
  else if (isPlainObject(value.resolvedBy)) {
    try { resolvedBy = parseRef(formatRef(value.resolvedBy as unknown as Ref)); } catch { /* Invalid typed ref. */ }
  }
  if (value.resolvedBy !== null && (!resolvedBy || resolvedBy.kind === "finding") || value.status === "resolved" && !resolvedBy) add("resolvedBy", "Expected null, a cell ref or a msg ref; resolved requests need a ref");
  return issues.length ? { ok: false, issues } : { ok: true, value: { ...value, resolvedBy: resolvedBy ?? null } as unknown as StrategyRequest };
}
