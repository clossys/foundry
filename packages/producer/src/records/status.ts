import { listSlots, readCandidate, readSlot } from "./slots.js";
import { validateCandidate } from "./slot-model/index.js";
import type { ElementRecord, Hash, PinState, ReferenceRef, ReferencesManifest, Release, Selection } from "./types.js";

/**
 * Slot status for the Producer overview. One status per slot, by precedence:
 *   missing    no pin, or the pinned version cannot be read
 *   failing    a check failed, or the payload no longer matches its hash
 *   stale      an upstream hash changed after the pin (the lineage source
 *              reference, or a dependency element whose pin moved)
 *   unreleased the pin differs from the latest release snapshot
 *   pinned     none of the above
 * `flags` lists every condition that holds, so a failing slot that is also
 * stale shows both.
 */
export type SlotStatus = "pinned" | "missing" | "failing" | "stale" | "unreleased";

export const STATUS_PRECEDENCE: readonly SlotStatus[] = ["missing", "failing", "stale", "unreleased", "pinned"];

export type SlotStatusRow = {
  readonly slot: string;
  readonly status: SlotStatus;
  readonly flags: readonly SlotStatus[];
  readonly pin?: PinState;
  readonly detail: readonly string[];
};

export type StatusInput = {
  /** Every slot that should have a pin (the package IA's L3 leaves). Pinned slots outside it are reported too. */
  readonly slots: readonly string[];
  readonly selection: Selection;
  /** Load the pinned record; return issues instead when it is unreadable or tampered with. */
  readonly readPinned: (slot: string, pin: PinState) => { record: ElementRecord; issues: readonly string[] } | { record?: undefined; issues: readonly string[] };
  /** The current hash of an upstream reference, or undefined when it no longer exists. */
  readonly referenceHash: (source: ReferenceRef) => Hash | undefined;
  readonly release?: Release;
};

function samePin(a: PinState | undefined, b: PinState | undefined): boolean {
  return !!a && !!b && a.element === b.element && a.version === b.version && a.hash === b.hash;
}

export function deriveSlotStatus(input: StatusInput): SlotStatusRow[] {
  const slots = [...new Set([...input.slots, ...Object.keys(input.selection.pins)])].sort();
  return slots.map((slot) => {
    const pin = input.selection.pins[slot];
    const flags = new Set<SlotStatus>();
    const detail: string[] = [];
    if (!pin) {
      flags.add("missing");
      detail.push("no pin");
    } else {
      const read = input.readPinned(slot, pin);
      detail.push(...read.issues);
      const record = read.record;
      if (!record) {
        flags.add("missing");
      } else {
        if (read.issues.length > 0) flags.add("failing");
        if (record.hash !== pin.hash) {
          flags.add("failing");
          detail.push(`pinned hash ${pin.hash} differs from record hash ${record.hash}`);
        }
        for (const check of record.checks) {
          if (check.status === "fail") {
            flags.add("failing");
            detail.push(`check ${check.id} failed`);
          }
        }
        const source = record.lineage.source;
        if (source?.hash) {
          const current = input.referenceHash(source);
          if (current !== source.hash) {
            flags.add("stale");
            detail.push(
              current === undefined
                ? `upstream ${source.registry}/${source.item}@${source.version} no longer exists`
                : `upstream ${source.registry}/${source.item}@${source.version} changed after the pin`,
            );
          }
        }
        for (const dep of record.deps.elements) {
          const current = input.selection.pins[dep.slot];
          if (!current || current.hash !== dep.hash) {
            flags.add("stale");
            detail.push(`dependency ${dep.slot} is now ${current ? `${current.element}@v${current.version}` : "unpinned"}`);
          }
        }
      }
      if (!samePin(pin, input.release?.pins[slot])) {
        flags.add("unreleased");
        detail.push(input.release ? `differs from release ${input.release.number}` : "no release yet");
      }
    }
    if (flags.size === 0) flags.add("pinned");
    const ordered = STATUS_PRECEDENCE.filter((status) => flags.has(status));
    return { slot, status: ordered[0]!, flags: ordered, ...(pin ? { pin } : {}), detail };
  });
}

