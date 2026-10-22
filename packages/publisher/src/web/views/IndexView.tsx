"use client";

import type { HTMLAttributes } from "react";
import { Link } from "@clossys/designer/atoms";
import { mergeUiClasses } from "@clossys/designer/atoms/server";
import { DataTable, EmptyState, Pagination, Panel, RecordLedger, Toolbar } from "@clossys/designer/blocks";
import type { DataTableColumn, DataTableProps, EmptyStateProps, PaginationProps, PanelProps, RecordLedgerProps, ToolbarProps } from "@clossys/designer/blocks";
import { isSanctionedHref } from "../../internal/href.js";
import { assertViewContentRoot } from "../internal/viewContentRoot.js";

/** A primary collection slot remains a declared Designer Block. Omit for DataTable. */
export type IndexViewCollection =
  | { kind: "panel"; props: PanelProps }
  | { kind: "record-ledger"; props: RecordLedgerProps };

/** Controlled DataTable behavior; the View owns its surrounding Blocks. */
export type IndexViewTable<Row> = Pick<DataTableProps<Row>,
  "sortDescriptor" | "onSortChange" | "selectionMode" | "selectedKeys" | "onSelectionChange" | "isLoading" | "loadingRowCount"
>;

export interface IndexViewRowRoute<Row> {
  /** A sanctioned destination for a row's accessible header link. */
  href: (row: Row) => string;
  /** Handles ordinary activation; modified link clicks retain browser navigation. */
  onNavigate: (href: string, row: Row) => void;
}

export interface IndexViewProps<Row> extends Omit<HTMLAttributes<HTMLDivElement>, "title" | "children"> {
  /** Content enters through the declared Block slots. */
  children?: never;
  rows: readonly Row[];
  columns: readonly DataTableColumn<Row>[];
  rowKey: DataTableProps<Row>["rowKey"];
  collectionLabel: string;
  /** Explicit zero-row recovery content, rendered through EmptyState. */
  empty: EmptyStateProps;
  /** Toolbar's leading/search/trailing slots, rendered through that Block. */
  toolbar?: ToolbarProps;
  /** Optional typed collection Block; DataTable is the default. */
  collection?: IndexViewCollection;
  table?: IndexViewTable<Row>;
  pagination?: PaginationProps;
  /** Requires exactly one isRowHeader column. No whole-row click handler is installed. */
  rowRoute?: IndexViewRowRoute<Row>;
}

/**
 * Standard entity index content for an AppFrame content region. The host owns
 * chrome, data, sorting, selection, paging and routing. Every content region is
 * a shipped Designer Block; this View supplies their order and spacing.
 * Interactive, including during ordinary SSR; react-server exports a named
 * wrong-channel stub so the server entry remains safe to import.
 */
export function IndexView<Row>({ rows, columns, rowKey, collectionLabel, empty, toolbar, collection, table, pagination, rowRoute, className, ...rest }: IndexViewProps<Row>) {
  for (const key of ["title", "subtitle", "actions"]) {
    if (Object.hasOwn(rest, key)) throw new TypeError(`IndexView: unknown prop "${key}"; page-level information belongs in AppFrame page.`);
  }
  assertViewContentRoot("IndexView", rest);
  for (const key of ["brand", "header", "footer", "nav", "mainId", "children"]) {
    if (Object.hasOwn(rest, key)) throw new TypeError("IndexView: chrome and arbitrary children belong to the frame, not this View.");
  }
  if (!Array.isArray(rows)) throw new TypeError("IndexView: rows must be an array.");
  for (let index = 0; index < rows.length; index += 1) {
    if (!Object.hasOwn(rows, index)) throw new TypeError("IndexView: rows must be a dense array.");
  }
  if (!Array.isArray(columns) || columns.length === 0 || typeof rowKey !== "function" || typeof collectionLabel !== "string" || collectionLabel.trim() === "") throw new TypeError("IndexView: columns, rowKey and collectionLabel are required.");
  if (!empty || typeof empty !== "object" || empty.title === undefined) throw new TypeError("IndexView: an explicit empty state is required.");
  if (collection !== undefined && (!collection || typeof collection !== "object" || !["panel", "record-ledger"].includes(collection.kind) || !collection.props || typeof collection.props !== "object")) throw new TypeError("IndexView: collection must be a typed Block entry.");
  if (rowRoute !== undefined && (typeof rowRoute.href !== "function" || typeof rowRoute.onNavigate !== "function")) throw new TypeError("IndexView: rowRoute requires href and onNavigate functions.");
  if (rowRoute && columns.filter(column => column.isRowHeader).length !== 1) throw new TypeError("IndexView: row routes require exactly one row-header column.");
  const routes = new Map<Row, string>();
  if (rowRoute) {
    for (const row of rows) {
      const href = rowRoute.href(row);
      if (!isSanctionedHref(href)) throw new TypeError("IndexView: every row route must use a sanctioned href.");
      routes.set(row, href);
    }
  }
  const linkedColumns = rowRoute === undefined ? columns : columns.map(column => !column.isRowHeader ? column : {
    ...column,
    cell: (row: Row) => {
      const href = routes.get(row)!;
      return <Link href={href} onKeyDown={event => {
        // React Aria reports a synthetic click on keyup; cancel the native Enter default separately.
        if (event.key === "Enter" && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) event.preventDefault();
      }} onClick={event => {
        if (event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
          event.preventDefault(); rowRoute.onNavigate(href, row);
        }
      }}>{column.cell(row)}</Link>;
    },
  });
  return (
    <div {...rest} className={mergeUiClasses("flex min-w-0 flex-col gap-xl", className)}>
      {toolbar === undefined ? null : <Toolbar {...toolbar} />}
      {rows.length === 0 && !table?.isLoading ? <EmptyState {...empty} /> : collection === undefined ? (
        <DataTable {...table} aria-label={collectionLabel} rows={rows} columns={linkedColumns} rowKey={rowKey} />
      ) : collection.kind === "panel" ? <Panel {...collection.props} /> : <RecordLedger {...collection.props} />}
      {pagination === undefined ? null : <Pagination {...pagination} />}
    </div>
  );
}
