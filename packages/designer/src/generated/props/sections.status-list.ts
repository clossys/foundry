// Generated from sections.status-list by src/generated/props/generate.ts; do not edit.
export const statusListContractSha256 = "9938e86589ec46d6ae19ab3887d9a22e7f33275f74a151f79d64d5ee51b37b69";

export type StatusListCopy = {
  header?: {
    eyebrow?: string; // eyebrow
    heading?: string; // heading
    description?: string; // lead
  };
  items: Array<{
    heading?: string; // heading
    items: Array<{
      label: string; // label
      detail?: string; // body
    }>;
    label?: string; // label
    detail?: string; // body
  }>;
  legend?: string; // label
  labels?: {
    available?: string; // label
    partial?: string; // label
    planned?: string; // label
    "not-offered"?: string; // label
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
export type StatusListVariant = {
  status?: "available" | "partial" | "planned" | "not-offered";
};
export interface StatusListProps {
  copy: StatusListCopy;
  variant?: StatusListVariant;
}
