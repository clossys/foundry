// Generated from sections.comparison by src/generated/props/generate.ts; do not edit.
export const comparisonContractSha256 = "04569a3d501d7e91cf198b6a84f57e3e6016f87c3bb34063253b11250dde555c";

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
