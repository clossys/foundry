import { UsageSummary, type UsageSummaryMeter } from "../../blocks/UsageSummary.js";
import { recordsAs, type GroupBSection, type SectionRenderInput } from "./group-b-support.js";
import { specimenDataset } from "../../studio/specimen-dataset.js";

/** sections.usage: each meter record renders through UsageSummary's UsageMeter. */
export function renderUsage(input: SectionRenderInput) {
  return <UsageSummary
    aria-label={specimenDataset.sections.usageSummary["aria-label"]}
    meters={recordsAs<UsageSummaryMeter>(input, "meters", { "used-text": "usedText", "limit-text": "limitText", "period-text": "periodText", "projected-text": "projectedText" })}
    emptyState={specimenDataset.sections.usageSummary.emptyState}
  />;
}

export const usageSection: GroupBSection = { leaf: "sections.usage", slots: ["meters"], render: renderUsage };
