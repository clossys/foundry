import { Timeline, type TimelineEvent } from "../../blocks/Timeline.js";
import { recordsOf, type GroupBSection, type SectionRenderInput } from "./group-b-support.js";

/** sections.timeline: dated events render as Timeline's ordered list. */
export function renderTimeline(input: SectionRenderInput) {
  const label = input.sectionHost?.timelineLabel;
  if (label !== undefined && (typeof label !== "string" || !label.trim())) throw new TypeError("sections.timeline: timelineLabel must be nonempty resolved copy");
  return <Timeline aria-label={label} events={recordsOf<TimelineEvent>(input, "events")} />;
}

export const timelineSection: GroupBSection = { leaf: "sections.timeline", slots: ["events"], render: renderTimeline };
