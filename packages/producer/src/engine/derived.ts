/**
 * The derived index: `<root>/.clossys/index.json`, rebuilt from the event log plus the record files it names. It is
 * never the source of truth: appendEvent keeps it current under the engine lock, `clossys index --rebuild` writes it
 * from scratch, and `clossys check --engine` fails when the stored index disagrees with a rebuild, or when a record's
 * bytes on disk differ from the sha256 its last event logged (the record was changed outside the engine).
 *
 * Node runs this file with type stripping in child writers (engine/*.test.ts).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { EngineLogError, INDEX_FILE, enginePaths, readEventLines, replaceEngineFile, sha256, verifyChain } from "./chain.js";
import type { EngineEvent } from "./types.js";

export const INDEX_SCHEMA = "clossys.index/1" as const;

/** The last event about a subject. */
export interface SubjectEntry { readonly seq: number; readonly kind: string; readonly actor: string; readonly at: string }
/** A record file the log names: the seq and sha256 of its last event, and the sha256 of its bytes on disk (null when absent). */
export interface RecordEntry { readonly seq: number; readonly logged: string | null; readonly disk: string | null }
export interface EngineIndex {
  readonly schema: typeof INDEX_SCHEMA;
  /** How many lines the log holds. */
  readonly events: number;
  /** sha256 of the log's last line, or null for an empty log. */
  readonly head: string | null;
  readonly subjects: Readonly<Record<string, SubjectEntry>>;
  readonly records: Readonly<Record<string, RecordEntry>>;
}
/** The index fields, as engine.md lists them. */
export const INDEX_FIELDS: readonly (readonly [string, string])[] = [
  ["schema", `"${INDEX_SCHEMA}"`],
  ["events", "how many lines the log holds"],
  ["head", "sha256 of the log's last line (null when empty): a removed tail line changes it"],
  ["subjects", "{ <subject>: { seq, kind, actor, at } } of the last event about each subject"],
  ["records", "{ <path>: { seq, logged, disk } }: the last event naming each file, the sha256 it logged and the sha256 of the file on disk now"],
];

const sorted = <T>(entries: Iterable<[string, T]>): Record<string, T> =>
  Object.fromEntries([...entries].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
const diskSha = (root: string, path: string): string | null => {
  try { return sha256(readFileSync(join(root, path))); } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR" || code === "EISDIR") return null;
    throw error;
  }
};

/** The index of `events`: the last event per subject and per record path, each record's bytes read from disk now. */
export function buildIndex(root: string, events: readonly EngineEvent[], head: string | null): EngineIndex {
  const subjects = new Map<string, SubjectEntry>();
  const records = new Map<string, { seq: number; logged: string | null }>();
  for (const event of events) {
    subjects.set(event.subject, { seq: event.seq, kind: event.kind, actor: event.actor, at: event.at });
    for (const input of event.inputs) records.set(input.path, { seq: event.seq, logged: input.sha256 });
  }
  return {
    schema: INDEX_SCHEMA, events: events.length, head,
    subjects: sorted(subjects),
    records: sorted([...records].map(([path, entry]) => [path, { ...entry, disk: diskSha(root, path) }] as [string, RecordEntry])),
  };
}
/** The index after one more event: its subject and inputs updated, the bytes on disk being the ones it logged. */
export function applyEvent(index: EngineIndex, event: EngineEvent, head: string): EngineIndex {
  const records = new Map(Object.entries(index.records));
  for (const input of event.inputs) records.set(input.path, { seq: event.seq, logged: input.sha256, disk: input.sha256 });
  return {
    schema: INDEX_SCHEMA, events: index.events + 1, head,
    subjects: sorted([...Object.entries(index.subjects), [event.subject, { seq: event.seq, kind: event.kind, actor: event.actor, at: event.at }]]),
    records: sorted(records),
  };
}
export const serializeIndex = (index: EngineIndex): string => `${JSON.stringify(index, null, 2)}\n`;

