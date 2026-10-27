/**
 * sections.band: SectionFrame with the selected ground and measure. The contract has no content slots; the band
 * frames whatever nodes the host places in it (`input.slots`, in slot-name order).
 */
import type { ReactNode } from "react";
import { SectionFrame } from "../../blocks/SectionFrame.js";
import { memberValue, readSectionContent, type SectionRenderInput, type SectionRendererInputs } from "./group-a-content.js";

export const bandInputs: SectionRendererInputs = {
  slots: [],
  members: ["ground.base", "ground.sunken", "ground.inverse", "measure.prose", "measure.content", "measure.wide"],
};

export function renderBandSection(input: SectionRenderInput): ReactNode {
  const content = readSectionContent(input, "sections.band", bandInputs);
  const ground = memberValue(content, "ground", ["base", "sunken", "inverse"] as const);
  const measure = memberValue(content, "measure", ["prose", "content", "wide"] as const);
  const placed = Object.keys(input.slots).sort().flatMap(slot => input.slots[slot]!);
  return <SectionFrame ground={ground} measure={measure}>{placed}</SectionFrame>;
}
