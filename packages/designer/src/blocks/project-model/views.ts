import { copyTasks, fail, integer, ordered, text } from "./model.js";
import type { BoardColumn, BoardOptions, ProjectRollup, ProjectSchedule, ScheduledTask, Task, TimelineConnector, TimelineLayout, TimelineOptions } from "./types.js";

function scheduleTasks(schedule: ProjectSchedule): readonly ScheduledTask[] {
  if (!schedule || !Array.isArray(schedule.tasks)) fail("invalid-project", "Expected a schedule.");
  copyTasks(schedule.tasks.map(({ latestStart, latestEnd, slackDays, critical, ...task }) => task));
  for (const task of schedule.tasks) {
    if (![task.start, task.end, task.durationDays].every(integer) || task.end < task.start) fail("invalid-project", "Invalid scheduled boundaries.");
  }
  return schedule.tasks;
}

/** Descendant leaves own summary spans, completion weights and status precedence. */
export function projectRollups(schedule: ProjectSchedule): readonly ProjectRollup[] {
  const tasks = scheduleTasks(schedule);
  const children = new Map<string, string[]>();
  for (const task of tasks) if (task.parentId !== undefined) {
    const list = children.get(task.parentId) ?? [];
    list.push(task.id); children.set(task.parentId, list);
  }
  const rollups = new Map<string, ProjectRollup & { completedWeight: number; leafCount: number; doneCount: number }>();
  const statuses = ["done", "todo", "in-progress", "blocked"];
  for (const task of ordered(tasks, true).reverse()) {
    if (!statuses.includes(task.status)) fail("unknown-status", `Unknown rollup status: ${task.status}.`);
    const childIds = children.get(task.id) ?? [];
    const entries = childIds.map(id => rollups.get(id)!);
    const leafCount = entries.length ? entries.reduce((sum, row) => sum + row.leafCount, 0) : 1;
    const doneCount = entries.length ? entries.reduce((sum, row) => sum + row.doneCount, 0) : Number(task.status === "done");
    const durationDays = entries.length ? entries.reduce((sum, row) => sum + row.durationDays, 0) : (task as ScheduledTask).durationDays;
    const completedWeight = entries.length ? entries.reduce((sum, row) => sum + row.completedWeight, 0) : task.status === "done" ? durationDays : 0;
    const status = entries.length ? statuses[entries.reduce((rank, row) => Math.max(rank, statuses.indexOf(row.status)), 0)]! : task.status;
    const start = entries.length ? entries.reduce((min, row) => Math.min(min, row.start), Infinity) : task.start!;
    const end = entries.length ? entries.reduce((max, row) => Math.max(max, row.end), -Infinity) : task.end!;
    rollups.set(task.id, { id: task.id, start, end, durationDays, percentComplete: 100 * (durationDays ? completedWeight / durationDays : doneCount / leafCount), status, completedWeight, leafCount, doneCount });
  }
  return tasks.map(task => {
    const { completedWeight, leafCount, doneCount, ...row } = rollups.get(task.id)!;
    return row;
  });
}

/** Group copied tasks in caller-defined status order, retaining input order within columns. */
export function boardColumns(input: readonly Task[], options: BoardOptions): readonly BoardColumn[] {
  const tasks = copyTasks(input);
  if (!options || !Array.isArray(options.statusOrder) || !options.statusOrder.every(text) || new Set(options.statusOrder).size !== options.statusOrder.length) fail("invalid-board", "statusOrder must contain unique statuses.");
  const groups = new Map(options.statusOrder.map(status => [status, [] as Task[]]));
  if (options.wipLimits !== undefined) {
    if (!options.wipLimits || typeof options.wipLimits !== "object" || Array.isArray(options.wipLimits)) fail("invalid-board", "Invalid WIP limits.");
    for (const [status, limit] of Object.entries(options.wipLimits)) if (!groups.has(status) || !integer(limit) || limit < 0) fail("invalid-board", "WIP limits require a known status and nonnegative integer.");
  }
  for (const task of tasks) {
    if (!groups.has(task.status)) fail("unknown-status", `Unknown board status: ${task.status}.`);
    groups.get(task.status)!.push(task);
  }
  return options.statusOrder.map(status => {
    const tasks = groups.get(status)!;
    const wipLimit = options.wipLimits !== undefined && Object.hasOwn(options.wipLimits, status) ? options.wipLimits[status] : undefined;
    return { status, tasks, ...(wipLimit === undefined ? {} : { wipLimit }), overLimit: wipLimit !== undefined && tasks.length > wipLimit };
  });
}

/** Uniform day units: week=7, month=30 and quarter=90; no pixel or civil-month mapping. */
export function timelineLayout(schedule: ProjectSchedule, options: TimelineOptions): TimelineLayout {
  const tasks = scheduleTasks(schedule);
  const daysPerUnit = options?.zoom === "day" ? 1 : options?.zoom === "week" ? 7 : options?.zoom === "month" ? 30 : options?.zoom === "quarter" ? 90 : 0;
  if (!daysPerUnit || !Array.isArray(options.rowOrder) || options.rowOrder.length !== tasks.length || new Set(options.rowOrder).size !== tasks.length) fail("invalid-layout", "Expected a zoom and a complete unique row order.");
  const byId = new Map(tasks.map(task => [task.id, task]));
  const origin = tasks.reduce((min, task) => Math.min(min, task.start), tasks[0]?.start ?? 0);
  const rows = options.rowOrder.map((id, row) => {
    const task = byId.get(id);
    if (!task) fail("invalid-layout", `Unknown layout task: ${id}.`);
    return { id, row, offset: (task.start - origin) / daysPerUnit, span: (task.end - task.start) / daysPerUnit, milestone: task.milestone === true };
  });
  const positions = new Map(rows.map(row => [row.id, row]));
  const connectors: TimelineConnector[] = [];
  for (const row of rows) for (const dep of byId.get(row.id)!.deps) {
    const from = positions.get(dep.id)!;
    connectors.push({ from: { id: from.id, row: from.row, offset: from.offset + from.span }, to: { id: row.id, row: row.row, offset: row.offset } });
  }
  return { origin, daysPerUnit, rows, connectors, markers: rows.filter(row => row.milestone).map(({ id, row, offset }) => ({ id, row, offset })) };
}
