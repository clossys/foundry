// Generated from sections.activity-feed by src/generated/props/generate.ts; do not edit.
export const activityFeedContractSha256 = "3e0b17a556de7e782bcaa9a9f42080b9c44cea3e97841a07704212958749dec2";

export type ActivityFeedCopy = {
  header?: {
    eyebrow?: string; // eyebrow
    heading?: string; // heading
    description?: string; // lead
  };
  grouping: Array<{
    label: string; // label
  }>;
  filters?: {
    links?: Array<{
      label?: string; // label
    }>;
  };
  labels?: {
    label?: string; // label
    unread?: string; // label
    "changed-from"?: string; // label
    "changed-to"?: string; // label
    cleared?: string; // label
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
  events: Array<{
    actor: {
      name: string; // label
    };
    summary: string; // body
    "time-text": string; // label
    changes: Array<{
      field: string; // label
      from?: string; // label
      to?: string; // label
    }>;
    detail?: string; // body
  }>;
};
export type ActivityFeedVariant = Record<string, never>;
export interface ActivityFeedProps {
  copy: ActivityFeedCopy;
  variant?: ActivityFeedVariant;
}
