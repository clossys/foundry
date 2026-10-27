import { FieldRegion, PaginationRegion, type FieldRegionContent, type PaginationRegionContent } from "./group-b-parts.js";
import { entryOf, recordsOf, stateOf, type GroupBSection, type SectionRenderInput, type SelectionRecord } from "./group-b-support.js";
import { TableFill, type ColumnRecord, type DimensionRecord, type RowRecord, type SortRecord } from "./group-b-table.js";

/** sections.data-table: DataTable with sort, row selection, typed grouping, a TextField toolbar and a Pagination footer. */
export function renderDataTable(input: SectionRenderInput) {
  const selection = entryOf<readonly SelectionRecord[]>(input, "selection");
  const toolbar = entryOf<FieldRegionContent>(input, "toolbar");
  const pagination = entryOf<PaginationRegionContent>(input, "pagination");
  return <TableFill
    label="Recent orders"
    columns={recordsOf<ColumnRecord>(input, "columns")}
    rows={recordsOf<RowRecord>(input, "rows")}
    sort={recordsOf<SortRecord>(input, "sort")}
    selected={selection ? selection.map(row => row.id) : undefined}
    grouping={recordsOf<DimensionRecord>(input, "grouping")}
    toolbar={toolbar ? <FieldRegion content={toolbar} field="text" /> : undefined}
    footer={pagination ? <PaginationRegion content={pagination} label="Order pages" /> : undefined}
    isLoading={stateOf(input) === "loading"}
  />;
}

export const dataTableSection: GroupBSection = { leaf: "sections.data-table", slots: ["columns", "grouping", "pagination", "rows", "selection", "sort", "toolbar"], render: renderDataTable };
