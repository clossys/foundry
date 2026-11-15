// Generated from sections.column-mapper by src/generated/props/generate.ts; do not edit.
export const columnMapperContractSha256 = "8bea2e32b3d06a214093832a0a50d619950a4fab33fb2bd2091d4fed2732f6af";

export type ColumnMapperCopy = {
  header?: {
    eyebrow?: string; // eyebrow
    heading?: string; // heading
    description?: string; // lead
  };
  "source-columns": Array<{
    label: string; // label
  }>;
  "target-fields": Array<{
    label: string; // label
    description?: string; // body
  }>;
  labels?: {
    source?: string; // label
    target?: string; // label
    unmapped?: string; // label
  };
};
export type ColumnMapperVariant = Record<string, never>;
export interface ColumnMapperProps {
  copy: ColumnMapperCopy;
  variant?: ColumnMapperVariant;
}
