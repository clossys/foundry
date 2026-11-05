import { Timeline, type TimelineEvent } from "../../blocks/Timeline.js";
import { recordsAs, type GroupBSection, type SectionRenderInput } from "./group-b-support.js";

/** sections.timeline: dated events render as Timeline's ordered list. */
export function renderTimeline(input: SectionRenderInput) {
  const label = input.sectionHost?.timelineLabel;
  if (label !== undefined && (typeof label !== "string" || !label.trim())) throw new TypeError("sections.timeline: timelineLabel must be nonempty resolved copy");
  return <Timeline aria-label={label} events={recordsAs<TimelineEvent>(input, "events", { "date-text": "dateText" })} />;
}

export const timelineSection: GroupBSection = { leaf: "sections.timeline", slots: ["events"], render: renderTimeline };
