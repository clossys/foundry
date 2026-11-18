/**
 * The one strict reader of the clossys.queue-entry/1 entries still under queue.fix (foundry-build-0048 U7 r3). Every
 * reader that judges whether such an entry holds a slot open (the release gate requests.open-fix, conform Q1, Q10
 * and Q11) goes through it, so none can drop one the others count. It fails closed:
 * - every file under clossys/agents/producer/queue.fix/entries/ whose name ends in .json is read, hidden ones
 *   included (a hidden file is an issue); it judges the files whose schema is clossys.queue-entry/1, and every other
 *   file (a kind fix entry, one with no or another schema, one that is not JSON) is records/request.ts listRequests',
 *   which reports any that does not read, so each file has exactly one reader and none is counted twice;
 * - an entry is `closed` only when it parses, passes the record schema (entrySchemaIssues) and every answer rule
 *   (ANSWER_RULES, which also checks that the status agrees with the events), and its status is answered or withdrawn;
 * - anything else is not closed: open when it is valid, otherwise an entry with issues (a missing subject among
 *   them). It never throws.
 * queue/entry.ts readQueueEntry is lax (it checks only the id and queue against the path); never judge closure by it.
 */
import { readdirSync, readFileSync } from "node:fs";
import { basename, join, relative } from "node:path";
import type { QueueEntry } from "../records/types.js";
import { ANSWER_RULES, entrySchemaIssues } from "./rules.js";

export interface LegacyFix {
  /** The file, relative to `root` (the folder holding clossys/). */
  readonly path: string;
  readonly id?: string;
  /** The subject's `to`, when the entry names one. */
  readonly subject?: string;
  readonly status?: string;
  readonly closed: boolean;
  readonly issues: readonly string[];
  readonly hidden: boolean;
  /** The parsed JSON, when the file parses (so a reader can report the entry it holds). */
  readonly doc?: unknown;
}

const LEGACY_SCHEMA = "clossys.queue-entry/1";
const CLOSED: readonly string[] = ["answered", "withdrawn"];
const object = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** clossys/agents/producer/queue.fix/entries under `root`. */
export const legacyFixDir = (root: string): string => join(root, "clossys", "agents", "producer", "queue.fix", "entries");

/** Every clossys.queue-entry/1 file under queue.fix, judged, in file-name order. */
export function readLegacyFixes(root: string): LegacyFix[] {
  let names: string[];
  try { names = readdirSync(legacyFixDir(root)); } catch { return []; }
  return names.filter(name => name.endsWith(".json")).sort().flatMap(name => {
    const fix = readLegacyFix(root, join(legacyFixDir(root), name));
    return fix ? [fix] : [];
  });
}

/** One file judged; undefined for a file whose schema is not clossys.queue-entry/1 (records/request.ts reads it). */
export function readLegacyFix(root: string, path: string): LegacyFix | undefined {
  const rel = relative(root, path);
  const name = basename(path);
  const hidden = name.startsWith(".");
  const issues: string[] = hidden ? [`${name} is a hidden file: an entry is <id>.json, and a hidden one is never skipped`] : [];
  let doc: unknown;
  try { doc = JSON.parse(readFileSync(path, "utf8")); } catch { return undefined; }
  if (!object(doc) || doc.schema !== LEGACY_SCHEMA) return undefined;
  const id = typeof doc.id === "string" ? doc.id : undefined;
  const subject = object(doc.subject) && typeof doc.subject.to === "string" ? doc.subject.to : undefined;
  const status = typeof doc.status === "string" ? doc.status : undefined;
  if (id === undefined) issues.push("no id");
  else if (`${id}.json` !== name) issues.push(`id ${id} is not the file name ${name}`);
  if (doc.queue !== "queue.fix") issues.push(`queue ${JSON.stringify(doc.queue)} is not queue.fix, its folder`);
  if (subject === undefined) issues.push("no subject (subject.to): no reader can say which slot it holds open");
  issues.push(...entrySchemaIssues(doc));
  try {
    issues.push(...ANSWER_RULES.flatMap(rule => rule.issues(doc as unknown as QueueEntry, root)));
  } catch (error) {
    issues.push(`the answer rules do not run on it: ${error instanceof Error ? error.message : String(error)}`);
  }
  const closed = issues.length === 0 && status !== undefined && CLOSED.includes(status);
  return { path: rel, ...(id !== undefined ? { id } : {}), ...(subject !== undefined ? { subject } : {}), ...(status !== undefined ? { status } : {}), closed, issues, hidden, doc };
}
