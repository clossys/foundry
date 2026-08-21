import type { CSSProperties, ReactNode } from "react";
import {
  Cell as AriaCell,
  Column as AriaColumn,
  Row as AriaRow,
  Table as AriaTable,
  TableBody as AriaTableBody,
  TableHeader as AriaTableHeader,
  type CellProps as AriaCellProps,
  type ColumnProps as AriaColumnProps,
  type RowProps as AriaRowProps,
  type TableBodyProps as AriaTableBodyProps,
  type TableHeaderProps as AriaTableHeaderProps,
  type TableProps as AriaTableProps,
} from "react-aria-components";
import { Checkbox } from "./Checkbox.js";
import { cx } from "./internal/cx.js";
import { UI_RING_FOCUS } from "./internal/ui-vars.js";

export interface TableProps extends Omit<AriaTableProps, "className" | "style" | "children"> {
  /** A `Table.Header` followed by a `Table.Body`. */
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}

/**
 * Table primitives: `Table`, `Table.Header`, `Table.Column`, `Table.Body`,
 * `Table.Row`, `Table.Cell`, plus `Table.SelectAllCheckbox`/
 * `Table.SelectionCheckbox` for the selection column. Built on
 * react-aria-components' `Table`/`TableHeader`/`TableBody`/`Column`/`Row`/
 * `Cell`, which supply real `<table>`/`<thead>`/`<tbody>`/`<th>`/`<tr>`/
 * `<td>` semantics, grid-style keyboard navigation between cells and rows
 * (arrow keys in every direction, Home/End, Ctrl+Home/End), sorting
 * (`sortDescriptor`/`onSortChange`, exposed on `Table` itself — see below),
 * and row selection (`selectionMode`/`selectedKeys`/`onSelectionChange`,
 * also on `Table`) — none of it reimplemented here.
 *
 * Deliberately compositional rather than a finished data grid: this file
 * exports the primitives a consumer assembles a real table from, the same
 * way react-aria-components' own docs compose them, not a pre-wired
 * component that takes `columns`/`rows` data props and owns pagination,
 * filtering, or a toolbar. `DataTable` — that finished, opinionated
 * assembly — is a block built ON TOP of these primitives, and by this
 * package's own "can one page contain two of them" test it's a block (a
 * page can hold two data tables) rather than a view; it's a deliberate
 * follow-up, not started here.
 *
 * `Table` itself is the one piece not exposed as `Table.Something`: unlike
 * `Menu`/`Breadcrumb`/`Tabs`, where the root component wraps a TRIGGER or
 * a LIST, here the root IS the outermost semantic element (the `<table>`),
 * so there's no separate "root vs. sub-part" naming needed for it — the
 * sub-parts are named after what they render (`Header`, `Column`, `Body`,
 * `Row`, `Cell`), matching react-aria-components' own naming one level
 * down.
 */
function TableRoot({ children, className, style, ...rest }: TableProps) {
  return (
    <AriaTable
      {...rest}
      className={cx("w-full border-collapse text-body text-ink-primary outline-none", className)}
      style={style}
    >
      {children}
    </AriaTable>
  );
}

export interface TableHeaderProps<T extends object = object>
  extends Omit<AriaTableHeaderProps<T>, "className"> {
  className?: string;
}

/** The table's header row(s), containing `Table.Column`s. */
function TableHeaderRoot<T extends object>({ className, ...rest }: TableHeaderProps<T>) {
  return <AriaTableHeader {...rest} className={cx("border-b border-line-base", className)} />;
}

export interface TableColumnProps extends Omit<AriaColumnProps, "className" | "style"> {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}

/**
 * One column header. Pass `allowsSorting` to make it sortable — clicking
 * (or activating with Enter/Space while focused) then calls the `Table`'s
 * own `onSortChange` with this column's key and the next direction,
 * react-aria-components' `useTableColumnHeader` behavior, not a click
 * handler this component wires up by hand. The sort indicator glyph below
 * reflects `sortDirection` from that same render state.
 */
function TableColumn({ children, className, style, ...rest }: TableColumnProps) {
  return (
    <AriaColumn
      {...rest}
      className={(renderProps) =>
        cx(
          "px-md py-sm text-left text-body-s font-body text-ink-secondary outline-none",
          renderProps.allowsSorting ? "cursor-pointer select-none" : "",
          className,
        )
      }
      style={(renderProps) => ({
        boxShadow: renderProps.isFocusVisible ? UI_RING_FOCUS : undefined,
        ...style,
      })}
    >
      {(renderProps) => (
        <span className="inline-flex items-center gap-xs">
          {children}
          {renderProps.allowsSorting ? (
            <span aria-hidden="true" className="text-ink-muted">
              {renderProps.sortDirection === "ascending"
                ? "▲"
                : renderProps.sortDirection === "descending"
                  ? "▼"
                  : "↕"}
            </span>
          ) : null}
        </span>
      )}
    </AriaColumn>
  );
}

export interface TableBodyProps<T extends object = object>
  extends Omit<AriaTableBodyProps<T>, "className"> {
  className?: string;
}

/** The table's rows, containing `Table.Row`s. */
function TableBodyRoot<T extends object>({ className, ...rest }: TableBodyProps<T>) {
  return <AriaTableBody {...rest} className={className} />;
}

export interface TableRowProps<T extends object = object>
  extends Omit<AriaRowProps<T>, "className" | "style"> {
  className?: string;
  style?: CSSProperties;
}

