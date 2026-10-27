import { StatusList, type StatusListItem } from "../../blocks/StatusList.js";
import { entryOf, recordsOf, type GroupBSection, type SectionRenderInput } from "./group-b-support.js";

/**
 * sections.status-list: each item carries a readiness `state` (available, partial, planned) or the
 * separate `not-offered` disposition, rendered with StatusMark; `legend` is the legend's copy.
 */
export function renderStatusList(input: SectionRenderInput) {
  return <StatusList
    heading="Fulfilment status"
    labels={{ available: "Available", partial: "Partial", planned: "Planned", dispositions: { "not-offered": "Not offered" } }}
    items={recordsOf<StatusListItem>(input, "items")}
    legendLabel={entryOf<string>(input, "legend") ?? "Status key"}
  />;
}

export const statusListSection: GroupBSection = { leaf: "sections.status-list", slots: ["items", "legend"], render: renderStatusList };
