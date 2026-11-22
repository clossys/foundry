// Generated from sections.pagination by src/generated/props/generate.ts; do not edit.
export const paginationContractSha256 = "36d3b9287489ea9a8951dcf563327a96a2e7adad6cb6a2431782299f42ecf352";

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
