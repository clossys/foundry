import { OrderedStepSequence } from "../../blocks/OrderedStepSequence.js";
import type { OrderedStepSequenceItem } from "../../blocks/OrderedStepSequence.js";
import { anatomyOf, numberField, recordsOf, refuseUnmapped, requireSlot, stringField, type SectionInputs, type SectionRenderer } from "./group-c-content.js";

const LEAF = "sections.steps";

/** steps -> OrderedStepSequence.items, ordinal defaulting to the step's position. */
export const stepsInputs: SectionInputs = { slots: ["steps"], members: [] };

export const renderSteps: SectionRenderer = input => {
  refuseUnmapped(input, stepsInputs);
  const items = recordsOf(LEAF, "steps", requireSlot(input, LEAF, "steps")).map((row, index): OrderedStepSequenceItem => {
    const id = stringField(row, "id"), heading = stringField(row, "heading") ?? stringField(row, "label");
    if (!id || !heading) throw new TypeError(`${LEAF}: step ${index} needs an id and a heading`);
    const description = stringField(row, "description");
    return { id, ordinal: numberField(row, "ordinal") ?? stringField(row, "ordinal") ?? index + 1, heading, ...(description ? { description } : {}) };
  });
  const { eyebrow, heading, description } = anatomyOf(input);
  return <OrderedStepSequence eyebrow={eyebrow} heading={heading} description={description} items={items} />;
};
