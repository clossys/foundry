import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";
import {
  scheduleProject, projectRollups, boardColumns, timelineLayout,
  serializeProject, parseProject, ProjectModelError,
  type Task, type Calendar, type ProjectSchedule,
} from "./index.js";

const allDays: Calendar = { isWorkingDay: () => true, addWorkingDays: (day, count) => day + count };
// Day zero is Monday; no Date, locale or ambient timezone participates.
const weekdays: Calendar = {
  isWorkingDay: day => ((day % 7) + 7) % 7 < 5,
  addWorkingDays(day, count) {
    let result = day;
    for (let left = Math.abs(count); left > 0;) {
      result += Math.sign(count);
      if (this.isWorkingDay(result)) left--;
    }
    return result;
  },
};
const task = (id: string, options: Partial<Task> = {}): Task => ({ id, title: id, status: "todo", deps: [], ...options });
const dep = (id: string) => ({ id, type: "finish-to-start" as const });
const at = (schedule: ProjectSchedule, id: string) => schedule.tasks.find(item => item.id === id)!;
function refusal(fn: () => unknown, code: string) {
  try { fn(); } catch (error) {
    expect(error).toBeInstanceOf(ProjectModelError);
    expect((error as ProjectModelError).code).toBe(code);
    return error as ProjectModelError;
  }
  throw new Error(`Expected typed refusal: ${code}`);
}
function freeze<T>(value: T): T {
  if (value && typeof value === "object") { Object.freeze(value); Object.values(value).forEach(freeze); }
  return value;
}

