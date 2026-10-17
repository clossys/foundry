import { Badge } from "../../atoms/Badge.js";
import { StatusMark } from "../../atoms/StatusMark.js";
import { cx } from "../../atoms/internal/cx.js";
import { UI_BORDER_HAIRLINE } from "../../atoms/internal/ui-vars.js";
import type { MatrixProps } from "../Matrix.js";
import { TREND_TEXT_CLASSES } from "../internal/trend.js";
import { hasContent } from "../items/policies.js";
import { SECTION_GROUND_CLASSES, type SectionGround } from "../section-ground.js";

type GridProps = Extract<MatrixProps, { arrangement: "grid" }>;
type Cell = GridProps["rows"][number]["cells"][string];
const HEADINGS = { 2: "h2", 3: "h3", 4: "h4", 5: "h5", 6: "h6" } as const;
const TABLET_LAYOUT = {
  table: "block w-full border-separate border-spacing-0 tablet:table tablet:table-fixed",
  head: "sr-only tablet:not-sr-only tablet:table-header-group",
  body: "flex flex-col gap-lg tablet:table-row-group",
  row: "flex min-w-0 flex-col gap-md rounded-panel p-lg tablet:table-row tablet:rounded-none tablet:bg-transparent tablet:p-0",
  header: "flex min-w-0 flex-col gap-xs tablet:table-cell tablet:px-md tablet:py-lg",
  cell: "flex min-w-0 items-start justify-between gap-md tablet:table-cell tablet:px-md tablet:py-lg",
  label: "inline-flex min-w-0 flex-col items-start gap-xs text-start tablet:hidden",
};
const WIDE_LAYOUT = {
  table: "block w-full border-separate border-spacing-0 tablet-lg:table tablet-lg:table-fixed",
  head: "sr-only tablet-lg:not-sr-only tablet-lg:table-header-group",
  body: "flex flex-col gap-lg tablet-lg:table-row-group",
  row: "flex min-w-0 flex-col gap-md rounded-panel p-lg tablet-lg:table-row tablet-lg:rounded-none tablet-lg:bg-transparent tablet-lg:p-0",
  header: "flex min-w-0 flex-col gap-xs tablet-lg:table-cell tablet-lg:px-md tablet-lg:py-lg",
  cell: "flex min-w-0 items-start justify-between gap-md tablet-lg:table-cell tablet-lg:px-md tablet-lg:py-lg",
  label: "inline-flex min-w-0 flex-col items-start gap-xs text-start tablet-lg:hidden",
};
const PLATE_CLASSES: Record<SectionGround, string> = {
  base: "bg-surface-sunken", sunken: "bg-surface-raised", inverse: "bg-surface-inverse-raised",
};
const TOP_ACCENT_CLASSES: Record<SectionGround, string> = {
  base: "border-t-accent", sunken: "border-t-accent", inverse: "border-t-accent-on-inverse",
};
const START_ACCENT_CLASSES: Record<SectionGround, string> = {
  base: "border-s-accent", sunken: "border-s-accent", inverse: "border-s-accent-on-inverse",
};
const BACKING_CLASSES: Record<SectionGround, string> = {
  base: "", sunken: "", inverse: "bg-surface-raised",
};

