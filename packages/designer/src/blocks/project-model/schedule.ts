import { copyTasks, fail, integer, ordered } from "./model.js";
import type { Calendar, ProjectConflict, ProjectSchedule, ScheduledTask, Task } from "./types.js";

function calendarMath(calendar: Calendar) {
  if (!calendar || typeof calendar.isWorkingDay !== "function" || typeof calendar.addWorkingDays !== "function") fail("invalid-calendar", "A calendar requires both callbacks.");
  const working = (day: number): boolean => {
    if (!integer(day)) fail("invalid-calendar", "Calendar days must remain safe integers.");
    const result = calendar.isWorkingDay(day);
    if (typeof result !== "boolean") fail("invalid-calendar", "isWorkingDay must return boolean.");
    return result;
  };
  const advance = (day: number, count: number): number => {
    const result = calendar.addWorkingDays(day, count);
    if (!integer(result) || (count > 0 && result <= day) || (count < 0 && result >= day) || (count === 0 && result !== day) || !working(result)) fail("invalid-calendar", "Inconsistent working-day arithmetic.");
    return result;
  };
  const normalize = (day: number): number => {
    // Bounded refusal for a calendar with no reachable working day.
    for (let step = 0; step < 3660; step++, day++) if (working(day)) return day;
    return fail("invalid-calendar", "No working day within 3660 calendar days.");
  };
  const distance = (start: number, end: number): number => {
    let day = start;
    let count = 0;
    while (day < end) {
      if (count >= 1_000_000) fail("invalid-calendar", "Working-day distance exceeds the supported million-step range.");
      day = advance(day, 1); count++;
    }
    if (day !== end) fail("invalid-calendar", "Working-day arithmetic cannot reach the end boundary.");
    return count;
  };
  return { advance, normalize, distance };
}

/** Compute a feasible earliest schedule and backward slack without changing input tasks. */
export function scheduleProject(input: readonly Task[], calendar: Calendar): ProjectSchedule {
  const tasks = ordered(copyTasks(input));
  const { advance, normalize, distance } = calendarMath(calendar);
  if (tasks.length === 0) return { tasks: [], start: 0, end: 0, conflicts: [], criticalPath: [] };
  const requested = new Map<string, { start?: number; duration: number }>();
  for (const task of tasks) {
    let duration = task.milestone ? 0 : task.durationDays ?? 1;
    if (task.durationDays === undefined && task.start !== undefined && task.end !== undefined && !task.milestone) {
      duration = distance(normalize(task.start), normalize(task.end));
      if (duration === 0) fail("invalid-task", "A non-milestone requires a working-day duration.");
    }
    const start = task.start ?? (task.end === undefined ? undefined : advance(normalize(task.end), -duration));
    requested.set(task.id, { start, duration });
  }
  const explicit = [...requested.values()].flatMap(value => value.start === undefined ? [] : [value.start]);
  const origin = normalize(explicit.length ? explicit.reduce((min, day) => Math.min(min, day)) : 0);
  const byId = new Map<string, ScheduledTask>();
  const successors = new Map<string, string[]>();
  const conflicts: ProjectConflict[] = [];
  for (const task of tasks) {
    const request = requested.get(task.id)!;
    let start = normalize(request.start ?? origin);
    if (request.start !== undefined && start !== request.start) conflicts.push({ taskId: task.id, kind: "start", requestedDay: request.start, requiredDay: start });
    for (const dep of task.deps) {
      const finish = byId.get(dep.id)!.end;
      if (request.start !== undefined && request.start < finish) conflicts.push({ taskId: task.id, dependencyId: dep.id, kind: "dependency", requestedDay: request.start, requiredDay: finish });
      start = Math.max(start, finish);
      const next = successors.get(dep.id) ?? [];
      next.push(task.id); successors.set(dep.id, next);
    }
    const end = advance(start, request.duration);
    if (task.end !== undefined && end !== task.end) conflicts.push({ taskId: task.id, kind: "end", requestedDay: task.end, requiredDay: end });
    byId.set(task.id, { ...task, start, end, durationDays: request.duration, latestStart: start, latestEnd: end, slackDays: 0, critical: false });
  }
  const finish = [...byId.values()].reduce((max, task) => Math.max(max, task.end), origin);
  for (let i = tasks.length - 1; i >= 0; i--) {
    const task = byId.get(tasks[i]!.id)!;
    const next = successors.get(task.id) ?? [];
    const latestEnd = next.reduce((min, id) => Math.min(min, byId.get(id)!.latestStart), finish);
    const latestStart = advance(latestEnd, -task.durationDays);
    const slackDays = distance(task.start, latestStart);
    byId.set(task.id, { ...task, latestStart, latestEnd, slackDays, critical: slackDays === 0 });
  }
  const scheduled = tasks.map(task => byId.get(task.id)!);
  const criticalPath: string[] = [];
  let cursor = scheduled.find(task => task.end === finish && !successors.has(task.id));
  while (cursor) {
    criticalPath.push(cursor.id);
    const start = cursor.start;
    cursor = cursor.deps.map(dep => byId.get(dep.id)!).find(dep => dep.critical && dep.end === start);
  }
  criticalPath.reverse();
  return { tasks: scheduled, start: scheduled.reduce((min, task) => Math.min(min, task.start), finish), end: finish, conflicts, criticalPath };
}