describe("project-model scheduling", () => {
  it("propagates an exclusive-end chain and computes zero slack on the longest path", () => {
    const s = scheduleProject([task("c", { deps: [dep("b")], durationDays: 3 }), task("b", { deps: [dep("a")], durationDays: 2 }), task("a", { durationDays: 4 })], allDays);
    expect(s.tasks.map(t => [t.id, t.start, t.end, t.latestStart, t.slackDays])).toEqual([["a", 0, 4, 0, 0], ["b", 4, 6, 4, 0], ["c", 6, 9, 6, 0]]);
    expect(s.criticalPath).toEqual(["a", "b", "c"]);
    expect(s.end).toBe(9);
  });
  it("uses the longest arm of a diamond and positive slack on the shorter arm", () => {
    const s = scheduleProject([task("a"), task("b", { durationDays: 5, deps: [dep("a")] }), task("c", { durationDays: 2, deps: [dep("a")] }), task("d", { durationDays: 2, deps: [dep("b"), dep("c")] })], allDays);
    expect(at(s, "d").start).toBe(6);
    expect(at(s, "c").slackDays).toBe(3);
    expect(at(s, "c").latestStart).toBe(4);
    expect(s.criticalPath).toEqual(["a", "b", "d"]);
    expect(s.tasks.filter(t => t.critical).map(t => t.id)).toEqual(["a", "b", "d"]);
  });
  it("shares a finish across parallel roots while retaining deterministic input ties", () => {
    const s = scheduleProject([task("z", { durationDays: 2 }), task("a", { durationDays: 5 })], allDays);
    expect(s.tasks.map(t => t.id)).toEqual(["z", "a"]);
    expect(at(s, "z").slackDays).toBe(3);
    expect(s.criticalPath).toEqual(["a"]);
    expect(scheduleProject([task("b"), task("a")], allDays).criticalPath).toEqual(["b"]);
  });
  it("honors a later explicit start without inventing a dependency conflict", () => {
    const s = scheduleProject([task("a", { start: 0, durationDays: 2 }), task("b", { start: 8, deps: [dep("a")] })], allDays);
    expect(at(s, "b").start).toBe(8);
    expect(s.conflicts).toEqual([]);
    expect(at(s, "a").slackDays).toBe(6);
    expect(s.criticalPath).toEqual(["b"]);
  });
  it("reports violated explicit dates but returns a feasible dependency schedule", () => {
    const s = scheduleProject([task("a", { start: 0, durationDays: 5 }), task("b", { start: 2, end: 4, deps: [dep("a")] })], allDays);
    expect(at(s, "b").start).toBe(5);
    expect(at(s, "b").end).toBe(7);
    expect(s.conflicts).toContainEqual({ taskId: "b", dependencyId: "a", kind: "dependency", requestedDay: 2, requiredDay: 5 });
    expect(s.conflicts).toContainEqual({ taskId: "b", kind: "end", requestedDay: 4, requiredDay: 7 });
  });
  it("derives duration from a span, or start from end plus duration", () => {
    const s = scheduleProject([task("span", { start: 3, end: 6 }), task("backward", { end: 10, durationDays: 2 })], allDays);
    expect(at(s, "span").durationDays).toBe(3);
    expect(at(s, "backward").start).toBe(8);
    expect(at(s, "backward").end).toBe(10);
  });
  it("skips weekends with injected arithmetic in forward and backward passes", () => {
    const s = scheduleProject([task("a", { start: 4, durationDays: 2 }), task("b", { deps: [dep("a")], durationDays: 2 }), task("c", { start: 4 })], weekdays);
    expect([at(s, "a").start, at(s, "a").end, at(s, "b").end]).toEqual([4, 8, 10]);
    expect(at(s, "c").latestStart).toBe(9);
    expect(at(s, "c").slackDays).toBe(3);
    const weekend = scheduleProject([task("w", { start: 5 })], weekdays);
    expect([at(weekend, "w").start, at(weekend, "w").end]).toEqual([7, 8]);
  });
  it("makes milestone tasks zero duration and supports an empty project", () => {
    const s = scheduleProject([task("a", { durationDays: 2 }), task("m", { milestone: true, deps: [dep("a")] })], allDays);
    expect([at(s, "m").start, at(s, "m").end, at(s, "m").durationDays]).toEqual([2, 2, 0]);
    expect(scheduleProject([], allDays)).toEqual({ tasks: [], start: 0, end: 0, conflicts: [], criticalPath: [] });
  });
  it("names a real directed cycle, including a self cycle", () => {
    const e = refusal(() => scheduleProject([task("a", { deps: [dep("c")] }), task("b", { deps: [dep("a")] }), task("c", { deps: [dep("b")] })], allDays), "dependency-cycle");
    expect(e.cycle[0]).toBe(e.cycle.at(-1));
    expect(new Set(e.cycle)).toEqual(new Set(["a", "b", "c"]));
    expect(refusal(() => scheduleProject([task("a", { deps: [dep("a")] })], allDays), "dependency-cycle").cycle).toEqual(["a", "a"]);
  });
  it("preserves frozen inputs and makes independent output copies", () => {
    const input = freeze([task("a", { tags: ["x"] }), task("b", { deps: [dep("a")] })]);
    const before = JSON.stringify(input);
    const s = scheduleProject(input, allDays);
    expect(JSON.stringify(input)).toBe(before);
    expect(s.tasks[0]).not.toBe(input[0]);
    expect(s.tasks[0]!.tags).not.toBe(input[0]!.tags);
    expect(s.tasks[1]!.deps).not.toBe(input[1]!.deps);
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
  });
  it("matches independent longest-path enumeration on small generated DAGs", () => {
    for (let n = 2; n <= 16; n++) {
      const tasks = Array.from({ length: n }, (_, i) => task(String(i), { durationDays: (i * 3) % 5 + 1, deps: Array.from({ length: i }, (_, j) => j).filter(j => (i + j) % 3 === 0).map(j => dep(String(j))) }));
      const s = scheduleProject(tasks, allDays);
      const finishes = tasks.map(() => 0);
      tasks.forEach((t, i) => { finishes[i] = Math.max(0, ...t.deps.map(d => finishes[Number(d.id)]!)) + t.durationDays!; });
      expect(tasks.map(t => at(s, t.id).end)).toEqual(finishes);
      expect(s.end).toBe(Math.max(...finishes));
      expect(s.criticalPath.reduce((sum, id) => sum + at(s, id).durationDays, 0)).toBe(s.end);
      for (const t of s.tasks) expect(t.slackDays).toBeGreaterThanOrEqual(0);
    }
  });
  it.each([
    ["duplicate", [task("a"), task("a")]],
    ["missing dependency", [task("a", { deps: [dep("missing")] })]],
    ["missing parent", [task("a", { parentId: "missing" })]],
    ["invalid duration", [task("a", { durationDays: -1 })]],
    ["fractional day", [task("a", { start: 1.5 })]],
    ["invalid span", [task("a", { start: 4, end: 2 })]],
    ["end alone", [task("a", { end: 4 })]],
    ["nonzero milestone", [task("a", { milestone: true, durationDays: 2 })]],
    ["nonserializable optional field", [task("a", { milestone: undefined })]],
  ])("refuses %s", (_name, tasks) => { refusal(() => scheduleProject(tasks as Task[], allDays), "invalid-task"); });
  it("refuses a non-progressing injected calendar", () => {
    refusal(() => scheduleProject([task("a")], { isWorkingDay: () => true, addWorkingDays: d => d }), "invalid-calendar");
  });
  it("uses no ambient clock or timezone under two actual TZ environments", () => {
    const entry = resolve("dist/blocks/project-model/index.js");
    const script = `import {scheduleProject} from ${JSON.stringify(entry)}; Date.now=()=>{throw Error('ambient clock')}; console.log(JSON.stringify(scheduleProject([{id:'a',title:'a',status:'todo',start:4,durationDays:2,deps:[]}],{isWorkingDay:d=>((d%7)+7)%7<5,addWorkingDays(d,n){let r=d;for(let i=Math.abs(n);i>0;){r+=Math.sign(n);if(this.isWorkingDay(r))i--;}return r;}})));`;
    const run = (TZ: string) => execFileSync(process.execPath, ["--input-type=module", "-e", script], { env: { ...process.env, TZ }, encoding: "utf8" });
    expect(run("Pacific/Honolulu")).toBe(run("Asia/Tokyo"));
    for (const name of readdirSync(resolve("src/blocks/project-model")).filter(n => n.endsWith(".ts") && !n.includes(".test."))) {
      expect(readFileSync(join("src/blocks/project-model", name), "utf8")).not.toMatch(/Date\b|react|node:/);
    }
  });
});

