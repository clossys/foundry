// Generated from sections.comparison by src/generated/props/generate.ts; do not edit.
export const comparisonContractSha256 = "fc48b5fa96bf88760a027bd67b5baefa768b015b201440e69ce39c66df653e1a";

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
