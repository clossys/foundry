// Generated from sections.table-of-contents by src/generated/props/generate.ts; do not edit.
export const tableOfContentsContractSha256 = "730c2382c03e1b00b6e5d82c40e57029535a7afc8b56545c01fe41879dc2ed17";

export type TableOfContentsCopy = {
  headings: Array<{
    label: string; // label
  }>;
  labels?: {
    label?: string; // label
  };
  label?: string; // label
};
export type TableOfContentsVariant = {
  tracking?: "css";
};
export interface TableOfContentsProps {
  copy: TableOfContentsCopy;
  variant?: TableOfContentsVariant;
}
