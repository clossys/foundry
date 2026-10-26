import type { TimelineProps } from "../Timeline.js";

/** Fixed board-preview content: dated milestones with host-formatted dates. */
export const timelineSample: TimelineProps = {
  "aria-label": "Company history",
  events: [
    { id: "founded", at: "2019-04", dateText: "April 2019", heading: "Founded", description: "Three designers start a shared component library." },
    { id: "first-release", at: "2021-09", dateText: "September 2021", heading: "First public release", description: "The library ships to its first outside team." },
    { id: "platform", at: "2024-02", dateText: "February 2024", heading: "Platform launch", description: "Design, publishing and administration join one workspace." },
  ],
};
