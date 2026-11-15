// Generated from sections.task-list by src/generated/props/generate.ts; do not edit.
export const taskListContractSha256 = "5620b49dfdbc91fa0a6226497b1eeee5114ed039264aef4536d9138830a2c265";

export type TaskListCopy = {
  header?: {
    eyebrow?: string; // eyebrow
    heading?: string; // heading
    description?: string; // lead
  };
  tasks: Array<{
    title: string; // heading
    description?: string; // body
    meta?: string; // label
  }>;
  labels?: {
    label?: string; // label
    progress?: string; // label
    done?: string; // label
    todo?: string; // label
    "in-progress"?: string; // label
    blocked?: string; // label
  };
  states: {
    loading: {
      label: string; // label
      description?: string; // body
    };
    empty: {
      label: string; // label
      description?: string; // body
    };
    error: {
      label: string; // label
      description?: string; // body
    };
  };
};
export type TaskListVariant = Record<string, never>;
export interface TaskListProps {
  copy: TaskListCopy;
  variant?: TaskListVariant;
}
