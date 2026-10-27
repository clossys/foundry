import { AuditLog, type AuditLogEntry } from "../../blocks/AuditLog.js";
import { ActionPart, FieldRegion, type ActionContent, type FieldRegionContent } from "./group-b-parts.js";
import { entryOf, recordsOf, stateOf, type GroupBSection, type SectionRenderInput } from "./group-b-support.js";

/** sections.audit-log: entries render as AuditLog's DataTable; filter is a search region, export a Button. */
export function renderAuditLog(input: SectionRenderInput) {
  const filter = entryOf<FieldRegionContent>(input, "filter");
  const exportAction = entryOf<ActionContent>(input, "export");
  return <AuditLog
    aria-label="Audit log"
    entries={recordsOf<AuditLogEntry>(input, "entries")}
    labels={{ time: "Time", actor: "Actor", action: "Action", target: "Target" }}
    filter={filter ? <FieldRegion content={filter} field="search" /> : undefined}
    exportAction={exportAction ? <ActionPart content={exportAction} /> : undefined}
    isLoading={stateOf(input) === "loading"}
    emptyStateTitle="No audit entries"
    emptyStateDescription="Recorded changes will appear here."
  />;
}

export const auditLogSection: GroupBSection = { leaf: "sections.audit-log", slots: ["entries", "export", "filter"], render: renderAuditLog };
