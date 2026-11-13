import { useState } from "react";
import { ResourceList } from "../../blocks/ResourceList.js";
import { PaginationRegion, ToggleToolbarRegion, type PaginationRegionContent, type ToggleToolbarContent } from "./group-b-parts.js";
import { entryOf, recordsOf, stateOf, type GroupBSection, type SectionRenderInput, type SelectionRecord } from "./group-b-support.js";
import { specimenDataset } from "../../studio/specimen-dataset.js";

/** One resource record: the block's item without its React-node or callback fields. */
export interface ResourceRecord { readonly id: string; readonly title: string; readonly description?: string; readonly meta?: string; readonly status?: string; readonly href?: string }

const { resourceList, resourceListChrome, states } = specimenDataset.sections;

function ResourceListFill({ input }: { readonly input: SectionRenderInput }) {
  const selection = entryOf<readonly SelectionRecord[]>(input, "selection");
  const [selectedKeys, setSelected] = useState<"all" | ReadonlySet<string>>(() => new Set(selection?.map(row => row.id)));
  const toolbar = entryOf<ToggleToolbarContent>(input, "toolbar");
  const pagination = entryOf<PaginationRegionContent>(input, "pagination");
  const state = stateOf(input);
  return <ResourceList
    aria-label={resourceList["aria-label"]}
    items={recordsOf<ResourceRecord>(input, "records").map(record => ({ ...record, textValue: record.title }))}
    {...(selection ? { selectionMode: "multiple" as const, selectedKeys, onSelectionChange: setSelected, selectRowLabel: resourceListChrome.selectRowLabel } : {})}
    isLoading={state === "loading"}
    loadingLabel={states.loadingLabel}
    error={state === "error" ? states.error.title : undefined}
    emptyState={resourceList.emptyState}
    toolbar={toolbar ? <ToggleToolbarRegion content={toolbar} /> : undefined}
    footer={pagination ? <PaginationRegion content={pagination} label={resourceListChrome.paginationLabel} /> : undefined}
  />;
}

/** sections.resource-list: records render as ResourceList's GridList rows, with selection, a toolbar and a Pagination footer. */
export function renderResourceList(input: SectionRenderInput) {
  return <ResourceListFill input={input} />;
}

export const resourceListSection: GroupBSection = { leaf: "sections.resource-list", slots: ["pagination", "records", "selection", "toolbar"], render: renderResourceList };
