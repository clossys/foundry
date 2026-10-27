import { TaskList, type TaskListItem } from "../../blocks/TaskList.js";
import { recordsOf, type GroupBSection, type SectionRenderInput } from "./group-b-support.js";
import { specimenDataset } from "../../studio/specimen-dataset.js";

const { taskList, taskProgress } = specimenDataset.sections;

/** sections.task-list: tasks render with their status, under a Meter of completed tasks. */
export function renderTaskList(input: SectionRenderInput) {
  const items = recordsOf<TaskListItem>(input, "tasks");
  const done = items.filter(item => item.status === "done").length;
  return <TaskList
    aria-label={taskList["aria-label"]}
    items={items}
    statusLabels={taskList.statusLabels}
    progressText={taskProgress(done, items.length)}
    emptyState={taskList.emptyState}
  />;
}

export const taskListSection: GroupBSection = { leaf: "sections.task-list", slots: ["tasks"], render: renderTaskList };
