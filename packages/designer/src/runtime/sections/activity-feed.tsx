import { ActivityFeed, type ActivityFeedGroup } from "../../blocks/ActivityFeed.js";
import type { EventRecord } from "../../blocks/EventItem.js";
import { LinkRegion, type LinkRegionContent } from "./group-b-parts.js";
import { entryOf, recordsOf, type GroupBSection, type SectionRenderInput } from "./group-b-support.js";

/** sections.activity-feed: events render through EventItem, grouping as headed groups, filters as a Link region. */
export function renderActivityFeed(input: SectionRenderInput) {
  const groups = recordsOf<ActivityFeedGroup>(input, "grouping");
  const filters = entryOf<LinkRegionContent>(input, "filters");
  return <ActivityFeed
    aria-label="Recent activity"
    events={recordsOf<EventRecord>(input, "events")}
    groups={groups.length ? groups : undefined}
    filters={filters ? <LinkRegion content={filters} /> : undefined}
    labels={{ unread: "Unread", changedFrom: "Changed from", changedTo: "to", cleared: "Cleared" }}
    emptyState={{ title: "No activity yet", description: "Changes will appear here." }}
  />;
}

export const activityFeedSection: GroupBSection = { leaf: "sections.activity-feed", slots: ["events", "filters", "grouping"], render: renderActivityFeed };
