// Generated from sections.steps by src/generated/props/generate.ts; do not edit.
export const stepsContractSha256 = "8b1d71ed3fba01d5edeeef6116676a05ab57af25c7ea436d0e35034e560aa1dd";

export type StepsCopy = {
  header?: {
    eyebrow?: string; // eyebrow
    heading?: string; // heading
    description?: string; // lead
  };
  steps: Array<{
    heading: string; // heading
    description?: string; // body
    ordinal?: string; // label
  }>;
};
export type StepsVariant = Record<string, never>;
export interface StepsProps {
  copy: StepsCopy;
  variant?: StepsVariant;
}
