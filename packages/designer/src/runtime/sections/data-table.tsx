import { useState, type ReactNode } from "react";
import { SectionHeader, type SectionHeaderLevel } from "../../blocks/SectionHeader.js";
import { Pagination } from "../../blocks/Pagination.js";
import { Badge } from "../../components/Badge.js";
import { Button } from "../../components/Button.js";
import { Link } from "../../components/Link.js";
import { StatusMark, type StatusMarkTone } from "../../components/StatusMark.js";
import { Tooltip } from "../../components/Tooltip.js";
import { FieldRegion, PaginationRegion, type FieldRegionContent, type PaginationRegionContent } from "./group-b-parts.js";
import { entryOf, recordsOf, stateOf, type GroupBSection, type SectionRenderInput, type SelectionRecord } from "./group-b-support.js";
import type { TableColumnKind } from "../../blocks/table-model/index.js";
import { TableFill, type ColumnRecord, type DimensionRecord, type RowRecord, type SortRecord } from "./group-b-table.js";
import { isObject } from "./group-c-content.js";
import { specimenDataset } from "../../studio/specimen-dataset.js";

const RECORDS_PER_PAGE = 100;
const COLLAPSED_RECORDS = 10;

interface ScrollHeader { readonly heading: string; readonly count?: string; readonly level?: SectionHeaderLevel; readonly id?: string }
interface ScrollPagination extends PaginationRegionContent { readonly showAll?: string; readonly label?: string; readonly previous?: string; readonly next?: string; readonly summary?: string; readonly noResults?: string }
interface ScrollColumn extends Omit<ColumnRecord, "kind"> { readonly key?: string; readonly kind?: TableColumnKind | "badge" | "status" | "preview" | "list" }

function ScrollDataTable({ input }: { input: SectionRenderInput }) {
  const selection = entryOf<readonly SelectionRecord[]>(input, "selection"), toolbar = entryOf<FieldRegionContent>(input, "toolbar");
  const pagination = entryOf<ScrollPagination>(input, "pagination"), header = entryOf<ScrollHeader>(input, "header");
  const rawColumns = recordsOf<ScrollColumn>(input, "columns");
  const rows = recordsOf<RowRecord>(input, "rows");
  const [expanded, setExpanded] = useState(false), [page, setPage] = useState(1);
  const scroll = header !== undefined || pagination?.showAll !== undefined;
  if (header?.level !== undefined && (header.level < 2 || header.level > 6 || !Number.isInteger(header.level))) throw new TypeError("sections.data-table: header level must be 2–6");
  const count = Math.max(1, Math.ceil(rows.length / RECORDS_PER_PAGE));
  const activePage = Math.min(page, count);
  const visible = scroll ? expanded ? rows.slice((activePage - 1) * RECORDS_PER_PAGE, activePage * RECORDS_PER_PAGE) : rows.slice(0, COLLAPSED_RECORDS) : rows;
  const columns: ColumnRecord[] = rawColumns.map(column => {
    const id = column.id ?? column.key;
    if (!id || !column.label) throw new TypeError("sections.data-table: columns require key and label");
    return { ...column, id, kind: ["preview", "badge", "status", "list"].includes(column.kind ?? "") ? "text" : column.kind as TableColumnKind | undefined };
  });
  const primaryColumn = rawColumns.find(column => column.kind !== "preview");
  const primaryColumnId = primaryColumn?.id ?? primaryColumn?.key;
  const renderCell = (row: RowRecord, column: ColumnRecord): ReactNode => {
    const definition = rawColumns.find(candidate => (candidate.id ?? candidate.key) === column.id)!;
    const value = row[column.id];
    const text = value === undefined || value === null ? "" : String(value);
    switch (definition.kind) {
      case "preview": {
        const render = input.sectionHost?.renderPreview;
        if (typeof render !== "function") throw new TypeError("sections.data-table: preview column requires renderPreview(leafId)");
        return (render as (id: string) => ReactNode)(typeof value === "string" ? value : row.id);
      }
      case "badge": return <Badge>{text}</Badge>;
      case "status": {
        const status = isObject(value) ? value : undefined;
        const tone = status?.tone ?? "neutral", label = status?.label ?? text;
        if (!["neutral", "info", "success", "warning", "danger"].includes(String(tone))) throw new TypeError("sections.data-table: invalid status tone");
        return <StatusMark tone={tone as StatusMarkTone}><Badge>{String(label)}</Badge></StatusMark>;
      }
      case "list": return Array.isArray(value) ? value.map(String).join(", ") : text;
      case "date": {
        const date = isObject(value) ? value : undefined;
        if (!date || typeof date.relative !== "string" || typeof date.absolute !== "string") throw new TypeError("sections.data-table: date requires consumer-formatted relative and absolute values");
        return <Tooltip trigger={<span tabIndex={0}>{date.relative}</span>}>{date.absolute}</Tooltip>;
      }
      default: return column.id === primaryColumnId && typeof row.href === "string" ? <Link href={row.href}>{text}</Link> : text;
    }
  };
  const footer = scroll && rows.length > COLLAPSED_RECORDS
    ? !expanded
      ? pagination?.showAll ? <Button variant="secondary" onPress={() => setExpanded(true)}>{pagination.showAll}</Button> : undefined
      : pagination?.label && pagination.previous && pagination.next && pagination.summary
        ? <Pagination aria-label={pagination.label} page={activePage} pageCount={count} totalItems={rows.length} pageSize={RECORDS_PER_PAGE}
            previousPageLabel={pagination.previous} nextPageLabel={pagination.next} noResultsLabel={pagination.noResults}
            rangeSummaryMessage={() => `${pagination.summary} ${activePage}/${count}`} onPageChange={setPage} /> : undefined
    : pagination && !scroll ? <PaginationRegion content={pagination} label={specimenDataset.sections.dataTable.paginationLabel} /> : undefined;
  return <TableFill label={header?.heading ?? specimenDataset.sections.dataTable.label} columns={columns} rows={visible}
    sort={recordsOf<SortRecord>(input, "sort")} selected={selection ? selection.map(row => row.id) : undefined}
    singleSelection={scroll} onSelectionChange={typeof input.sectionHost?.onSelectionChange === "function" ? input.sectionHost.onSelectionChange as (ids: readonly string[]) => void : undefined}
    grouping={recordsOf<DimensionRecord>(input, "grouping")}
    renderCell={renderCell}
    toolbar={<>{header ? <SectionHeader id={header.id} title={header.heading} level={header.level ?? 4} stats={header.count ? <Badge>{header.count}</Badge> : undefined} /> : null}{toolbar ? <FieldRegion content={toolbar} field="text" /> : null}</>}
    compact={scroll} footer={footer} isLoading={stateOf(input) === "loading"} />;
}
/** The existing section owns bounded presentation state; rows and every displayed label remain host data. */
export function renderDataTable(input: SectionRenderInput) { return <ScrollDataTable input={input} />; }
export const dataTableSection: GroupBSection = { leaf: "sections.data-table", slots: ["columns", "grouping", "pagination", "rows", "selection", "sort", "toolbar"], render: renderDataTable };
