import { TaskList, type TaskListItem } from "../../blocks/TaskList.js";
import { recordsOf, type GroupBSection, type SectionRenderInput } from "./group-b-support.js";

/** sections.task-list: tasks render with their status, under a Meter of completed tasks. */
export function renderTaskList(input: SectionRenderInput) {
  const items = recordsOf<TaskListItem>(input, "tasks");
  const done = items.filter(item => item.status === "done").length;
  return <TaskList
    aria-label="Fulfilment tasks"
    items={items}
    statusLabels={{ todo: "To do", "in-progress": "In progress", blocked: "Blocked", done: "Done" }}
    progressText={`${done} of ${items.length} tasks done`}
    emptyState={{ title: "No tasks", description: "Tasks will appear here." }}
  />;
}

export const taskListSection: GroupBSection = { leaf: "sections.task-list", slots: ["tasks"], render: renderTaskList };
