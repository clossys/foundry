/** The closed content hierarchy. Slot ids retain their creation address after moves. */
export const CONTENT_TAXONOMY = Object.freeze({
  websites: Object.freeze(["site", "app", "admin", "demo", "internal"] as const),
  documents: Object.freeze(["slides", "docs"] as const),
  communications: Object.freeze(["messages", "videos"] as const),
});

export type ContentL1 = keyof typeof CONTENT_TAXONOMY;
export type ContentL2 = (typeof CONTENT_TAXONOMY)[ContentL1][number];
export type ContentPlacement = {
  [L in ContentL1]: { readonly l1: L; readonly l2: (typeof CONTENT_TAXONOMY)[L][number] }
}[ContentL1];

export function isContentPlacement(l1: unknown, l2: unknown): boolean {
  return typeof l1 === "string" && Object.hasOwn(CONTENT_TAXONOMY, l1)
    && typeof l2 === "string"
    && (CONTENT_TAXONOMY[l1 as ContentL1] as readonly string[]).includes(l2);
}

/** Issue once when creating a slot; moving a slot preserves this returned id. */
export function createSlotId(l1: ContentL1, l2: ContentL2, positionName: string): string {
  if (!isContentPlacement(l1, l2) || typeof positionName !== "string"
    || !positionName.trim()) {
    throw new TypeError("Slot creation requires a registered placement and a nonempty position name");
  }
  return `${l1}/${l2}/${positionName}`;
}
