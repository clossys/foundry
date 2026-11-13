import { studioCopy } from './studio-copy';
import type { SlotCardState } from '../../src/server/slot-gallery';

/**
 * Where a Studio status comes from: the check that decided it and that check's result.
 * Slot statuses are the shared slot loader's decisions (records/slots.ts), the same ones
 * `check:slot-state` (pinned or not-needed) and `check:slot-pins` (the pin names a valid
 * candidate whose bytes match) report. A status with nothing behind it has no citation and
 * reads as not run; it is never guessed.
 */
export interface StatusCitation { source: string; result: string }

export const SLOT_STATE_CHECK = 'check:slot-state';
export const SLOT_PINS_CHECK = 'check:slot-pins';

const result = (ok: boolean) => studioCopy(ok ? 'studio.pipeline.status.passed' : 'studio.pipeline.status.failed');

/** A check id and its result, as a status citation. */
export function checkCitation(check: string, ok: boolean): StatusCitation {
  return { source: check, result: result(ok) };
}

/** The "Not run" label: what a status with no run record or check result shows instead. */
export const notRunLabel = () => studioCopy('studio.pipeline.status.not-run');

/**
 * The citation of a slot's state: a rejected state is `check:slot-state` failing (no pin, a pin
 * beside not-needed, an invalid slot), except an invalid pin, which is `check:slot-pins` failing;
 * a pinned slot passes `check:slot-pins` (pinned and valid), a not-needed one `check:slot-state`.
 */
export function slotStateCitation(state: SlotCardState, pinValid: boolean): StatusCitation {
  if (state.state === 'not-needed') return checkCitation(SLOT_STATE_CHECK, true);
  if (state.state === 'rejected') return checkCitation(state.reason === 'invalid-pin' ? SLOT_PINS_CHECK : SLOT_STATE_CHECK, false);
  return checkCitation(SLOT_PINS_CHECK, pinValid);
}
