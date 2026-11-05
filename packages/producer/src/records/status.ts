import { listSlots, readCandidate, readSlot } from "./slots.js";
import { validateCandidate } from "./slot-model/index.js";
import type { Hash, PinState, ReferenceRef, ReferencesManifest } from "./types.js";
import { parseJson } from "../errors.js";

/**
 * Slot status for the Producer overview. One status per slot, by precedence:
 *   missing    no pin, or the pinned version cannot be read
 *   failing    a check failed, or the payload no longer matches its hash
 *   stale      an upstream hash changed after the pin (the lineage source
 *              reference)
 *   unreleased reserved: the slot model has no release snapshots
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

/** The current hash of an upstream reference, or undefined when it no longer exists. */
export type ReferenceHash = (source: ReferenceRef) => Hash | undefined;

/** A reference-hash resolver over package manifests (for example Designer's references/manifest.json). */
export function manifestReferenceHash(manifests: readonly ReferencesManifest[]): (source: ReferenceRef) => Hash | undefined {
  const index = new Map<string, Hash>();
  for (const manifest of manifests) for (const item of manifest.items) index.set(`${item.registry}/${item.name}@${item.version}`, item.hash);
  return (source) => index.get(`${source.registry}/${source.item}@${source.version}`);
}

const candidateVersion = (name: string) => Number(/-v([1-9][0-9]*)\.json$/.exec(name)?.[1] ?? 0);
const object = (value: unknown): value is Record<string, any> => typeof value === "object" && value !== null && !Array.isArray(value);
/** Registry references a candidate's `meta.source.ref` records as JSON identities; a ref that opens a JSON identity but does not parse is malformed. */
function referencesOf(refs: unknown): { refs: ReferenceRef[]; malformed: string[] } {
  const out: ReferenceRef[] = [], malformed: string[] = [];
  if (!Array.isArray(refs)) return { refs: out, malformed };
  for (const ref of refs) {
    if (typeof ref !== "string" || !ref.startsWith("{")) continue;
    const parsed = parseJson(ref);
    if (!parsed.ok) { malformed.push(`${ref} (${parsed.message})`); continue; }
    const value = parsed.value;
    if (object(value) && typeof value.registry === "string" && typeof value.item === "string" && typeof value.version === "string" && typeof value.hash === "string") out.push(value as ReferenceRef);
  }
  return { refs: out, malformed };
}

/**
 * Status straight from a consumer's Designer slot model (`<root>/agents/designer`):
 * each slot's `pin.json` and the candidate it names. The slot model has no
 * release snapshots, so `unreleased` never appears here.
 */
export function workspaceSlotStatus(
  root: string,
  options: { slots?: readonly string[]; referenceHash: ReferenceHash },
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
      const parsed = parseJson(candidate.bytes);
      const item: Record<string, any> | undefined = parsed.ok && object(parsed.value) ? parsed.value : undefined;
      if (!parsed.ok) detail.push(`pinned candidate ${pin.candidate} is not JSON: ${parsed.message}`);
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
      const references = referencesOf(item?.meta?.source?.ref);
      for (const ref of references.malformed) {
        flags.add("failing");
        detail.push(`meta.source.ref ${ref} is not a JSON identity`);
      }
      for (const source of references.refs) {
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
