import { forwardRef, type ComponentPropsWithoutRef } from "react";
import { cx } from "./internal/cx.js";

export const DOCUMENT_TABLE_CLASS = "w-full border-collapse text-body text-ink-primary";
export const DOCUMENT_TABLE_ROW_CLASS = "border-b border-line-base";
export const DOCUMENT_TABLE_CELL_CLASS = "px-md py-sm text-start";
export const DOCUMENT_TABLE_HEADER_CLASS = "px-md py-sm text-start font-medium text-ink-secondary";

/** Semantic document tables, including engine-owned contentDOM, without grid interaction. */
const DocumentTable = forwardRef<HTMLTableElement, ComponentPropsWithoutRef<"table">>(function DocumentTable({ className, ...props }, ref) {
  return <table data-slot="table-document" {...props} ref={ref} className={cx(DOCUMENT_TABLE_CLASS, className)} />;
});
const DocumentHead = forwardRef<HTMLTableSectionElement, ComponentPropsWithoutRef<"thead">>(function DocumentHead(props, ref) {
  return <thead {...props} ref={ref} />;
});
const DocumentBody = forwardRef<HTMLTableSectionElement, ComponentPropsWithoutRef<"tbody">>(function DocumentBody(props, ref) {
  return <tbody {...props} ref={ref} />;
});
const DocumentRow = forwardRef<HTMLTableRowElement, ComponentPropsWithoutRef<"tr">>(function DocumentRow({ className, ...props }, ref) {
  return <tr {...props} ref={ref} className={cx(DOCUMENT_TABLE_ROW_CLASS, className)} />;
});
const DocumentCell = forwardRef<HTMLTableCellElement, ComponentPropsWithoutRef<"td">>(function DocumentCell({ className, ...props }, ref) {
  return <td {...props} ref={ref} className={cx(DOCUMENT_TABLE_CELL_CLASS, className)} />;
});
const DocumentHeaderCell = forwardRef<HTMLTableCellElement, ComponentPropsWithoutRef<"th">>(function DocumentHeaderCell({ className, ...props }, ref) {
  return <th {...props} ref={ref} className={cx(DOCUMENT_TABLE_HEADER_CLASS, className)} />;
});
export const TableDocument = Object.assign(DocumentTable, { Head: DocumentHead, Body: DocumentBody, Row: DocumentRow, Cell: DocumentCell, HeaderCell: DocumentHeaderCell });
