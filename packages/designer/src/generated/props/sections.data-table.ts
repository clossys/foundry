// Generated from sections.data-table by src/generated/props/generate.ts; do not edit.
export const dataTableContractSha256 = "71f813e3424216a8370812cdcecb31b395289b83bd499567f752a7247325b528";

export type DataTableCopy = {
  header?: {
    eyebrow?: string; // eyebrow
    heading?: string; // heading
    description?: string; // lead
  };
  columns: Array<{
    label: string; // label
  }>;
  rows?: Array<{
    cells?: Array<{
      text?: string; // label
    }>;
  }>;
  toolbar?: {
    search?: {
      label?: string; // label
      placeholder?: string; // label
    };
    actions?: Array<{
      label?: string; // label
    }>;
  };
  pagination?: {
    label?: string; // label
    "page-text"?: string; // label
    "total-text"?: string; // label
  };
  labels?: {
    label?: string; // label
    selection?: string; // label
    sort?: string; // label
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
export type DataTableVariant = Record<string, never>;
export interface DataTableProps {
  copy: DataTableCopy;
  variant?: DataTableVariant;
}
