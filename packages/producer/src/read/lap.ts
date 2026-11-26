/**
 * `clossys request <id> --receipt` (foundry-build-0048 CP1-L3): the lap metrics of one work entry as `clossys.lap/1`,
 * joined from the entry itself, the engine log (`clossys/.state/events.jsonl`), every queue entry and git when the root
 * is in a work tree. It reads records only; the one file it writes is the receipt, `clossys/.state/laps/<id>.json`.
 *
 * The lap window runs from the entry's `createdAt` to its `closedAt` (open: no end). Every count is over that window.
 * The receipt is deterministic: the same records give the same bytes (no clock is read). A value no record holds is
 * `"unknown"`, never a guess:
 * - `gateFailuresBeforeGreen`: `clossys check` and `release --gates` runs leave no record, so it is always unknown;
 * - `handEdits` and `outsideLeafWrites` without git; `wall.totalSeconds` of an open entry.
 *
 * Git's changed set is the record files under `clossys/agents/` that commits in the window touched, plus the
 * uncommitted and untracked ones. A hand edit is a changed file whose bytes now match no engine event naming it (the
 * last event's sha256, null for a deletion). An outside-leaf write is a changed file outside the assignee's folder and
 * Producer's own (its queue and ledger records), minus `slot.json` files whose bytes an event logged (the cascade's
 * status writes); install output lies outside `clossys/agents/` and is never in the set.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { readEventLines, sha256 } from "../engine/chain.js";
import { refuseLegacyState, statePath } from "../engine/state-dir.js";
import type { EngineEvent } from "../engine/types.js";
import { listQueueEntryFiles, readQueueEntry } from "../queue/entry.js";
import { listWorkEntries, readRequest } from "../records/request.js";
import type { SlotRequest } from "../records/types.js";

export const LAP_SCHEMA = "clossys.lap/1" as const;
export const UNKNOWN = "unknown" as const;
type Unknown = typeof UNKNOWN;

export interface LapStep { readonly event: string; readonly op: string; readonly by: string | Unknown; readonly at: string; readonly seconds: number }
export interface LapReceipt {
  readonly schema: typeof LAP_SCHEMA;
  readonly request: string;
  readonly kind: string;
  readonly target: string;
  readonly from: string;
  readonly assignee: string;
  readonly status: string;
  readonly outcome: string | Unknown;
  readonly changedSince: string | Unknown;
  readonly window: { readonly from: string; readonly to: string | Unknown };
  /** Each entry event with the seconds since the one before it (the first: since `createdAt`). */
  readonly steps: readonly LapStep[];
  readonly wall: { readonly totalSeconds: number | Unknown };
  /** Distinct loop runs (`run.state` events) and `next --submit` events (`slot.submit`) in the window. */
  readonly agentRuns: { readonly loopRuns: number; readonly runIds: readonly string[]; readonly submits: number };
  /** Owner answers (`answered` by owner) on any queue entry in the window. */
  readonly ownerAsks: number;
  /** `rejected` events on this entry and kind fix entries the cascade raised (source check) in the window. */
  readonly rework: { readonly rejected: number; readonly cascadeFixes: number; readonly fixIds: readonly string[] };
  readonly gateFailuresBeforeGreen: number | Unknown;
  readonly handEdits: { readonly count: number; readonly files: readonly string[] } | Unknown;
  readonly outsideLeafWrites: { readonly count: number; readonly files: readonly string[] } | Unknown;
}

const ms = (at: string): number => Date.parse(at);
const seconds = (from: string, to: string): number => Math.round(ms(to) - ms(from)) / 1000;

function readEvents(root: string): EngineEvent[] {
  return readEventLines(root).lines.flatMap(line => { try { return [JSON.parse(line) as EngineEvent]; } catch { return []; } });
}

/** The changed record files under clossys/agents/ (root-relative), or undefined when the root is in no git work tree. */
function gitChanged(root: string, from: string, to: string | Unknown): string[] | undefined {
  const git = (args: readonly string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 * 1024 * 1024 });
  try { if (git(["rev-parse", "--is-inside-work-tree"]).trim() !== "true") return undefined; } catch { return undefined; }
  const scope = ["--", "clossys/agents"];
  const lines = (text: string) => text.split("\n").map(line => line.trim()).filter(Boolean);
  const out = new Set<string>();
  let head = true;
  try { git(["rev-parse", "--verify", "HEAD"]); } catch { head = false; }
  if (head) {
    for (const file of lines(git(["log", `--since=${from}`, ...(to === UNKNOWN ? [] : [`--until=${to}`]), "--name-only", "--relative", "--format=", ...scope]))) out.add(file);
    for (const file of lines(git(["diff", "--name-only", "--relative", "HEAD", ...scope]))) out.add(file);
  }
  for (const file of lines(git(["ls-files", "--others", "--exclude-standard", ...scope]))) out.add(file);
  return [...out].sort();
}

