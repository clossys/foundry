// Generated from sections.table-of-contents by src/generated/props/generate.ts; do not edit.
export const tableOfContentsContractSha256 = "486720776042054f1564826a1abff9e272719c06b305c731150ae2713bc6a338";

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
