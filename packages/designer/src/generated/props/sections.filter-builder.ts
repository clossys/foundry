// Generated from sections.filter-builder by src/generated/props/generate.ts; do not edit.
export const filterBuilderContractSha256 = "7484d567ea34f1e303fe39ac1561883a94c45caf95518e07e969f0863c772a03";

export type FilterBuilderCopy = {
  header?: {
    eyebrow?: string; // eyebrow
    heading?: string; // heading
    description?: string; // lead
  };
  fields: Array<{
    label: string; // label
    options?: Array<{
      label?: string; // label
    }>;
  }>;
  operators: Array<{
    label: string; // label
  }>;
  groups?: Array<{
    label?: string; // label
  }>;
  labels?: {
    "add-rule"?: string; // label
    "add-group"?: string; // label
    remove?: string; // label
    "match-all"?: string; // label
    "match-any"?: string; // label
    value?: string; // label
  };
};
export type FilterBuilderVariant = Record<string, never>;
export interface FilterBuilderProps {
  copy: FilterBuilderCopy;
  variant?: FilterBuilderVariant;
}
