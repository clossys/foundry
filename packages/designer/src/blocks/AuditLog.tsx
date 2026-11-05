import type { ReactNode } from "react";
import { cx } from "../components/internal/cx.js";
import { DataTable, type DataTableColumn } from "./DataTable.js";
import { dsAttrs } from "../catalog-core/provenance-attrs.js";
import { componentLeaf } from "../runtime/component-leaf.js";

const SemanticContent = componentLeaf<typeof import("../components/SemanticContent.js").SemanticContent>("components.semantic-content");

/** Section root provenance (D1): the selected Foundry fill this block is. */
const SECTION_STAMP = dsAttrs("sections", "sections.audit-log", "foundry/sections.audit-log");

export interface AuditLogEntry {
  id: string;
  /** ISO 8601 timestamp for the time element's machine-readable value. */
  at: string;
  /** Host-formatted visible time. */
  timeText: string;
  actor: ReactNode;
  action: ReactNode;
  target?: ReactNode;
}

export interface AuditLogLabels {
  time: string;
  actor: string;
  action: string;
  target: string;
}

export interface AuditLogProps {
  /** Accessible name of the entries grid. */
  "aria-label": string;
  /** Recorded entries, in the host's order (newest first is typical). */
  entries: readonly AuditLogEntry[];
  labels: AuditLogLabels;
  /** Host filter region (search, date range) above the grid. */
  filter?: ReactNode;
  /** Host export action, placed at the end of the toolbar. */
  exportAction?: ReactNode;
  isLoading?: boolean;
  emptyStateTitle?: ReactNode;
  emptyStateDescription?: ReactNode;
  /** Slot below the grid, typically a Pagination block. */
  footer?: ReactNode;
  className?: string;
}

/** A read-only audit trail on DataTable: fixed time, actor, action and target columns plus filter and export slots. */
export function AuditLog({ "aria-label": label, entries, labels, filter, exportAction, isLoading, emptyStateTitle, emptyStateDescription, footer, className }: AuditLogProps) {
  const columns: DataTableColumn<AuditLogEntry>[] = [
    { id: "time", header: labels.time, isRowHeader: true, cell: entry => <SemanticContent as="time" dateTime={entry.at}>{entry.timeText}</SemanticContent> },
    { id: "actor", header: labels.actor, cell: entry => entry.actor },
    { id: "action", header: labels.action, cell: entry => entry.action },
    { id: "target", header: labels.target, cell: entry => entry.target },
  ];
  const hasToolbar = (filter !== undefined && filter !== null) || (exportAction !== undefined && exportAction !== null);
  return (
    <DataTable
      {...SECTION_STAMP}
      aria-label={label}
      className={cx("min-w-0", className)}
      columns={columns}
      rows={entries}
      rowKey={entry => entry.id}
      isLoading={isLoading}
      emptyStateTitle={emptyStateTitle}
      emptyStateDescription={emptyStateDescription}
      footer={footer}
      toolbar={hasToolbar ? (
        <SemanticContent as="div" data-audit-log-toolbar="" className="flex flex-wrap items-center justify-between gap-sm">
          <SemanticContent as="div" className="flex min-w-0 flex-wrap items-center gap-sm">{filter}</SemanticContent>
          {exportAction !== undefined && exportAction !== null ? <SemanticContent as="div" className="shrink-0">{exportAction}</SemanticContent> : null}
        </SemanticContent>
      ) : undefined}
    />
  );
}
