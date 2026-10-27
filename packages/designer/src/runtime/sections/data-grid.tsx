import { dsAttrs } from "../../catalog-core/provenance-attrs.js";
import { recordsOf, stateOf, type GroupBSection, type SectionRenderInput } from "./group-b-support.js";
import { TableFill, type ColumnRecord, type RowRecord } from "./group-b-table.js";

/** One pinning record: a column kept at the leading edge (the first three pins are honoured). */
export interface PinRecord { readonly column: string }

/**
 * sections.data-grid: the same DataTable block as sections.data-table, with cells defined by the column
 * records and pinning carried by the view model's pinnedColumns. The block stamps itself as
 * sections.data-table, so this leaf restamps its own leaf, with the origin fill id every block stamps
 * (L9 maps a consumer pointer fill to its origin fill in the provenance scan).
 */
const STAMP = dsAttrs("sections", "sections.data-grid", "foundry/sections.data-grid");

export function renderDataGrid(input: SectionRenderInput) {
  return <TableFill
    stamp={STAMP}
    label="Order grid"
    columns={recordsOf<ColumnRecord>(input, "cells")}
    rows={recordsOf<RowRecord>(input, "rows")}
    pinned={recordsOf<PinRecord>(input, "pinning").map(pin => pin.column)}
    isLoading={stateOf(input) === "loading"}
  />;
}

export const dataGridSection: GroupBSection = { leaf: "sections.data-grid", slots: ["cells", "pinning", "rows"], render: renderDataGrid };