/** The lap receipt of work entry `id` (read only; `writeLapReceipt` writes it). */
export function lapReceipt(root: string, id: string, options: { readonly changedSince?: string } = {}): LapReceipt {
  const consumer = join(root, "clossys");
  const request: SlotRequest = readRequest(consumer, id);
  const from = request.createdAt;
  const to = request.closedAt ?? UNKNOWN;
  const inWindow = (at: string | undefined): boolean => at !== undefined && ms(at) >= ms(from) && (to === UNKNOWN || ms(at) <= ms(to));

  let previous = from;
  const steps = request.events.map((event): LapStep => {
    const step = { event: event.id, op: event.op, by: event.by ?? UNKNOWN, at: event.at, seconds: seconds(previous, event.at) };
    previous = event.at;
    return step;
  });

  const events = readEvents(root);
  const windowed = events.filter(event => inWindow(event.at));
  const runIds = [...new Set(windowed.filter(event => event.kind === "run.state").map(event => event.subject.replace(/^loop:[^/]+\//, "")))].sort();
  const submits = windowed.filter(event => event.kind === "slot.submit").length;

  const work = listWorkEntries(consumer).flatMap(read => read.request ? [read.request] : []);
  let ownerAsks = work.reduce((sum, entry) => sum + entry.events.filter(event => event.op === "answered" && event.by === "owner" && inWindow(event.at)).length, 0);
  for (const at of listQueueEntryFiles(root)) {
    const read = readQueueEntry(at);
    if (read.ok) ownerAsks += read.entry.events.filter(event => event.op === "answered" && event.by === "owner" && inWindow(event.at)).length;
  }
  const fixIds = work.filter(entry => entry.kind === "fix" && entry.source === "check" && entry.id !== request.id && inWindow(entry.createdAt)).map(entry => entry.id).sort();

  const changed = gitChanged(root, from, to);
  let handEdits: LapReceipt["handEdits"] = UNKNOWN, outsideLeafWrites: LapReceipt["outsideLeafWrites"] = UNKNOWN;
  if (changed) {
    const logged = new Map<string, string | null>();
    for (const event of events) for (const input of event.inputs ?? []) logged.set(input.path, input.sha256);
    const matches = (file: string): boolean => {
      if (!logged.has(file)) return false;
      const path = join(root, file);
      return logged.get(file) === (existsSync(path) ? sha256(readFileSync(path)) : null);
    };
    const hand = changed.filter(file => !matches(file));
    const own = [`clossys/agents/${request.assignee}/`, "clossys/agents/producer/"];
    const outside = changed.filter(file => !own.some(prefix => file.startsWith(prefix)) && !(file.endsWith("/slot.json") && matches(file)));
    handEdits = { count: hand.length, files: hand };
    outsideLeafWrites = { count: outside.length, files: outside };
  }

  return {
    schema: LAP_SCHEMA, request: request.id, kind: request.kind, target: request.target, from: request.from, assignee: request.assignee,
    status: request.status, outcome: request.outcome ?? UNKNOWN, changedSince: options.changedSince ?? UNKNOWN,
    window: { from, to }, steps, wall: { totalSeconds: to === UNKNOWN ? UNKNOWN : seconds(from, to) },
    agentRuns: { loopRuns: runIds.length, runIds, submits },
    ownerAsks,
    rework: { rejected: request.events.filter(event => event.op === "rejected").length, cascadeFixes: fixIds.length, fixIds },
    gateFailuresBeforeGreen: UNKNOWN,
    handEdits, outsideLeafWrites,
  };
}

export const lapPath = (root: string, id: string): string => statePath(root, "laps", `${id}.json`);

/** Writes the receipt to `clossys/.state/laps/<id>.json` (temp file, then rename) and returns it with its path. */
export function writeLapReceipt(root: string, id: string, options: { readonly changedSince?: string } = {}): { receipt: LapReceipt; file: string } {
  const receipt = lapReceipt(root, id, options);
  refuseLegacyState(root);
  const file = lapPath(root, receipt.request);
  mkdirSync(dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify(receipt, null, 2)}\n`);
  renameSync(temp, file);
  return { receipt, file };
}
