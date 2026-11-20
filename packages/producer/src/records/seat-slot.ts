/**
 * A seat as a `clossys.slot/2` slot (foundry-build-0048 U13): the one builder `clossys seat` and
 * `clossys migrate slots` share, so a seat written by the verb and a seat converted from slot/1 are
 * the same file. A seat slot is kind `seat`, agent `producer`, its contract the decide step it seats
 * (`{step, fixture: {step}}`, pipeline/schemas/contract-seat.schema.json); it has no refs and no base.
 */
import { positionIa, SLOT_SCHEMA, validateSlot } from "./slot.js";
import type { Iso, Slot } from "./types.js";

export interface SeatSlotInput {
  readonly slotId: string;
  readonly step: string;
  readonly position: { readonly l0?: string; readonly l1?: string; readonly l2?: string; readonly order?: number };
  readonly status: Slot["status"];
  readonly createdBy: Slot["createdBy"];
  readonly at: Iso;
}

/** The slot/2 seat; throws when it is not a valid clossys.slot/2. */
export function seatSlot(input: SeatSlotInput): Slot {
  const slot: Slot = {
    schema: SLOT_SCHEMA, id: input.slotId, agent: "producer", kind: "seat", status: input.status,
    ia: positionIa(input.slotId, input.position), createdBy: input.createdBy, createdAt: input.at,
    refs: [], base: null, standard: "seat",
    // DRAFT copy (not owner-approved).
    brief: { purpose: `Seat the ${input.step} decide step: who decides it, with which llm and which human procedure.`, mustDo: [], inputs: [], acceptance: [] },
    contract: { step: input.step, fixture: { step: input.step } }, tighten: [],
  };
  const issues = validateSlot(slot);
  if (issues.length) throw new Error(`producer/${input.slotId}: the seat is not a valid ${SLOT_SCHEMA}: ${issues.slice(0, 3).map(issue => `${issue.path} ${issue.message}`).join("; ")}`);
  return slot;
}
