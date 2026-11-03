/**
 * Specimen states: how a slot shows its items when their resting render is empty or hidden.
 *
 * A slot declares one state and the specimen renderer applies it to every item pinned or
 * recorded in that slot, so no item needs a per-item specimen tweak. (Sample children need no
 * state: every item renders the children its preview fixture declares, see specimen-tree.ts.)
 * - `open`: the item's surface is opened on mount through the slot's opener
 *   (a toast region shows one toast instead of nothing);
 * - `visible`: content hidden until focus (`sr-only` with a focus-visible reveal) renders
 *   in its revealed form (a skip link shows instead of nothing).
 * A slot with no declaration renders the item at rest.
 */
export type SpecimenState =
  | { readonly state: "open"; readonly opener: { readonly module: string; readonly export: string }; readonly sample: string }
  | { readonly state: "visible" };

export const SLOT_SPECIMEN_STATES: Readonly<Record<string, SpecimenState>> = {
  "components.toast": { state: "open", opener: { module: "sonner", export: "toast" }, sample: "Changes saved" },
  "components.skip-nav": { state: "visible" },
};

export function specimenStateOf(slot: string): SpecimenState | undefined {
  return SLOT_SPECIMEN_STATES[slot];
}

/** CSS that renders `sr-only` content in its revealed form, scoped to a `visible` specimen. */
export const VISIBLE_STATE_CSS = "[data-specimen-state=visible] .sr-only{position:static;width:auto;height:auto;margin:0;padding:revert-layer;overflow:visible;clip:auto;clip-path:none;white-space:normal}";

/** Resolve a preview fixture value against the item's bound copy: `{ "$copy": key }` becomes its text. */
export function resolveSampleCopy(value: unknown, text: Readonly<Record<string, string>>): unknown {
  if (Array.isArray(value)) return value.map(item => resolveSampleCopy(item, text));
  if (!value || typeof value !== "object") return value;
  const node = value as Record<string, unknown>;
  if (typeof node.$copy === "string") return Object.hasOwn(text, node.$copy) ? text[node.$copy] : "";
  return Object.fromEntries(Object.entries(node).map(([key, item]) => [key, resolveSampleCopy(item, text)]));
}
