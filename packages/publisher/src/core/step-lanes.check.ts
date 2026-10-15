import type { SectionedViewItemsBlock } from "./sectioned-view.js";
export const valid: SectionedViewItemsBlock = { type: "items", recipe: "steps", arrangement: "stacked", lanes: [{ id: "sender", label: { id: "sender" } }, { id: "reviewer", label: { id: "reviewer" } }], caption: { id: "caption" }, end: "ends", endLabel: { id: "end" }, items: [{ id: "one", lane: "sender", heading: { id: "heading" }, meta: { id: "actor" } }] };
// @ts-expect-error Actor labels are CopyRefs, never raw strings.
export const invalidLaneLabel: SectionedViewItemsBlock = { type: "items", recipe: "steps", arrangement: "stacked", lanes: [{ id: "sender", label: "Sender" }], items: [] };
// @ts-expect-error Authored fields remain CopyRefs.
export const invalidCaption: SectionedViewItemsBlock = { type: "items", recipe: "steps", arrangement: "stacked", items: [], caption: "Sample data." };
// @ts-expect-error No listLabel authoring escape hatch.
export const invalidListLabel: SectionedViewItemsBlock = { type: "items", recipe: "steps", arrangement: "stacked", items: [], listLabel: { id: "label" } };
