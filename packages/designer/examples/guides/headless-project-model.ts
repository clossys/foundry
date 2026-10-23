import {
  scheduleProject, projectRollups, boardColumns, timelineLayout,
  serializeProject, parseProject, type Task, type Calendar,
} from "@clossys/designer/blocks";

const calendar: Calendar = {
  isWorkingDay: () => true,
  addWorkingDays: (day, count) => day + count,
};
const tasks: Task[] = [
  { id: "plan", title: "Plan", status: "done", start: 0, durationDays: 2, deps: [] },
  { id: "build", title: "Build", status: "in-progress", durationDays: 4,
    deps: [{ id: "plan", type: "finish-to-start" }] },
  { id: "ship", title: "Ship", status: "todo", milestone: true,
    deps: [{ id: "build", type: "finish-to-start" }] },
];
const schedule = scheduleProject(tasks, calendar);
const summaries = projectRollups(schedule);
const columns = boardColumns(tasks, {
  statusOrder: ["todo", "in-progress", "blocked", "done"],
  wipLimits: { "in-progress": 2 },
});
const layout = timelineLayout(schedule, {
  zoom: "week", rowOrder: tasks.map(task => task.id),
});
const saved = serializeProject(tasks);
const restored = parseProject(JSON.parse(JSON.stringify(saved)));
export { summaries, columns, layout, restored };
