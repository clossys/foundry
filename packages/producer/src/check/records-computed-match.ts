/**
 * `records.computed-match` (system.md 9): a field the CLI computes equals what `clossys ia sync` would write.
 *
 * Reads every consumer slot folder. Fails on a `slot.json` that is not a valid `clossys.slot/2` (a slot/1 file
 * names `clossys migrate slot-1-to-2`), and, for a package slot, on any computed field (records/slot.ts
 * COMPUTED_FIELDS) that differs from its installed base. `tighten`, `status`, `ia.order`, the CLI stamps and
 * `consumedBy` refs are not computed from the base and are not compared. A consumer-added slot (`base: null`)
 * has no base to compute from: only its format is checked.
 */
import { SLOT_SCHEMA, SLOT_V1_SCHEMA, computedDiff, consumerSlotFolders, readSlot, slotSchemaOf, treeResult, type TreeCheck, type TreeCheckResult, type TreeFinding } from "../records/slot.js";
import type { Slot } from "../records/types.js";
import { resolveSlotBase } from "./declared-base.js";

export const RECORDS_COMPUTED_MATCH = "records.computed-match";

export function runRecordsComputedMatch(root: string): TreeCheckResult {
  const findings: TreeFinding[] = [];
  for (const folder of consumerSlotFolders(root)) {
    if (!folder.hasSlot) continue;
    const subject = `${folder.agent}/${folder.id}`;
    const schema = slotSchemaOf(folder.file);
    if (schema === SLOT_V1_SCHEMA) { findings.push({ subject, detail: `${SLOT_V1_SCHEMA}: run clossys migrate slot-1-to-2` }); continue; }
    if (schema !== SLOT_SCHEMA) { findings.push({ subject, detail: `slot.json schema is ${schema ?? "missing"}, expected ${SLOT_SCHEMA}` }); continue; }
    let slot: Slot;
    try { slot = readSlot(folder.file); } catch (error) { findings.push({ subject, detail: (error as Error).message }); continue; }
    if (slot.id !== folder.id || slot.agent !== folder.agent) { findings.push({ subject, detail: `slot.json names ${slot.agent}/${slot.id}, not its folder` }); continue; }
    if (slot.base === null) continue;
    let base;
    try { base = resolveSlotBase(root, slot); } catch (error) { findings.push({ subject, detail: (error as Error).message }); continue; }
    if (!base) { findings.push({ subject, detail: `base ${slot.base.package}/${slot.base.path} is not installed; nothing to compute from` }); continue; }
    const fields = computedDiff(slot, base);
    if (fields.length) findings.push({ subject, detail: `computed field(s) ${fields.join(", ")} differ from what clossys ia sync writes` });
  }
  return treeResult(RECORDS_COMPUTED_MATCH, findings);
}

export const recordsComputedMatch: TreeCheck = { id: RECORDS_COMPUTED_MATCH, run: runRecordsComputedMatch };
