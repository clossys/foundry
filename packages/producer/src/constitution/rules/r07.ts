/**
 * R07.6 Frame regions (slot-constitution.md R07.6; unit W2-D, foundry-feedback-0013).
 *
 * A region slot is a Designer slot placed under IA l1 `frames.regions` (header, sidebar, footer,
 * inspector). A frame is a Designer slot whose id starts with `frames.` or whose contract kind is
 * `frame`. Two findings:
 * - a pinned region slot that no frame lists in slot.json `uses` (the region is never composed);
 * - a frame's pinned candidate that inlines a copy of a region's component files: a registry file
 *   whose basename or bytes equal a component file of the region's pinned candidate. A region's
 *   component files are its `files[]` entries with no install `target` (that is a demo page) and
 *   that are not the licence; the frame must compose the slot instead.
 */
import type { CandidateRecord, ConstitutionContext, Row, SlotRecord } from "../types.js";
import { isObject, listed, liveSlotRecords, registryFiles, row, slotDoc, stringList } from "../checks/shared.js";
import { isCurrentSlot } from "../../records/slot-current.js";

const basename = (path: string) => path.split("/").pop()!;
const LICENCE = /^licen[cs]e(\.[a-z]+)?$/i;


export function isRegion(slot: SlotRecord): boolean {
  const doc = slotDoc(slot), ia = doc?.ia;
  // The regions L1 in either format: the ia.json node id (slot/1) or its slash path (slot/2).
  return slot.agent === "designer" && isObject(ia) && ia.l1 === (isCurrentSlot(doc) ? "frames/regions" : "frames.regions");
}

export function isFrame(slot: SlotRecord): boolean {
  const contract = slotDoc(slot)?.contract;
  return slot.agent === "designer" && (slot.id.startsWith("frames.") || (isObject(contract) && contract.kind === "frame"));
}

export function pinnedCandidate(slot: SlotRecord): CandidateRecord | undefined {
  const pin = slot.pin?.value;
  const name = isObject(pin) && typeof pin.candidate === "string" ? pin.candidate : undefined;
  return name ? slot.candidates.find(candidate => candidate.name === name) : undefined;
}

/** The region's component files: pinned registry files without an install target, minus the licence. */
export function regionFiles(region: SlotRecord): { path: string; content: string }[] {
  const pinned = pinnedCandidate(region);
  return pinned ? registryFiles(pinned).filter(file => !file.target && !LICENCE.test(basename(file.path))) : [];
}

export function frameRegions(ctx: ConstitutionContext): Row[] {
  const live = new Map<string, SlotRecord>();
  for (const slot of liveSlotRecords(ctx)) if (!live.has(slot.id)) live.set(slot.id, slot);
  const frames = [...live.values()].filter(isFrame);
  const regions = frames.filter(slot => isRegion(slot) && pinnedCandidate(slot));
  const rows: Row[] = [];
  for (const region of regions) {
    const consumers = frames.filter(frame => frame.id !== region.id && stringList(slotDoc(frame)?.uses).includes(region.id));
    if (!consumers.length) rows.push(row("R07", "R07.6", region, "pinned region slot is in no frame's uses (no frame composes it)", region.slot?.path ?? region.dir));
  }
  for (const frame of frames) {
    const candidate = pinnedCandidate(frame);
    if (!candidate) continue;
    const files = registryFiles(candidate);
    for (const region of regions) {
      if (region.id === frame.id) continue;
      const own = regionFiles(region);
      const names = new Set(own.map(file => basename(file.path)));
      const bytes = new Set(own.map(file => file.content).filter(Boolean));
      const copied = files.filter(file => names.has(basename(file.path)) || bytes.has(file.content)).map(file => file.path).sort();
      if (copied.length) rows.push(row("R07", "R07.6", frame, `inlines a copy of region ${region.id} (${copied.length} file${copied.length === 1 ? "" : "s"}: ${listed(copied, 4)}); compose the slot via uses`, candidate.path, candidate.name));
    }
  }
  return rows;
}
