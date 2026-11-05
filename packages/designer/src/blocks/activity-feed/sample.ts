import type { ActivityFeedProps } from "../ActivityFeed.js";

/** Fixed board-preview content: host-composed sentences and host-formatted times. */
export const activityFeedSample: ActivityFeedProps = {
  "aria-label": "Recent activity",
  events: [
    { id: "e1", at: "2026-03-12T09:24:00Z", timeText: "Today, 09:24", actor: { name: "Ada Park" }, summary: "Ada Park published the pricing page.", unread: true },
    { id: "e2", at: "2026-03-12T08:02:00Z", timeText: "Today, 08:02", actor: { name: "Sam Ortiz" }, summary: "Sam Ortiz changed the plan limit.", changes: [{ id: "limit", field: "Seats", from: "10", to: "25" }] },
    { id: "e3", at: "2026-03-11T17:40:00Z", timeText: "Yesterday, 17:40", actor: { name: "Workspace", kind: "system" }, summary: "The nightly export finished." },
  ],
  groups: [
    { id: "today", label: "Today", eventIds: ["e1", "e2"] },
    { id: "yesterday", label: "Yesterday", eventIds: ["e3"] },
  ],
  labels: { unread: "Unread", changedFrom: "Changed from", changedTo: "to", cleared: "Cleared" },
  emptyState: { title: "No activity yet", description: "Changes to this workspace will appear here." },
};
