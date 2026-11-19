// Generated from sections.table-of-contents by src/generated/props/generate.ts; do not edit.
export const tableOfContentsContractSha256 = "fc8146e8d4e96ca61d7542d8d586ec219e434a6993b65cfade2810b189c78f2c";

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
