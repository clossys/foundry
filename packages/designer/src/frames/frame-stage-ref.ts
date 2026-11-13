/** A reference into the single canonical instance fills record. */
export interface FrameStageSectionRef { readonly slot: string; readonly index: number }
/** Shared with qualified runtime projection; delimiter-safe and order-stable. */
export function frameSectionRefKey(ref: FrameStageSectionRef): string {
  if (!ref.slot.trim() || !Number.isSafeInteger(ref.index) || ref.index < 0) throw new TypeError('Frame Section reference requires a slot and nonnegative index');
  return JSON.stringify([ref.slot, ref.index]);
}
