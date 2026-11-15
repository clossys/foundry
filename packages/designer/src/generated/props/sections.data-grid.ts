// Generated from sections.data-grid by src/generated/props/generate.ts; do not edit.
export const dataGridContractSha256 = "7b1eab825916272e9d033b3142d88cf5d95feefeaae5184cbf074e275da032f0";

export type DataGridCopy = {
  header?: {
    eyebrow?: string; // eyebrow
    heading?: string; // heading
    description?: string; // lead
  };
  cells: Array<{
    label: string; // label
  }>;
  rows?: Array<{
    cells?: Array<{
      text?: string; // label
    }>;
  }>;
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
export type DataGridVariant = Record<string, never>;
export interface DataGridProps {
  copy: DataGridCopy;
  variant?: DataGridVariant;
}
