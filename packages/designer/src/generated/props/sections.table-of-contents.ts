// Generated from sections.table-of-contents by src/generated/props/generate.ts; do not edit.
export const tableOfContentsContractSha256 = "e56fb99ad42430a0ad1bc530f4d67226ce9a1e6b735ce19d423eaa1d8c5fa5b2";

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
