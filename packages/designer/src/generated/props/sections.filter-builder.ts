// Generated from sections.filter-builder by src/generated/props/generate.ts; do not edit.
export const filterBuilderContractSha256 = "1cfb8bd0b0f67ff28e4fc01b2528c2f11dd011872c6a2a70b93ac06ef5c93177";

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
