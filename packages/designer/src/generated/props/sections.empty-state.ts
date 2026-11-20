// Generated from sections.empty-state by src/generated/props/generate.ts; do not edit.
export const emptyStateContractSha256 = "0b7406381f1b83472830d29cd0cf3ed9a6d57c79819c48a38d948ffa8f4b6e3e";

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
