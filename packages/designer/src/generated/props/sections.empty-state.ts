// Generated from sections.empty-state by src/generated/props/generate.ts; do not edit.
export const emptyStateContractSha256 = "501694261206841b6c0157762c1ee40fe30cc2665ebce995abdfacf1e848c756";

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