/** A reference-hash resolver over package manifests (for example Designer's references/manifest.json). */
export function manifestReferenceHash(manifests: readonly ReferencesManifest[]): (source: ReferenceRef) => Hash | undefined {
  const index = new Map<string, Hash>();
  for (const manifest of manifests) for (const item of manifest.items) index.set(`${item.registry}/${item.name}@${item.version}`, item.hash);
  return (source) => index.get(`${source.registry}/${source.item}@${source.version}`);
}

const candidateVersion = (name: string) => Number(/-v([1-9][0-9]*)\.json$/.exec(name)?.[1] ?? 0);
const object = (value: unknown): value is Record<string, any> => typeof value === "object" && value !== null && !Array.isArray(value);
/** Registry references a candidate's `meta.source.ref` records as JSON identities. */
function referencesOf(refs: unknown): ReferenceRef[] {
  if (!Array.isArray(refs)) return [];
  return refs.flatMap((ref) => {
    if (typeof ref !== "string" || !ref.startsWith("{")) return [];
    try {
      const value = JSON.parse(ref);
      return object(value) && typeof value.registry === "string" && typeof value.item === "string" && typeof value.version === "string" && typeof value.hash === "string" ? [value as ReferenceRef] : [];
    } catch { return []; }
  });
}

/**
 * Status straight from a consumer's Designer slot model (`<root>/agents/designer`):
 * each slot's `pin.json` and the candidate it names. The slot model has no
 * release snapshots, so `unreleased` never appears here.
 */
export function workspaceSlotStatus(
  root: string,
  options: { slots?: readonly string[]; referenceHash: StatusInput["referenceHash"] },
): SlotStatusRow[] {
  const entries = listSlots(root, "designer");
  const pinned = new Set(entries.filter((entry) => entry.pin).map((entry) => entry.id));
  const wanted = options.slots ? new Set(options.slots) : undefined;
  return entries.filter((entry) => !wanted || wanted.has(entry.id)).map((entry) => {
    const flags = new Set<SlotStatus>();
    const detail: string[] = [];
    const pin = entry.pin;
    let state: PinState | undefined;
    if (!pin) {
      flags.add("missing");
      detail.push("no pin");
    } else if (!entry.candidates.includes(pin.candidate)) {
      flags.add("missing");
      detail.push(`pinned candidate ${pin.candidate} is missing`);
    } else {
      const candidate = readCandidate(root, "designer", entry.id, pin.candidate);
      let item: Record<string, any> | undefined;
      try { item = JSON.parse(candidate.bytes); } catch { /* reported below */ }
      state = { element: typeof item?.name === "string" ? item.name : pin.candidate, version: candidateVersion(pin.candidate), hash: `sha256:${pin.sha256}`, event: pin.at };
      if (candidate.sha256 !== pin.sha256) {
        flags.add("failing");
        detail.push(`pinned hash sha256:${pin.sha256} differs from candidate hash sha256:${candidate.sha256}`);
      }
      let issues: readonly unknown[];
      try { issues = validateCandidate(readSlot(root, "designer", entry.id).kind, entry.id, pin.candidate, candidate.bytes); }
      catch (error) { issues = [(error as Error).message]; }
      if (!item || issues.length) {
        flags.add("failing");
        detail.push(`pinned candidate ${pin.candidate} is invalid`);
      }
      const element = object(item?.meta?.element) ? item!.meta.element : {};
      for (const check of Array.isArray(element.checks) ? element.checks : []) {
        if (check?.status === "fail") {
          flags.add("failing");
          detail.push(`check ${check.id} failed`);
        }
      }
      for (const source of referencesOf(item?.meta?.source?.ref)) {
        const current = options.referenceHash(source);
        if (current !== source.hash) {
          flags.add("stale");
          detail.push(current === undefined
            ? `upstream ${source.registry}/${source.item}@${source.version} no longer exists`
            : `upstream ${source.registry}/${source.item}@${source.version} changed after the pin`);
        }
      }
      for (const dep of Array.isArray(element.deps?.elements) ? element.deps.elements : []) {
        if (typeof dep?.slot === "string" && !pinned.has(dep.slot)) {
          flags.add("stale");
          detail.push(`dependency ${dep.slot} is now unpinned`);
        }
      }
    }
    if (flags.size === 0) flags.add("pinned");
    const ordered = STATUS_PRECEDENCE.filter((status) => flags.has(status));
    return { slot: entry.id, status: ordered[0]!, flags: ordered, ...(state ? { pin: state } : {}), detail };
  });
}