function assertGrid({ columns, rows, featured, featuredLabel, emptyLabel, ground = "base", headingLevel = 3, sides }: GridProps): void {
  if (sides !== undefined) throw new TypeError("Matrix: grid and sides cannot be combined.");
  if (ground !== "base" && ground !== "sunken" && ground !== "inverse") throw new TypeError("Matrix: unknown ground.");
  if (![2, 3, 4, 5, 6].includes(headingLevel)) throw new TypeError("Matrix: unknown heading level.");
  if (!Array.isArray(columns) || columns.length < 2 || columns.length > 6) throw new TypeError("Matrix: grid requires two to six columns.");
  if (!Array.isArray(rows) || rows.length < 2 || rows.length > 8) throw new TypeError("Matrix: grid requires two to eight rows.");
  const columnIds = new Set<string>();
  const rowIds = new Set<string>();
  const columnTypes = new Map<string, Cell["type"]>();
  let hasEmpty = false;
  for (let index = 0; index < columns.length; index++) {
    if (!Object.hasOwn(columns, index)) throw new TypeError("Matrix: columns must be dense.");
    const column = columns[index];
    if (!column || typeof column !== "object" || Array.isArray(column) || typeof column.id !== "string" || !column.id || /\s/.test(column.id) || columnIds.has(column.id)) throw new TypeError("Matrix: column ids must be distinct and whitespace-free.");
    if (!hasContent(column.label)) throw new TypeError("Matrix: each column needs a label.");
    columnIds.add(column.id);
  }
  for (let index = 0; index < rows.length; index++) {
    if (!Object.hasOwn(rows, index)) throw new TypeError("Matrix: rows must be dense.");
    const row = rows[index];
    if (!row || typeof row !== "object" || Array.isArray(row) || typeof row.id !== "string" || !row.id || /\s/.test(row.id) || rowIds.has(row.id)) throw new TypeError("Matrix: row ids must be distinct and whitespace-free.");
    if (!hasContent(row.label)) throw new TypeError("Matrix: each row needs a label.");
    if (row.description !== undefined && !hasContent(row.description)) throw new TypeError("Matrix: a supplied row description needs content.");
    rowIds.add(row.id);
    if (!row.cells || typeof row.cells !== "object" || Array.isArray(row.cells)) throw new TypeError("Matrix: row cells must match the column ids.");
    const keys = Reflect.ownKeys(row.cells);
    if (keys.length !== columns.length || keys.some(key => typeof key !== "string" || !columnIds.has(key))) throw new TypeError("Matrix: row cells must match the column ids.");
    for (const column of columns) {
      const cell = row.cells[column.id];
      if (!cell || typeof cell !== "object" || Array.isArray(cell)) throw new TypeError("Matrix: each cell needs a supported type.");
      switch (cell.type) {
        case "empty": hasEmpty = true; continue;
        case "text": if (!hasContent(cell.text)) throw new TypeError("Matrix: text cells need content."); break;
        case "figure":
          if (!hasContent(cell.value) || (cell.delta !== undefined && !hasContent(cell.delta)) || (cell.trend !== undefined && (!hasContent(cell.delta) || !["up", "down", "neutral"].includes(cell.trend)))) throw new TypeError("Matrix: figure cells need a value; trend needs a delta and an existing direction.");
          break;
        case "status":
          if (!hasContent(cell.label) || !["success", "warning", "danger", "info", "neutral"].includes(cell.tone)) throw new TypeError("Matrix: status cells need a label and an existing tone.");
          break;
        default: throw new TypeError("Matrix: unknown cell type.");
      }
      if (columnTypes.has(column.id) && columnTypes.get(column.id) !== cell.type) throw new TypeError("Matrix: non-empty cells in a column must share one type.");
      columnTypes.set(column.id, cell.type);
    }
  }
  if (featured !== undefined) {
    if (!featured || typeof featured !== "object" || Array.isArray(featured) || ((featured.row !== undefined) === (featured.column !== undefined)) || (featured.row !== undefined ? !rowIds.has(featured.row) : !columnIds.has(featured.column!))) throw new TypeError("Matrix: featured must name one row or one column.");
  }
  if (featured !== undefined ? !hasContent(featuredLabel) : featuredLabel !== undefined) throw new TypeError("Matrix: featuredLabel is required iff featured is supplied.");
  if (hasEmpty ? !hasContent(emptyLabel) : emptyLabel !== undefined) throw new TypeError("Matrix: emptyLabel is required iff an empty cell exists.");
}

