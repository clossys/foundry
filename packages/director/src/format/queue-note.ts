/**
 * The note `clossys migrate requests` (Producer, foundry-build-0048 U8) appends to a queue entry's `raised` event when
 * the event carries a legacy request record: `<the raise's own why>` + MIGRATED_RAISE_NOTE + `<record id>, <file>...)`,
 * the record itself after it. One constant for the writer (Producer) and every reader (Director, Designer), so the
 * format cannot drift between them.
 */
export const MIGRATED_RAISE_NOTE = "\n(migrated by clossys migrate requests from ";

/** The raise's own why in a raised event's detail: the text before the migration note, or the whole detail when it has none. */
export function raiseWhyOf(detail: string): string {
  const at = detail.lastIndexOf(MIGRATED_RAISE_NOTE);
  return at >= 0 ? detail.slice(0, at) : detail;
}
