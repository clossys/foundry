// Generated from sections.pagination by src/generated/props/generate.ts; do not edit.
export const paginationContractSha256 = "fe0ce4305408919ad1aedd88960bb20dfa4be1f6532e4d9fedcd3d228d58e06a";

export type PaginationCopy = {
  page?: {
    label?: string; // label
    "previous-label"?: string; // label
    "next-label"?: string; // label
    "page-text"?: string; // label
    "no-results-label"?: string; // label
    "page-size-label"?: string; // label
  };
  total?: {
    label?: string; // label
    "range-text"?: string; // label
  };
};
export type PaginationVariant = {
  mode?: "pages" | "load-more" | "cursor";
};
export interface PaginationProps {
  copy: PaginationCopy;
  variant?: PaginationVariant;
}
