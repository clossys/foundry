/** Integer day in the caller's calendar; end boundaries are exclusive. */
export type ProjectDay = number;
export interface TaskDependency { readonly id: string; readonly type: "finish-to-start" }
export interface Task {
  readonly id: string;
  readonly title: string;
  readonly status: string;
  readonly start?: ProjectDay;
  readonly end?: ProjectDay;
  readonly durationDays?: number;
  readonly assignee?: string;
  readonly tags?: readonly string[];
  readonly parentId?: string;
  readonly deps: readonly TaskDependency[];
  readonly milestone?: boolean;
}
/** Callbacks must be deterministic, mutually consistent and support signed integer counts. */
export interface Calendar {
  isWorkingDay(day: ProjectDay): boolean;
  addWorkingDays(day: ProjectDay, count: number): ProjectDay;
}
export type ProjectModelErrorCode = "invalid-project" | "unsupported-version" | "invalid-task" | "dependency-cycle" | "parent-cycle" | "invalid-calendar" | "unknown-status" | "invalid-board" | "invalid-layout";
export interface ProjectModel { readonly version: 1; readonly tasks: readonly Task[] }
export interface ScheduledTask extends Task {
  readonly start: ProjectDay;
  readonly end: ProjectDay;
  readonly durationDays: number;
  readonly latestStart: ProjectDay;
  readonly latestEnd: ProjectDay;
  readonly slackDays: number;
  readonly critical: boolean;
}
export interface ProjectConflict {
  readonly taskId: string;
  readonly dependencyId?: string;
  readonly kind: "dependency" | "start" | "end";
  readonly requestedDay: ProjectDay;
  readonly requiredDay: ProjectDay;
}
export interface ProjectSchedule {
  readonly tasks: readonly ScheduledTask[];
  readonly start: ProjectDay;
  readonly end: ProjectDay;
  readonly conflicts: readonly ProjectConflict[];
  /** One contiguous zero-slack driving chain; tied chains use stable traversal order. */
  readonly criticalPath: readonly string[];
}
export interface ProjectRollup {
  readonly id: string;
  readonly start: ProjectDay;
  readonly end: ProjectDay;
  /** Sum of descendant leaf durations, rather than calendar span. */
  readonly durationDays: number;
  readonly percentComplete: number;
  readonly status: string;
}
export interface BoardOptions { readonly statusOrder: readonly string[]; readonly wipLimits?: Readonly<Record<string, number>> }
export interface BoardColumn { readonly status: string; readonly tasks: readonly Task[]; readonly wipLimit?: number; readonly overLimit: boolean }
export type TimelineZoom = "day" | "week" | "month" | "quarter";
export interface TimelineOptions { readonly zoom: TimelineZoom; readonly rowOrder: readonly string[] }
export interface TimelinePoint { readonly id: string; readonly row: number; readonly offset: number }
export interface TimelineRow extends TimelinePoint { readonly span: number; readonly milestone: boolean }
export interface TimelineConnector { readonly from: TimelinePoint; readonly to: TimelinePoint }
export interface TimelineLayout {
  readonly origin: ProjectDay;
  readonly daysPerUnit: number;
  readonly rows: readonly TimelineRow[];
  readonly connectors: readonly TimelineConnector[];
  readonly markers: readonly TimelinePoint[];
}
