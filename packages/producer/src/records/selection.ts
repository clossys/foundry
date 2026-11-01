import { readElementVersion, verifyElementVersion } from "./library.js";
import { guardDesignerFlow, ownerApproval } from "./owner-approval.js";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ElementRecord, Pins, PinEvent, Release, Selection } from "./types.js";
import { foldHistory, loadRelease, RecordError, validateRelease, validateSelection } from "./validate.js";
import { checkElement, type RefVerbatimFinding } from "@clossys/designer/ref-verbatim";

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

/** Where the pin gate reads the element version: the consumer's `clossys/` root (it holds `library/`). */
export type PinGateInput = {
  readonly root: string;
  /** The consumer's components.json; default `<root>/components.json`, then `<root>/../components.json`. */
  readonly components?: string;
  /** Owner decision for a creation; stock reference picks need provenance only. */
  readonly approval?: string;
};

export type PinInput = PinGateInput & {
  readonly element: Pick<ElementRecord, "slot" | "id" | "version" | "hash">;
  readonly at: string;
  readonly by: string;
  readonly from?: PinEvent["from"];
  readonly reason?: string;
};

/** pin() or restore() refused an element version that fails the ref-verbatim gate. */
export class PinRefusedError extends Error {
  constructor(
    readonly key: string,
    readonly findings: readonly RefVerbatimFinding[],
  ) {
    super(`pin refused: ${key} fails the ref-verbatim gate\n- ${findings.map((f) => `${f.code}${f.file ? ` ${f.file}` : ""}: ${f.detail}`).join("\n- ")}`);
    this.name = "PinRefusedError";
  }
}

/**
 * The pin gate (@clossys/designer/ref-verbatim, strict): every code file the
 * version ships must be its recorded reference file plus allowed hunks only.
 * The ref-verbatim baseline never applies here; every new pin passes or is refused.
 */
function gate(gateInput: PinGateInput, element: { slot: string; id: string; version: number; hash: string }): void {
  const libraryRoot = join(gateInput.root, "library");
  const issues = verifyElementVersion(libraryRoot, element.slot, element.id, element.version);
  if (issues.length) throw new RecordError("pin payload bytes", issues);
  const record = readElementVersion(libraryRoot, element.slot, element.id, element.version).element;
  if (record.hash !== element.hash) throw new Error("PIN-HASH: target hash differs from the verified payload record");
  if (record?.lineage?.path === "create") guardDesignerFlow(gateInput.root, record);
  const checked = checkElement(gateInput.root, { slot: element.slot, element: element.id, version: element.version }, {
    strict: true,
    ...(gateInput.components ? { components: gateInput.components } : {}),
  });
  if (checked.findings.length) throw new PinRefusedError(checked.key, checked.findings);
  // Picking verified reference bytes is already authorized. Only a creation
  // requires an owner decision, never a self-authored approval.
  if (record?.lineage?.path === "create" || !record?.lineage?.source) {
    ownerApproval(gateInput.root, gateInput.approval, { action: "pin", slot: element.slot, element: element.id, version: element.version, hash: element.hash }, record?.creator?.agent);
  }
}

/** Pin one element version to its slot, after the ref-verbatim gate. Returns a new selection; history only grows. */
export function pin(selection: Selection, input: PinInput): Selection {
  const { element } = input;
  gate(input, element);
  return append(selection, {
    id: nextEventId(selection),
    at: input.at,
    by: input.by,
    ...(input.approval !== undefined ? { approval: input.approval } : {}),
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
export function restore(selection: Selection, eventId: string, input: PinGateInput & { at: string; by: string; reason?: string }): Selection {
  const target = selection.history.find((event) => event.id === eventId);
  if (!target || target.action === "unpin") throw new Error(`no pin event ${eventId} to restore`);
  gate(input, { slot: target.slot, id: target.element!, version: target.version!, hash: target.hash! });
  return append(selection, {
    id: nextEventId(selection),
    at: input.at,
    by: input.by,
    action: "restore",
    ...(input.approval !== undefined ? { approval: input.approval } : {}),
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
  const currentPath = join(root, SELECTION_FILE);
  const previous = existsSync(currentPath) ? JSON.parse(readFileSync(currentPath, "utf8")) : emptySelection();
  const oldHistory = previous.history ?? [];
  if (oldHistory.some((event: PinEvent, index: number) => JSON.stringify(event) !== JSON.stringify(checked.value.history[index]))) throw new Error("selection history is append-only");
  for (const event of checked.value.history.slice(oldHistory.length)) {
    if (event.action !== "unpin") gate({ root, approval: event.approval }, { slot: event.slot, id: event.element!, version: event.version!, hash: event.hash! });
  }
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