describe("project-model rollups", () => {
  it("rolls nested parents from leaf spans and duration-weighted completion", () => {
    const s = scheduleProject([task("root"), task("nested", { parentId: "root" }), task("a", { parentId: "nested", start: 2, durationDays: 2, status: "done" }), task("b", { parentId: "nested", start: 5, durationDays: 6, status: "in-progress" }), task("c", { parentId: "root", start: 1, durationDays: 2, status: "done" })], allDays);
    const rows = projectRollups(s);
    expect(rows.find(r => r.id === "nested")).toMatchObject({ start: 2, end: 11, percentComplete: 25, status: "in-progress", durationDays: 8 });
    expect(rows.find(r => r.id === "root")).toMatchObject({ start: 1, end: 11, percentComplete: 40, durationDays: 10 });
  });
  it("uses blocked > in-progress > todo > done and treats childless tasks as leaves", () => {
    for (const [status, expected] of [["blocked", "blocked"], ["in-progress", "in-progress"], ["todo", "todo"], ["done", "done"]]) {
      const s = scheduleProject([task("p"), task("a", { parentId: "p", status }), task("b", { parentId: "p", status: "done" })], allDays);
      expect(projectRollups(s)[0]!.status).toBe(expected);
    }
    expect(projectRollups(scheduleProject([task("empty", { start: 9, status: "done" })], allDays))[0]).toMatchObject({ start: 9, end: 10, percentComplete: 100 });
  });
  it("defines all-zero-duration completion by leaf count and avoids double counting ancestors", () => {
    const s = scheduleProject([task("p"), task("a", { parentId: "p", milestone: true, status: "done" }), task("b", { parentId: "p", milestone: true })], allDays);
    expect(projectRollups(s)[0]!.percentComplete).toBe(50);
  });
  it("refuses a parent cycle with a typed cycle", () => {
    const e = refusal(() => scheduleProject([task("a", { parentId: "b" }), task("b", { parentId: "a" })], allDays), "parent-cycle");
    expect(e.cycle).toEqual(["a", "b", "a"]);
  });
});

