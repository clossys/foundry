"use client";
import type { ReactNode, Ref } from "react";
import { RadioGroup } from "../../components/RadioGroup.js";
import { dsPassThrough } from "../../catalog-core/provenance-attrs.js";

export interface MatrixChoicesProps {
  arrangement: "choices";
  "aria-label": string;
  columns: readonly { id: string; label: ReactNode }[];
  rows: readonly { id: string; label: ReactNode; name: ReactNode; selected: string | null; cells: Readonly<Record<string, ReactNode>>; ref?: Ref<HTMLTableRowElement>; emphasized?: boolean }[];
  onChange(row: string, column: string): void;
  onFocusCell?(row: string, column: string): void;
}
/** Comparison section branch for single-choice rows over fixed-width library columns. */
export function MatrixChoices({ columns, rows, onChange, onFocusCell, "aria-label": label, ...passthrough }: MatrixChoicesProps) {
  // Normal flow: the matrix is as wide as its fixed library columns, and each column's content wraps at its own bound.
  return <div {...dsPassThrough(passthrough)} data-studio-matrix=""><table aria-label={label} className="w-fit text-start text-body-s">
    <thead><tr><th scope="col" className="min-w-[var(--ui-layout-sidebar-w)] p-sm text-start" />{columns.map(column => <th key={column.id} scope="col" className="w-[var(--ui-layout-sidebar-w)] min-w-[var(--ui-layout-sidebar-w)] p-sm text-start">{column.label}</th>)}</tr></thead>
    <tbody>{rows.map(row => <tr key={row.id} ref={row.ref} data-studio-row={row.id} data-scope="slot" data-emphasized={row.emphasized ? "" : undefined} tabIndex={-1}>
      <th scope="row" className="p-sm text-start align-top">{row.label}</th>
      <td colSpan={Math.max(1, columns.length)} className="p-0 align-top">
        <RadioGroup label={<span className="sr-only">{row.name}</span>} orientation="horizontal" validationBehavior="aria" value={row.selected} onChange={source => onChange(row.id, source)}>
          <table aria-label={label} className="w-full table-fixed"><tbody><tr>{columns.map(column => <td key={column.id} data-studio-card={column.id} data-selected={row.selected === column.id ? "" : undefined} className="w-[var(--ui-layout-sidebar-w)] min-w-[var(--ui-layout-sidebar-w)] p-sm align-top" onFocus={() => onFocusCell?.(row.id, column.id)} onPointerDown={() => onFocusCell?.(row.id, column.id)}>{row.cells[column.id]}</td>)}</tr></tbody></table>
        </RadioGroup>
      </td>
    </tr>)}</tbody>
  </table></div>;
}
