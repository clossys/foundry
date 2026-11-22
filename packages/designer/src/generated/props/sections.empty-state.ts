// Generated from sections.empty-state by src/generated/props/generate.ts; do not edit.
export const emptyStateContractSha256 = "8cfbb94c679058e202fb498efbc88a59ba293e91aba0a95abb017233f621a843";

export type EmptyStateCopy = {
  header?: {
    eyebrow?: string; // eyebrow
    heading?: string; // heading
    description?: string; // lead
  };
  actions?: Array<{
    label?: string; // action
  }>;
  illustration?: {
    label?: string; // label
  };
};
export type EmptyStateVariant = {
  kind?: "empty" | "no-results" | "first-use";
  scope?: "region" | "page";
};
export interface EmptyStateProps {
  copy: EmptyStateCopy;
  variant?: EmptyStateVariant;
}
