// Generated from sections.data-grid by src/generated/props/generate.ts; do not edit.
export const dataGridContractSha256 = "27bed8f5acbf94c5264ec4929ed382f9bb738b242f5545032a86d7c7bd229313";

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