describe("project-model boards and layout", () => {
  it("preserves status and task order, flags only exceeded WIP limits, and copies tasks", () => {
    const input = freeze([task("b", { status: "doing" }), task("a", { status: "doing" }), task("c", { status: "done" })]);
    const columns = boardColumns(input, { statusOrder: ["todo", "doing", "done"], wipLimits: { doing: 1, done: 1 } });
    expect(columns.map(c => [c.status, c.tasks.map(t => t.id), c.overLimit])).toEqual([["todo", [], false], ["doing", ["b", "a"], true], ["done", ["c"], false]]);
    expect(columns[1]!.tasks[0]).not.toBe(input[0]);
  });
  it("refuses unknown status, duplicate order and invalid WIP configuration", () => {
    refusal(() => boardColumns([task("a")], { statusOrder: ["done"] }), "unknown-status");
    refusal(() => boardColumns([], { statusOrder: ["done", "done"] }), "invalid-board");
    refusal(() => boardColumns([], { statusOrder: ["todo"], wipLimits: { todo: -1 } }), "invalid-board");
    refusal(() => boardColumns([], { statusOrder: ["todo"], wipLimits: { other: 1 } }), "invalid-board");
  });
  it.each(["day", "week", "month", "quarter"] as const)("maps %s zoom into calendar units with connector endpoints and zero-width milestones", zoom => {
    const s = scheduleProject([task("a", { start: 0, durationDays: 2 }), task("b", { deps: [dep("a")], milestone: true })], allDays);
    const layout = timelineLayout(s, { zoom, rowOrder: ["b", "a"] });
    const divisor = { day: 1, week: 7, month: 30, quarter: 90 }[zoom];
    expect(layout.rows.map(r => [r.id, r.row, r.offset, r.span, r.milestone])).toEqual([["b", 0, 2 / divisor, 0, true], ["a", 1, 0, 2 / divisor, false]]);
    expect(layout.connectors).toEqual([{ from: { id: "a", row: 1, offset: 2 / divisor }, to: { id: "b", row: 0, offset: 2 / divisor } }]);
    expect(layout.markers).toEqual([{ id: "b", row: 0, offset: 2 / divisor }]);
  });
  it("refuses partial, duplicated and unknown rows or zoom", () => {
    const s = scheduleProject([task("a"), task("b")], allDays);
    for (const rowOrder of [["a"], ["a", "a"], ["a", "z"]]) refusal(() => timelineLayout(s, { zoom: "day", rowOrder }), "invalid-layout");
    refusal(() => timelineLayout(s, { zoom: "year" as "day", rowOrder: ["a", "b"] }), "invalid-layout");
  });
  it("schedules and lays out 2,000 linked tasks under a 2,000 ms budget", () => {
    const input = Array.from({ length: 2000 }, (_, i) => task(String(i), { deps: i ? [dep(String(i - 1))] : [] }));
    const started = performance.now();
    const s = scheduleProject(input, allDays);
    const layout = timelineLayout(s, { zoom: "week", rowOrder: input.map(t => t.id).reverse() });
    expect(layout.rows).toHaveLength(2000);
    expect(layout.connectors).toHaveLength(1999);
    expect(s.end).toBe(2000);
    expect(s.criticalPath).toHaveLength(2000);
    expect(performance.now() - started).toBeLessThan(2000);
  });
});

describe("project-model serialization", () => {
  it("round trips versioned plain data and isolates returned nested arrays", () => {
    const tasks = freeze([task("a", { tags: ["one"], assignee: "role" }), task("b", { deps: [dep("a")] })]);
    const saved = serializeProject(tasks);
    expect(saved.version).toBe(1);
    expect(parseProject(JSON.parse(JSON.stringify(saved)))).toEqual(saved);
    expect(saved.tasks[0]!.tags).not.toBe(tasks[0]!.tags);
    expect(saved.tasks[1]!.deps).not.toBe(tasks[1]!.deps);
  });
  it("refuses unknown versions, fields, accessors and non-plain records", () => {
    refusal(() => parseProject({ version: 2, tasks: [] }), "unsupported-version");
    refusal(() => parseProject({ version: 1, tasks: [], extra: true }), "invalid-project");
    refusal(() => parseProject({ version: 1, tasks: [{ ...task("a"), extra: true }] }), "invalid-task");
    let reads = 0;
    refusal(() => parseProject({ version: 1, get tasks() { reads++; return []; } }), "invalid-project");
    expect(reads).toBe(0);
    refusal(() => parseProject(Object.assign(Object.create({}), { version: 1, tasks: [] })), "invalid-project");
  });
});
