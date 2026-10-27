import { Timeline, type TimelineEvent } from "../../blocks/Timeline.js";
import { recordsOf, type GroupBSection, type SectionRenderInput } from "./group-b-support.js";

/** sections.timeline: dated events render as Timeline's ordered list. */
export function renderTimeline(input: SectionRenderInput) {
  return <Timeline aria-label="Order history" events={recordsOf<TimelineEvent>(input, "events")} />;
}

export const timelineSection: GroupBSection = { leaf: "sections.timeline", slots: ["events"], render: renderTimeline };
