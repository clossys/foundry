import type { ReactNode } from "react";
export interface AppFrameNotice {
  id: string;
  severity: "error" | "warning" | "success" | "info";
  text: ReactNode;
  action?: { label: string; onAction: () => void };
  /** Defaults to true. `false` keeps the notice in view with no dismiss control, ignoring any earlier dismissal of the same id: use it for a pending state that must stay visible until it resolves. Error notices are never dismissible. */
  dismissible?: boolean;
}
const priority = { error: 0, warning: 1, success: 2, info: 2 } as const;
/** Input order is oldest first; the newest message within a severity bucket is nearest the stage. */
export function visibleFrameNotices(notices: readonly AppFrameNotice[], dismissed: ReadonlySet<string>) {
  if (new Set(notices.map(notice => notice.id)).size !== notices.length || notices.some(notice => !notice.id.trim())) throw new TypeError("Frame notices: message ids must be nonempty and unique.");
  return notices.map((notice, index) => ({ notice, index })).filter(({ notice }) => notice.severity === "error" || notice.dismissible === false || !dismissed.has(notice.id))
    .sort((a, b) => priority[a.notice.severity] - priority[b.notice.severity] || b.index - a.index).slice(0, 3).map(({ notice }) => notice);
}
