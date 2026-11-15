/**
 * `pins.resolve` (system.md 9): every consumer slot resolves by the two-step order of records/resolve.ts.
 *
 * Fails when a slot (or a record of a Writer record slot) has no pin and no package default, or when a pin is
 * present but broken: not pin/2 (an int2 pin/1 left unmigrated), a schema or provenance issue (an owner basis
 * with no queue answer ref), a missing candidate, or a sha256 that does not match the candidate bytes.
 * Retired slots are skipped. Reads only `clossys/` and the installed packages.
 */
import { pinPath } from "../records/pin.js";
import { readPinFile } from "../records/pin-map.js";
import { isRecordSlot, listConsumerSlots, readSlotJson, resolveSlot, slotRecords, type Resolution } from "../records/resolve.js";

export interface TargetFinding {
  readonly check: string;
  /** `<agent>/<slot-id>[#record]`, `<agent>/<slot-id>/<candidate>`, or the file the finding is about. */
  readonly subject: string;
  readonly detail: string;
}

export interface TargetCheckRun {
  readonly check: string;
  readonly status: "pass" | "fail";
  readonly findings: readonly TargetFinding[];
}

export const PINS_RESOLVE = "pins.resolve";

export const runOf = (check: string, findings: readonly TargetFinding[]): TargetCheckRun =>
  ({ check, status: findings.length ? "fail" : "pass", findings });

const subjectOf = (resolution: Resolution): string =>
  `${resolution.agent}/${resolution.slotId}${resolution.record !== undefined ? `#${resolution.record}` : ""}`;

/** Every resolution `pins.resolve` judges (exported for the read models). */
export function resolveAll(root: string): Resolution[] {
  const out: Resolution[] = [];
  for (const { agent, slotId } of listConsumerSlots(root)) {
    if (readSlotJson(root, agent, slotId)?.status === "retired") continue;
    const pin = readPinFile(pinPath(root, agent, slotId), { agent, slotId });
    if (!isRecordSlot(root, agent, slotId, pin)) { out.push(resolveSlot(root, agent, slotId)); continue; }
    const records = slotRecords(root, agent, slotId);
    if (records.length === 0) out.push({ state: "unresolved", agent, slotId, reason: "record slot with no pinned record and no package default" });
    for (const record of records) out.push(resolveSlot(root, agent, slotId, record));
  }
  return out;
}

export function checkPinsResolve(root: string): TargetCheckRun {
  const findings: TargetFinding[] = [];
  for (const resolution of resolveAll(root)) {
    const subject = subjectOf(resolution);
    if (resolution.state === "unresolved") {
      const detail = [...new Set([resolution.pinIssue, resolution.reason].filter((text): text is string => !!text))].join("; ");
      findings.push({ check: PINS_RESOLVE, subject, detail });
    }
    else if (resolution.state === "sample" && resolution.pinIssue) findings.push({ check: PINS_RESOLVE, subject, detail: resolution.pinIssue });
  }
  return runOf(PINS_RESOLVE, findings);
}
