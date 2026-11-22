// Generated from sections.error-state by src/generated/props/generate.ts; do not edit.
export const errorStateContractSha256 = "3e612e3f74a448aea199dccd0a790a404d1420292ff756b9515cb306e0b51256";

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
