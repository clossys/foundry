// Generated from sections.error-state by src/generated/props/generate.ts; do not edit.
export const errorStateContractSha256 = "60dfaa88d1ce08e42834408549ceb9c6020649d3053ef566bf5a3c8b2391dc3b";

export type ErrorStateCopy = {
  header?: {
    eyebrow?: string; // eyebrow
    heading?: string; // heading
    description?: string; // lead
  };
  code?: string; // label
  retry?: {
    label?: string; // label
  };
  report?: {
    label?: string; // label
  };
};
export type ErrorStateVariant = {
  kind?: "not-found" | "failure" | "forbidden" | "offline";
};
export interface ErrorStateProps {
  copy: ErrorStateCopy;
  variant?: ErrorStateVariant;
}
