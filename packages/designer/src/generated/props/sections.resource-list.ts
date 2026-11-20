// Generated from sections.resource-list by src/generated/props/generate.ts; do not edit.
export const resourceListContractSha256 = "79cefc2a1d79a171b27f2f7233081ac0c5920f7dda2b03678f8ef1e8a4f6a862";

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