export type StoredIndex = { readonly present: false } | { readonly present: true; readonly index?: EngineIndex; readonly error?: string };
/** The stored index, parsed; `error` when it is not an index. */
export function readIndex(root: string): StoredIndex {
  let text: string;
  try { text = readFileSync(enginePaths(root).index, "utf8"); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { present: false };
    throw error;
  }
  try {
    const doc = JSON.parse(text) as EngineIndex;
    if (!doc || doc.schema !== INDEX_SCHEMA || typeof doc.events !== "number" || typeof doc.subjects !== "object" || typeof doc.records !== "object") return { present: true, error: `${INDEX_FILE} is not a ${INDEX_SCHEMA} document` };
    return { present: true, index: doc };
  } catch { return { present: true, error: `${INDEX_FILE} is not JSON` }; }
}

/** The index from the log as it stands, built from scratch (the chain is not checked here). */
export function computeIndex(root: string): EngineIndex {
  const report = verifyChain(root);
  return buildIndex(root, report.events, report.head);
}

/**
 * Keep the index after appendEvent wrote `line` (called under the engine lock): applied incrementally when the stored
 * index matches the log before the append, rebuilt from the log otherwise.
 */
export function indexAfterAppend(root: string, event: EngineEvent, line: string, prevLine: string | undefined): void {
  const stored = readIndex(root);
  const before = prevLine === undefined ? null : sha256(prevLine);
  const next = stored.present && stored.index && stored.index.head === before && stored.index.events === event.seq
    ? applyEvent(stored.index, event, sha256(line))
    : computeIndex(root);
  replaceEngineFile(root, INDEX_FILE, serializeIndex(next));
}

/** Rebuild the index from the log plus the records (the caller holds the engine lock). Refuses a broken chain. */
export function rebuildIndexUnlocked(root: string): EngineIndex {
  const report = verifyChain(root);
  if (!report.ok) throw new EngineLogError(`the event log does not verify (${report.issues.length} issue(s), first: ${report.issues[0]!.message}); the index was not rebuilt`);
  const index = buildIndex(root, report.events, report.head);
  replaceEngineFile(root, INDEX_FILE, serializeIndex(index));
  return index;
}

/** Where a stored index and a rebuild differ, one line per field (at most `limit`). */
export function compareIndex(stored: EngineIndex, rebuilt: EngineIndex, limit = 50): string[] {
  const diffs: string[] = [];
  const show = (value: unknown) => (value === undefined ? "absent" : JSON.stringify(value));
  for (const key of ["schema", "events", "head"] as const) if (stored[key] !== rebuilt[key]) diffs.push(`${key}: index ${show(stored[key])}, rebuild ${show(rebuilt[key])}`);
  for (const key of ["subjects", "records"] as const) {
    const a = stored[key] as Record<string, unknown>, b = rebuilt[key] as Record<string, unknown>;
    for (const name of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
      if (JSON.stringify(a[name]) !== JSON.stringify(b[name])) diffs.push(`${key}[${name}]: index ${show(a[name])}, rebuild ${show(b[name])}`);
    }
  }
  return diffs.slice(0, limit);
}

/** Records whose bytes on disk are not the bytes their last event logged: changed outside the engine. */
export function recordDrift(index: EngineIndex): string[] {
  return Object.entries(index.records).filter(([, entry]) => entry.disk !== entry.logged)
    .map(([path, entry]) => `${path}: last logged ${entry.logged ?? "absent"} at seq ${entry.seq}, on disk ${entry.disk ?? "absent"}`);
}

/** Read-only comparison of the stored index with a rebuild of the log as it stands. */
export function indexAgreement(root: string): { present: boolean; agrees: boolean; diffs: string[]; rebuilt: EngineIndex; events: number } {
  const rebuilt = computeIndex(root);
  const stored = readIndex(root);
  const { lines } = readEventLines(root);
  if (!stored.present) {
    return lines.length === 0
      ? { present: false, agrees: true, diffs: [], rebuilt, events: 0 }
      : { present: false, agrees: false, diffs: [`${INDEX_FILE} is missing while the log holds ${lines.length} event(s)`], rebuilt, events: lines.length };
  }
  if (!stored.index) return { present: true, agrees: false, diffs: [stored.error!], rebuilt, events: lines.length };
  const diffs = compareIndex(stored.index, rebuilt);
  return { present: true, agrees: diffs.length === 0, diffs, rebuilt, events: lines.length };
}
