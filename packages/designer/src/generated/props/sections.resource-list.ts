// Generated from sections.resource-list by src/generated/props/generate.ts; do not edit.
export const resourceListContractSha256 = "c3cc443ce739f646d9745136d857015f2f9b9d5b0b8e7cc55a985bda1003a501";

export type ResourceListCopy = {
  header?: {
    eyebrow?: string; // eyebrow
    heading?: string; // heading
    description?: string; // lead
  };
  records: Array<{
    title: string; // heading
    description?: string; // body
    meta?: string; // label
  }>;
  toolbar?: {
    label?: string; // label
    search?: {
      label?: string; // label
      placeholder?: string; // label
    };
  };
  pagination?: {
    "page-text"?: string; // label
    "total-text"?: string; // label
  };
  labels?: {
    label?: string; // label
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
export type ResourceListVariant = Record<string, never>;
export interface ResourceListProps {
  copy: ResourceListCopy;
  variant?: ResourceListVariant;
}
