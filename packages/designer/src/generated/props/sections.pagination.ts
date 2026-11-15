// Generated from sections.pagination by src/generated/props/generate.ts; do not edit.
export const paginationContractSha256 = "c61eb9f5b8cad46f9c00e62b9982dab792cd1fad42ee0cc39628baa9c28236df";

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
