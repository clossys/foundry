import { UsageSummary, type UsageSummaryMeter } from "../../blocks/UsageSummary.js";
import { recordsOf, type GroupBSection, type SectionRenderInput } from "./group-b-support.js";
import { specimenDataset } from "../../studio/specimen-dataset.js";

/** sections.usage: each meter record renders through UsageSummary's UsageMeter. */
export function renderUsage(input: SectionRenderInput) {
  return <UsageSummary
    aria-label={specimenDataset.sections.usageSummary["aria-label"]}
    meters={recordsOf<UsageSummaryMeter>(input, "meters")}
    emptyState={specimenDataset.sections.usageSummary.emptyState}
  />;
}

export const usageSection: GroupBSection = { leaf: "sections.usage", slots: ["meters"], render: renderUsage };
