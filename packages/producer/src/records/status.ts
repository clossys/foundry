import { existsSync } from "node:fs";
import { join } from "node:path";
import { readElementVersion, verifyElementVersion } from "./library.js";
import { emptySelection, latestRelease, SELECTION_FILE } from "./selection.js";
import type { ElementRecord, Hash, PinState, ReferenceRef, ReferencesManifest, Release, Selection } from "./types.js";
import { loadSelection, RecordError } from "./validate.js";

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

/**
 * Status straight from a consumer workspace: `<root>/selection.json`,
 * `<root>/library/` and `<root>/releases/`.
 */
export function workspaceSlotStatus(
  root: string,
  options: { slots: readonly string[]; referenceHash: StatusInput["referenceHash"] },
): SlotStatusRow[] {
  const selectionPath = join(root, SELECTION_FILE);
  const selection = existsSync(selectionPath) ? loadSelection(selectionPath) : emptySelection();
  const libraryRoot = join(root, "library");
  const release = latestRelease(root);
  return deriveSlotStatus({
    slots: options.slots,
    selection,
    referenceHash: options.referenceHash,
    ...(release ? { release } : {}),
    readPinned: (slot, pin) => {
      try {
        const { element } = readElementVersion(libraryRoot, slot, pin.element, pin.version);
        return { record: element, issues: verifyElementVersion(libraryRoot, slot, pin.element, pin.version).map((i) => `${i.path}: ${i.message}`) };
      } catch (error) {
        if (error instanceof RecordError || (error as NodeJS.ErrnoException).code === "ENOENT") {
          return { issues: [`pinned ${pin.element}@v${pin.version} unreadable: ${(error as Error).message.split("\n")[0]}`] };
        }
        throw error;
      }
    },
  });
}
