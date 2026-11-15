/**
 * `brief.tighten-only` (system.md 9): the resolved brief (base plus `tighten`) is never looser than the base.
 *
 * Reads every consumer `slot.json` (clossys.slot/2) and, for a package slot, the installed base at `base.path`.
 * Fails when a tighten entry is looser than the base on its path, when its op does not fit the field type,
 * when the base is missing, or when `base.sha256` does not match the installed package file.
 * A consumer-added slot (`base: null`, flows F4) is judged against its own brief.
 */
import { SLOT_SCHEMA, consumerSlotFolders, readBaseSlot, readSlot, slotSchemaOf, tightenIssue, treeResult, type TreeCheck, type TreeCheckResult, type TreeFinding } from "../records/slot.js";
import type { Slot } from "../records/types.js";

export const BRIEF_TIGHTEN_ONLY = "brief.tighten-only";

/** The findings for one slot (also run by `clossys brief --tighten` before it writes). */
export function tightenFindings(root: string, slot: Slot): TreeFinding[] {
  const subject = `${slot.agent}/${slot.id}`;
  let scope: { brief: unknown; contract: unknown } = slot;
  if (slot.base !== null) {
    let base;
    try { base = readBaseSlot(root, slot.agent, slot.id); } catch (error) { return [{ subject, detail: (error as Error).message }]; }
    if (!base) return [{ subject, detail: `base ${slot.base.package}/${slot.base.path} is not installed` }];
    if (base.meta.sha256 !== slot.base.sha256) return [{ subject, detail: `base.sha256 ${slot.base.sha256.slice(0, 8)} does not match the installed ${base.meta.package}@${base.version} (${base.meta.sha256.slice(0, 8)}); run clossys ia sync` }];
    scope = base.doc;
  }
  const out: TreeFinding[] = [];
  slot.tighten.forEach((entry, index) => {
    const issue = tightenIssue(scope, entry);
    if (issue) out.push({ subject, detail: `tighten[${index}] ${entry.op} ${issue}` });
  });
  return out;
}

export function runBriefTightenOnly(root: string): TreeCheckResult {
  const findings: TreeFinding[] = [];
  for (const folder of consumerSlotFolders(root)) {
    if (!folder.hasSlot || slotSchemaOf(folder.file) !== SLOT_SCHEMA) continue;
    let slot: Slot;
    try { slot = readSlot(folder.file); } catch (error) { findings.push({ subject: `${folder.agent}/${folder.id}`, detail: (error as Error).message }); continue; }
    findings.push(...tightenFindings(root, slot));
  }
  return treeResult(BRIEF_TIGHTEN_ONLY, findings);
}

export const briefTightenOnly: TreeCheck = { id: BRIEF_TIGHTEN_ONLY, run: runBriefTightenOnly };
