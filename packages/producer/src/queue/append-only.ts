/**
 * What may change in a committed queue entry (system.md 2 "append", 6.5, 12.6 step 5): events are appended, never
 * edited, reordered or removed; refs are appended (a loop adds its `raisedBy`, a code close its `answers`); `status`
 * leaves `open` once; `updatedAt` may move forward. Every other key keeps its bytes' meaning exactly.
 * A ledger entry is written once and never changes at all.
 */
import { isDeepStrictEqual } from "node:util";

const APPENDABLE = new Set(["events", "refs", "status", "updatedAt"]);

const asObject = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;

function prefixIssue(key: string, before: unknown, after: unknown): string | undefined {
  const old = Array.isArray(before) ? before : before === undefined ? [] : undefined;
  const now = Array.isArray(after) ? after : after === undefined ? [] : undefined;
  if (!old || !now) return `${key} is not a list`;
  if (now.length < old.length) return `${key} lost ${old.length - now.length} item(s): ${old.length} before, ${now.length} now`;
  for (let index = 0; index < old.length; index++) {
    if (!isDeepStrictEqual(old[index], now[index])) return `${key}[${index}] was edited`;
  }
  return undefined;
}

/** Why `after` is not an append-only successor of `before` (both parsed queue entries); empty when it is. */
export function queueEntryChangeIssues(before: unknown, after: unknown): string[] {
  const old = asObject(before), now = asObject(after);
  if (!old || !now) return ["the entry is not a JSON object"];
  const out: string[] = [];
  for (const key of [...new Set([...Object.keys(old), ...Object.keys(now)])].sort()) {
    if (APPENDABLE.has(key)) continue;
    if (!isDeepStrictEqual(old[key], now[key])) out.push(`${key} was ${key in now ? (key in old ? "edited" : "added") : "removed"}`);
  }
  for (const key of ["events", "refs"]) {
    const issue = prefixIssue(key, old[key], now[key]);
    if (issue) out.push(issue);
  }
  if (old.status !== now.status && old.status !== "open") out.push(`status went from ${JSON.stringify(old.status)} to ${JSON.stringify(now.status)}; only an open entry changes status`);
  if (old.updatedAt !== now.updatedAt && old.updatedAt !== undefined && !(Date.parse(String(now.updatedAt)) >= Date.parse(String(old.updatedAt)))) {
    out.push(`updatedAt went back from ${String(old.updatedAt)} to ${String(now.updatedAt)}`);
  }
  return out;
}
