// Generated from sections.status-list by src/generated/props/generate.ts; do not edit.
export const statusListContractSha256 = "0b0601653d7bf2f6de0c0002ea2120c05394be3a34c223e6495c30d5451e278a";

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
