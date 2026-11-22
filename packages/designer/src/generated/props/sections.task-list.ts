// Generated from sections.task-list by src/generated/props/generate.ts; do not edit.
export const taskListContractSha256 = "9d46962e7b162b28759d228489b3d3c608816470742f3272147d58c625a98530";

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
