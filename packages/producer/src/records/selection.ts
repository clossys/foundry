import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ElementRecord, Pins, PinEvent, Release, Selection } from "./types.js";
import { foldHistory, loadRelease, RecordError, validateRelease, validateSelection } from "./validate.js";

export const SELECTION_FILE = "selection.json";
export const RELEASES_DIR = "releases";

export function emptySelection(): Selection {
  return { schema: "clossys.selection/1", pins: {}, history: [] };
}

function nextEventId(selection: Selection): string {
  return `e${selection.history.length + 1}`;
}

function append(selection: Selection, event: PinEvent): Selection {
  const history = [...selection.history, event];
  const next: Selection = { schema: selection.schema, pins: foldHistory(history), history };
  const checked = validateSelection(next);
  if (!checked.ok) throw new RecordError("selection", checked.issues);
  return checked.value;
}

export type PinInput = {
  readonly element: Pick<ElementRecord, "slot" | "id" | "version" | "hash">;
  readonly at: string;
  readonly by: string;
  readonly from?: PinEvent["from"];
  readonly reason?: string;
};

/** Pin one element version to its slot. Returns a new selection; history only grows. */
export function pin(selection: Selection, input: PinInput): Selection {
  const { element } = input;
  return append(selection, {
    id: nextEventId(selection),
    at: input.at,
    by: input.by,
    action: "pin",
    slot: element.slot,
    element: element.id,
    version: element.version,
    hash: element.hash,
    ...(input.from ? { from: input.from } : {}),
    ...(input.reason ? { reason: input.reason } : {}),
  });
}

/** Re-apply an earlier pin event as a new event. History is never rewritten. */
export function restore(selection: Selection, eventId: string, input: { at: string; by: string; reason?: string }): Selection {
  const target = selection.history.find((event) => event.id === eventId);
  if (!target || target.action === "unpin") throw new Error(`no pin event ${eventId} to restore`);
  return append(selection, {
    id: nextEventId(selection),
    at: input.at,
    by: input.by,
    action: "restore",
    slot: target.slot,
    element: target.element!,
    version: target.version!,
    hash: target.hash!,
    from: "version",
    restores: target.id,
    ...(input.reason ? { reason: input.reason } : {}),
  });
}

export function unpin(selection: Selection, slot: string, input: { at: string; by: string; reason?: string }): Selection {
  return append(selection, {
    id: nextEventId(selection),
    at: input.at,
    by: input.by,
    action: "unpin",
    slot,
    ...(input.reason ? { reason: input.reason } : {}),
  });
}

/** The pins in force at a moment ("page as of a date"). */
export function pinsAt(selection: Selection, at: string): Pins {
  return foldHistory(selection.history.filter((event) => event.at <= at));
}

export function writeSelection(root: string, selection: Selection): void {
  const checked = validateSelection(selection);
  if (!checked.ok) throw new RecordError("selection", checked.issues);
  writeFileSync(join(root, SELECTION_FILE), `${JSON.stringify(checked.value, null, 2)}\n`);
}

/** Snapshot the current pins as release `number`. */
export function createRelease(selection: Selection, input: { number: number; at: string; by: string; notes?: string }): Release {
  const release: Release = {
    schema: "clossys.release/1",
    number: input.number,
    at: input.at,
    by: input.by,
    pins: selection.pins,
    selectionEvent: selection.history.at(-1)?.id ?? null,
    ...(input.notes ? { notes: input.notes } : {}),
  };
  const checked = validateRelease(release);
  if (!checked.ok) throw new RecordError(`release ${input.number}`, checked.issues);
  return checked.value;
}

export function releasePath(root: string, number: number): string {
  return join(root, RELEASES_DIR, `${number}.json`);
}

/** Write `releases/<n>.json`; an existing release is never overwritten. */
export function writeRelease(root: string, release: Release): string {
  const path = releasePath(root, release.number);
  if (existsSync(path)) throw new Error(`${path} already exists; releases are immutable`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(release, null, 2)}\n`, { flag: "wx" });
  return path;
}

export function latestRelease(root: string): Release | undefined {
  const dir = join(root, RELEASES_DIR);
  if (!existsSync(dir)) return undefined;
  const numbers = readdirSync(dir)
    .map((name) => /^([1-9][0-9]*)\.json$/.exec(name)?.[1])
    .filter((n): n is string => n !== undefined)
    .map(Number)
    .sort((a, b) => a - b);
  const last = numbers.at(-1);
  return last === undefined ? undefined : loadRelease(releasePath(root, last));
}