function CellValue({ cell, ground, emptyLabel }: { cell: Cell; ground: SectionGround; emptyLabel: GridProps["emptyLabel"] }) {
  switch (cell.type) {
    case "text": return <span className="min-w-0 wrap-anywhere text-body-s">{cell.text}</span>;
    case "figure": {
      const trend = cell.trend ?? "neutral";
      return <span className="inline-flex min-w-0 flex-col items-end gap-xs">
      <span className="wrap-anywhere text-body-l font-display leading-heading tabular-nums">{cell.value}</span>
      {cell.delta !== undefined ? <span className={cx("text-body-s font-body tabular-nums", TREND_TEXT_CLASSES[trend], BACKING_CLASSES[ground])}>{cell.delta}</span> : null}
    </span>;
    }
    case "status": return <StatusMark tone={cell.tone} className={BACKING_CLASSES[ground]}>{cell.label}</StatusMark>;
    case "empty": return <span className="sr-only">{emptyLabel}</span>;
  }
}

/** One semantic table retains its headers while narrow rows become cards. */
export function MatrixGrid(props: GridProps) {
  assertGrid(props);
  const { arrangement: _arrangement, columns, rows, featured, featuredLabel, emptyLabel, headingLevel = 3, ground = "base", className, style, ...rest } = props;
  const layout = columns.length <= 4 ? TABLET_LAYOUT : WIDE_LAYOUT;
  const colors = SECTION_GROUND_CLASSES[ground];
  const Heading = HEADINGS[headingLevel];
  return <table {...rest} role="table" className={cx(layout.table, colors.surface, colors.primary, className)} style={style}>
    <thead className={layout.head}><tr role="row">
      <td role="cell" aria-hidden="true" />
      {columns.map(column => <th key={column.id} scope="col" role="columnheader" className={cx("px-md py-lg text-start align-top text-body-s font-body font-medium", featured?.column === column.id ? cx("border-t", TOP_ACCENT_CLASSES[ground]) : undefined)} style={featured?.column === column.id ? { borderBlockStartWidth: UI_BORDER_HAIRLINE } : undefined}>
        <span className="inline-flex flex-wrap items-center gap-sm">{column.label}{featured?.column === column.id ? <Badge>{featuredLabel}</Badge> : null}</span>
      </th>)}
    </tr></thead>
    <tbody className={layout.body}>{rows.map(row => <tr key={row.id} role="row" className={cx(PLATE_CLASSES[ground], layout.row)}>
      <th scope="row" role="rowheader" className={cx(layout.header, "text-start align-top font-normal", featured?.row === row.id ? cx("border-s ps-md", START_ACCENT_CLASSES[ground]) : undefined)} style={featured?.row === row.id ? { borderInlineStartWidth: UI_BORDER_HAIRLINE } : undefined}>
        <Heading className="m-0 text-body-l font-display leading-heading">{row.label}</Heading>
        {featured?.row === row.id ? <Badge>{featuredLabel}</Badge> : null}
        {row.description !== undefined ? <p className={cx("m-0 text-body-s text-pretty", colors.secondary)}>{row.description}</p> : null}
      </th>
      {columns.map(column => {
        const cell = row.cells[column.id]!;
        const highlighted = featured?.column === column.id;
        const figure = cell.type === "figure";
        return <td key={column.id} role="cell" className={cx(layout.cell, "border-b align-top", colors.border, figure ? "text-end" : "text-start")} style={{ borderBlockEndWidth: UI_BORDER_HAIRLINE }}>
          <span aria-hidden="true" className={cx(layout.label, "text-body-s font-medium", colors.secondary, highlighted ? cx("border-t", TOP_ACCENT_CLASSES[ground]) : undefined)} style={highlighted ? { borderBlockStartWidth: UI_BORDER_HAIRLINE } : undefined}>{column.label}{highlighted ? <Badge>{featuredLabel}</Badge> : null}</span>
          <CellValue cell={cell} ground={ground} emptyLabel={emptyLabel} />
        </td>;
      })}
    </tr>)}</tbody>
  </table>;
}
