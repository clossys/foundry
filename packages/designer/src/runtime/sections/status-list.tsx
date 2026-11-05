import { StatusList, type StatusListGroup, type StatusListItem } from "../../blocks/StatusList.js";
import { entryOf, recordsOf, type GroupBSection, type SectionRenderInput } from "./group-b-support.js";
import { specimenDataset } from "../../studio/specimen-dataset.js";

const { statusList } = specimenDataset.sections;

/** A grouped items record: a group heading over its own statements. */
const isGroup = (record: StatusListItem | StatusListGroup): record is StatusListGroup => Array.isArray((record as StatusListGroup).items);

/**
 * sections.status-list: each item carries a readiness `state` (available, partial, planned) or the
 * separate `not-offered` disposition, rendered with StatusMark; `legend` is the legend's copy. Items records
 * that are groups (a heading over their own items) render as StatusList groups, so no group heading is dropped.
 */
export function renderStatusList(input: SectionRenderInput) {
  const records = recordsOf<StatusListItem | StatusListGroup>(input, "items");
  const grouped = records.length > 0 && records.every(isGroup);
  return <StatusList
    heading={statusList.heading}
    labels={statusList.labels}
    {...grouped ? { groups: records as readonly StatusListGroup[] } : { items: records as readonly StatusListItem[] }}
    legendLabel={entryOf<string>(input, "legend") ?? statusList.legendLabel}
  />;
}

export const statusListSection: GroupBSection = { leaf: "sections.status-list", slots: ["items", "legend"], render: renderStatusList };
