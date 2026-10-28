/** The closed content hierarchy, in presentation order. */
export const CONTENT_TAXONOMY = Object.freeze({
  websites: Object.freeze(["site", "admin", "auth", "app", "demo"] as const),
  documents: Object.freeze(["docs"] as const),
  presentations: Object.freeze(["decks"] as const),
  videos: Object.freeze(["clips"] as const),
  messages: Object.freeze(["email"] as const),
  social: Object.freeze(["posts"] as const),
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

export type SlotId = `sl_${string}`;

/** Accept only ten lowercase RFC 4648 base32 characters after the prefix. */
export function isSlotId(value: unknown): value is SlotId {
  return typeof value === "string" && value.length === 13 && /^sl_[a-z2-7]{10}$/.test(value);
}

const SLOT_ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz234567";

/** Mint once at creation; preserve the id when a slot moves or is renamed. */
export function createSlotId(existingIds: ReadonlySet<string> = new Set()): SlotId {
  for (let attempt = 0; attempt < 128; attempt++) {
    const bytes = globalThis.crypto.getRandomValues(new Uint8Array(10));
    // Each byte contributes five unbiased bits, independent of any slot address.
    const suffix = Array.from(bytes, byte => SLOT_ID_ALPHABET[byte & 31]).join("");
    const id: SlotId = `sl_${suffix}`;
    if (!existingIds.has(id)) return id;
  }
  throw new Error("Unable to mint a unique slot id after 128 attempts");
}
