// Generated from sections.steps by src/generated/props/generate.ts; do not edit.
export const stepsContractSha256 = "3fd6ef77dcd81b1f19ae47b756d2778f7f0e8a248553351b24c8849c08dc1383";

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
