import type { AuditLogProps } from "../AuditLog.js";

/** Fixed board-preview content: host-formatted times and authored action text. */
export const auditLogSample: AuditLogProps = {
  "aria-label": "Audit log",
  entries: [
    { id: "a1", at: "2026-03-12T09:24:00Z", timeText: "12 Mar 2026, 09:24", actor: "Ada Park", action: "Published page", target: "Pricing" },
    { id: "a2", at: "2026-03-12T08:02:00Z", timeText: "12 Mar 2026, 08:02", actor: "Sam Ortiz", action: "Changed role", target: "Lee Chen: Viewer to Editor" },
    { id: "a3", at: "2026-03-11T17:40:00Z", timeText: "11 Mar 2026, 17:40", actor: "System", action: "Rotated key", target: "Deploy key 7" },
  ],
  labels: { time: "Time", actor: "Actor", action: "Action", target: "Target" },
  emptyStateTitle: "No audit entries",
  emptyStateDescription: "Recorded changes will appear here.",
};
