import { accessMatrixSection } from "./access-matrix.js";
import { activityFeedSection } from "./activity-feed.js";
import { auditLogSection } from "./audit-log.js";
import { columnMapperSection } from "./column-mapper.js";
import { dataGridSection } from "./data-grid.js";
import { dataTableSection } from "./data-table.js";
import { explorerSection } from "./explorer.js";
import { filterBuilderSection } from "./filter-builder.js";
import type { GroupBSection, SectionRenderer } from "./group-b-support.js";
import { recordDetailSection } from "./record-detail.js";
import { resourceListSection } from "./resource-list.js";
import { statsSection } from "./stats.js";
import { statusListSection } from "./status-list.js";
import { taskListSection } from "./task-list.js";
import { timelineSection } from "./timeline.js";
import { usageSection } from "./usage.js";

/**
 * Group b of the package-owned Section runtime renderers: the data and operations Sections. Each entry
 * renders its leaf's registered block from JSON content keyed by contract slot name. The shared registry
 * (`index.ts`, L9) aggregates the group records; this file owns only group b.
 */
export const GROUP_B_SECTIONS: readonly GroupBSection[] = Object.freeze([
  accessMatrixSection, activityFeedSection, auditLogSection, columnMapperSection, dataGridSection,
  dataTableSection, explorerSection, filterBuilderSection, recordDetailSection, resourceListSection,
  statsSection, statusListSection, taskListSection, timelineSection, usageSection,
]);

/** Leaf -> renderer, the shape `ConsumerRuntimePorts.renderers` takes. */
export const groupBRenderers: Readonly<Record<`sections.${string}`, SectionRenderer>> = Object.freeze(Object.fromEntries(GROUP_B_SECTIONS.map(section => [section.leaf, section.render])));
