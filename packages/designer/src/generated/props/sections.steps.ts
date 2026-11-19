// Generated from sections.steps by src/generated/props/generate.ts; do not edit.
export const stepsContractSha256 = "c31ed44c77e65e760d666a33fcc98351786e9155a20887c662729c2f4a36a9f2";

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
