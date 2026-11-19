// Generated from sections.data-table by src/generated/props/generate.ts; do not edit.
export const dataTableContractSha256 = "831d52023734627ce68867df3f4623847c67fce84c64af7365373779a540e9cb";

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