/** One data row, containing `Table.Cell`s. */
function TableRow<T extends object>({ className, style, ...rest }: TableRowProps<T>) {
  return (
    <AriaRow
      {...rest}
      className={(renderProps) =>
        cx(
          // `not-last:border-b`, not a plain `border-b` plus `last:border-b-0`
          // to remove it again: one positive condition reaches the same
          // "every row but the last gets a divider" result as a positive
          // class plus an override undoing it on the last row, with less to
          // read — the same pattern `Breadcrumb.Item` already uses for its
          // `not-last:after:content-['/']` separator.
          "not-last:border-b border-line-base outline-none",
          renderProps.isSelected ? "bg-surface-selected" : "",
          renderProps.isDisabled ? "text-ink-muted" : "",
          className,
        )
      }
      style={(renderProps) => ({
        boxShadow: renderProps.isFocusVisible ? UI_RING_FOCUS : undefined,
        ...style,
      })}
    />
  );
}

export interface TableCellProps extends Omit<AriaCellProps, "className" | "style"> {
  className?: string;
  style?: CSSProperties;
}

/** One cell within a `Table.Row`. */
function TableCell({ className, style, ...rest }: TableCellProps) {
  return (
    <AriaCell
      {...rest}
      className={cx("px-md py-sm outline-none", className)}
      style={(renderProps) => ({
        boxShadow: renderProps.isFocusVisible ? UI_RING_FOCUS : undefined,
        ...style,
      })}
    />
  );
}

export interface TableSelectAllCheckboxProps {
  /**
   * Accessible label for the select-all control, read by assistive tech.
   * Rendered visually hidden (`.sr-only`) — the checkbox glyph itself,
   * plus its header-cell position, is what a sighted user reads as
   * "select all".
   * @default "Select all rows"
   */
  "aria-label"?: string;
  className?: string;
}

/**
 * The header's select-all checkbox. Place inside a `Table.Column`. Reuses
 * this package's own `Checkbox` atom rather than a second hand-rolled
 * checkbox — `Checkbox` already supports the `isIndeterminate` visual
 * state a select-all control needs (see `Checkbox`'s own doc comment), and
 * this file composing that atom is the exception this package's ladder
 * rule allows explicitly: `ladder.test.ts` forbids an atom importing from
 * `blocks/`, never a sibling atom importing another sibling atom, and
 * `Table` reaching for `Checkbox` is exactly that — one atom composing
 * another, both still one level below `blocks/`.
 *
 * `slot="selection"` is what does the actual work: react-aria-components'
 * `Table` provides `isSelected`/`isIndeterminate`/`onChange` (and its own
 * default `aria-label`, `"Select All"`) for exactly that slot, computed
 * from the real row-selection state (indeterminate when some but not all
 * rows are selected) — this component passes all of it through to
 * `Checkbox` without reading or recomputing any of that state itself,
 * overriding only the `aria-label` with this component's own `aria-label`
 * prop (react-aria-components merges a slot's context props with this
 * component's own local props local-last, so the explicit prop here wins).
 * `children` is passed as `null` rather than the visible label text
 * `Checkbox` normally takes: an explicit `aria-label` already wins the
 * accessible-name computation over a wrapping `<label>`'s text content, so
 * rendering that text a second time (even visually hidden) would be inert,
 * redundant markup rather than a second real accessibility path.
 */
function TableSelectAllCheckbox({
  "aria-label": ariaLabel = "Select all rows",
  className,
}: TableSelectAllCheckboxProps) {
  return (
    <Checkbox slot="selection" aria-label={ariaLabel} className={className}>
      {null}
    </Checkbox>
  );
}

export interface TableSelectionCheckboxProps {
  /**
   * Accessible label for this row's checkbox, read by assistive tech.
   * react-aria-components additionally wires this checkbox's
   * `aria-labelledby` to the row's own `isRowHeader` cell, so the fully
   * computed accessible name a screen reader announces is this string
   * PLUS that cell's own text (e.g. an `aria-label` of `"Select row"` on
   * a row whose row header cell reads "Ada" announces as "Select row
   * Ada") — passing something more specific here (e.g.
   * `` `Select ${row.name}` ``) would then read redundantly ("Select Ada
   * Ada"). The plain default is deliberate for that reason: it's the row
   * header cell doing the specific naming, not this prop.
   * @default "Select row"
   */
  "aria-label"?: string;
  className?: string;
}

/**
 * A row's own selection checkbox. Place inside a `Table.Cell`, one per
 * `Table.Row`. The same `Checkbox` atom and `slot="selection"` wiring as
 * `Table.SelectAllCheckbox` above, scoped to this one row's selection
 * state by react-aria-components' `Table` instead of the whole table's.
 */
function TableSelectionCheckbox({
  "aria-label": ariaLabel = "Select row",
  className,
}: TableSelectionCheckboxProps) {
  return (
    <Checkbox slot="selection" aria-label={ariaLabel} className={className}>
      {null}
    </Checkbox>
  );
}

export const Table = Object.assign(TableRoot, {
  Header: TableHeaderRoot,
  Column: TableColumn,
  Body: TableBodyRoot,
  Row: TableRow,
  Cell: TableCell,
  SelectAllCheckbox: TableSelectAllCheckbox,
  SelectionCheckbox: TableSelectionCheckbox,
});
