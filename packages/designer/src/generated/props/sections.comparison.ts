// Generated from sections.comparison by src/generated/props/generate.ts; do not edit.
export const comparisonContractSha256 = "148519ebac08404cfb4ef6cb291003f8eca355b963553357c6d64a71b3c4a7fe";

export type ComparisonCopy = {
  header?: {
    eyebrow?: string; // eyebrow
    heading?: string; // heading
    description?: string; // lead
  };
  columns: Array<{
    label: string; // label
    description?: string; // body
  }>;
  rows: Array<{
    label: string; // label
    description?: string; // body
    cells?: Array<{
      text?: string; // label
      value?: string; // label
      delta?: string; // label
    }>;
  }>;
  highlight?: {
    label?: string; // label
  };
  controls?: Array<{
    label?: string; // label
  }>;
  labels?: {
    label?: string; // label
    feature?: string; // label
  };
};
export type ComparisonVariant = {
  arrangement?: "library-board";
};
export interface ComparisonProps {
  copy: ComparisonCopy;
  variant?: ComparisonVariant;
}
