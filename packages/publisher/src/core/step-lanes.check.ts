import type { SectionedViewOrderedStepSequenceBlock, SectionedViewStepLane } from "./sectioned-view.js";
export const lane: SectionedViewStepLane = "b";
export const valid: SectionedViewOrderedStepSequenceBlock = { type: "ordered-step-sequence", lanes: { a: { id: "a" }, b: { id: "b" } }, caption: { id: "caption" }, end: "ends", endLabel: { id: "end" }, items: [{ id: "a", lane: "a", ordinal: { id: "ordinal" }, heading: { id: "heading" } }] };
// @ts-expect-error actors are the closed two-lane vocabulary
export const invalidLane: SectionedViewStepLane = "c";
// @ts-expect-error authored fields remain CopyRefs
export const invalidCaption: SectionedViewOrderedStepSequenceBlock = { type: "ordered-step-sequence", items: [], caption: "Sample data." };
// @ts-expect-error no listLabel authoring escape hatch
export const invalidListLabel: SectionedViewOrderedStepSequenceBlock = { type: "ordered-step-sequence", items: [], listLabel: { id: "label" } };
