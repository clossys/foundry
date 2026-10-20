import type { ProjectModel, ProjectModelErrorCode, Task } from "./types.js";

export class ProjectModelError extends Error {
  readonly code: ProjectModelErrorCode;
  readonly cycle: readonly string[];
  constructor(code: ProjectModelErrorCode, message: string, cycle: readonly string[] = []) {
    super(message);
    this.name = "ProjectModelError";
    this.code = code;
    this.cycle = [...cycle];
  }
}
export function fail(code: ProjectModelErrorCode, message: string): never { throw new ProjectModelError(code, message); }
export function integer(value: unknown): value is number { return typeof value === "number" && Number.isSafeInteger(value); }
export function text(value: unknown): value is string { return typeof value === "string" && value.length > 0; }

/** Inspect descriptors first so persisted records cannot execute accessors during validation. */
function plain(value: unknown, allowed: readonly string[], code: ProjectModelErrorCode): { [key: string]: unknown } {
  if (!value || typeof value !== "object" || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail(code, "Expected a plain data object.");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || !allowed.includes(key) || !Object.hasOwn(descriptors[key]!, "value") || !descriptors[key]!.enumerable) fail(code, "Unexpected field or accessor.");
  }
  return value as { [key: string]: unknown };
}

/** Kahn traversal is iterative and FIFO, retaining input order among initial ties. */
export function ordered(tasks: readonly Task[], parents = false): Task[] {
  const byId = new Map(tasks.map(task => [task.id, task]));
  const refs = (task: Task): readonly string[] => parents ? (task.parentId === undefined ? [] : [task.parentId]) : task.deps.map(dep => dep.id);
  const pending = new Map(tasks.map(task => [task.id, refs(task).length]));
  const children = new Map<string, Task[]>();
  for (const task of tasks) for (const id of refs(task)) {
    if (!byId.has(id)) fail("invalid-task", `Unknown task reference: ${id}.`);
    const list = children.get(id) ?? [];
    list.push(task); children.set(id, list);
  }
  const queue = tasks.filter(task => pending.get(task.id) === 0);
  for (let cursor = 0; cursor < queue.length; cursor++) {
    for (const child of children.get(queue[cursor]!.id) ?? []) {
      const remaining = pending.get(child.id)! - 1;
      pending.set(child.id, remaining);
      if (remaining === 0) queue.push(child);
    }
  }
  if (queue.length !== tasks.length) {
    let current = tasks.find(task => pending.get(task.id)! > 0)!.id;
    const path: string[] = [];
    const seen = new Map<string, number>();
    while (!seen.has(current)) {
      seen.set(current, path.length); path.push(current);
      current = refs(byId.get(current)!).find(id => pending.get(id)! > 0)!;
    }
    const cycle = [...path.slice(seen.get(current)!), current];
    throw new ProjectModelError(parents ? "parent-cycle" : "dependency-cycle", `Cycle: ${cycle.join(" -> ")}.`, cycle);
  }
  return queue;
}

export function copyTasks(input: unknown): Task[] {
  if (!Array.isArray(input)) fail("invalid-task", "Tasks must be an array.");
  const ids = new Set<string>();
  const tasks = input.map(value => {
    const row = plain(value, ["id", "title", "status", "start", "end", "durationDays", "assignee", "tags", "parentId", "deps", "milestone"], "invalid-task");
    if (!text(row.id) || ids.has(row.id) || typeof row.title !== "string" || !text(row.status)) fail("invalid-task", "Tasks require unique nonempty ids, a title and a status.");
    ids.add(row.id);
    for (const key of ["start", "end", "durationDays"]) if (Object.hasOwn(row, key) && !integer(row[key])) fail("invalid-task", `${key} must be a safe integer.`);
    if (Object.hasOwn(row, "milestone") && typeof row.milestone !== "boolean") fail("invalid-task", "milestone must be boolean.");
    const milestone = row.milestone === true;
    if (row.durationDays !== undefined && ((row.durationDays as number) < 0 || (!milestone && row.durationDays === 0) || (milestone && row.durationDays !== 0))) fail("invalid-task", "Invalid task duration.");
    if (row.end !== undefined && row.start === undefined && row.durationDays === undefined && !milestone) fail("invalid-task", "An end requires a start or duration.");
    if (row.start !== undefined && row.end !== undefined && ((row.end as number) < (row.start as number) || (!milestone && row.end === row.start))) fail("invalid-task", "Invalid task span.");
    if (milestone && row.start !== undefined && row.end !== undefined && row.start !== row.end) fail("invalid-task", "A milestone has one boundary.");
    for (const key of ["assignee", "parentId"]) if (Object.hasOwn(row, key) && !text(row[key])) fail("invalid-task", `${key} must be a nonempty string.`);
    if (Object.hasOwn(row, "tags") && (!Array.isArray(row.tags) || !row.tags.every(tag => typeof tag === "string"))) fail("invalid-task", "tags must contain strings.");
    if (!Array.isArray(row.deps)) fail("invalid-task", "deps must be an array.");
    const dependencies = new Set<string>();
    const deps = row.deps.map(value => {
      const dep = plain(value, ["id", "type"], "invalid-task");
      if (!text(dep.id) || dep.type !== "finish-to-start" || dependencies.has(dep.id)) fail("invalid-task", "Invalid or repeated dependency.");
      dependencies.add(dep.id);
      return { id: dep.id, type: "finish-to-start" as const };
    });
    return { ...row, deps, ...(row.tags === undefined ? {} : { tags: [...row.tags as string[]] }) } as unknown as Task;
  });
  ordered(tasks);
  ordered(tasks, true);
  return tasks;
}

export function serializeProject(tasks: readonly Task[]): ProjectModel { return { version: 1, tasks: copyTasks(tasks) }; }
export function parseProject(value: unknown): ProjectModel {
  const model = plain(value, ["version", "tasks"], "invalid-project");
  if (!Object.hasOwn(model, "version")) fail("invalid-project", "Missing project version.");
  if (model.version !== 1) fail("unsupported-version", "Only project version 1 is supported.");
  return serializeProject(copyTasks(model.tasks));
}
