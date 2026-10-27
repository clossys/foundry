import { UsageSummary, type UsageSummaryMeter } from "../../blocks/UsageSummary.js";
import { recordsOf, type GroupBSection, type SectionRenderInput } from "./group-b-support.js";

/** sections.usage: each meter record renders through UsageSummary's UsageMeter. */
export function renderUsage(input: SectionRenderInput) {
  return <UsageSummary
    aria-label="Plan usage"
    meters={recordsOf<UsageSummaryMeter>(input, "meters")}
    emptyState={{ title: "No metered usage", description: "This plan has no usage limits." }}
  />;
}

export const usageSection: GroupBSection = { leaf: "sections.usage", slots: ["meters"], render: renderUsage };
