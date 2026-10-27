import { ActivityFeed, type ActivityFeedGroup } from "../../blocks/ActivityFeed.js";
import type { EventRecord } from "../../blocks/EventItem.js";
import { LinkRegion, type LinkRegionContent } from "./group-b-parts.js";
import { entryOf, recordsOf, type GroupBSection, type SectionRenderInput } from "./group-b-support.js";
import { specimenDataset } from "../../studio/specimen-dataset.js";

const { activityFeed } = specimenDataset.sections;

/** sections.activity-feed: events render through EventItem, grouping as headed groups, filters as a Link region. */
export function renderActivityFeed(input: SectionRenderInput) {
  const groups = recordsOf<ActivityFeedGroup>(input, "grouping");
  const filters = entryOf<LinkRegionContent>(input, "filters");
  return <ActivityFeed
    aria-label={activityFeed["aria-label"]}
    events={recordsOf<EventRecord>(input, "events")}
    groups={groups.length ? groups : undefined}
    filters={filters ? <LinkRegion content={filters} /> : undefined}
    labels={activityFeed.labels}
    emptyState={activityFeed.emptyState}
  />;
}

export const activityFeedSection: GroupBSection = { leaf: "sections.activity-feed", slots: ["events", "filters", "grouping"], render: renderActivityFeed };
