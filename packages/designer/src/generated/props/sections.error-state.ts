// Generated from sections.error-state by src/generated/props/generate.ts; do not edit.
export const errorStateContractSha256 = "904e7a4840a4857beb984b7f4f7ed660cde7ef3c8db5ea7b97a0ae86adb09823";

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
