// Generated from sections.wizard by src/generated/props/generate.ts; do not edit.
export const wizardContractSha256 = "e5da3ce6d4dd581d3a9da2bc05dae57b0d2b4274e9295bb17578c241ec5b51e5";

export type WizardCopy = {
  header?: {
    eyebrow?: string; // eyebrow
    heading?: string; // heading
    description?: string; // lead
  };
  steps: Array<{
    label: string; // label
  }>;
  progress?: {
    label?: string; // label
  };
  back?: {
    label?: string; // label
  };
  next: {
    label: string; // label
    finish?: string; // label
  };
  review?: {
    label?: string; // label
  };
};
export type WizardVariant = Record<string, never>;
export interface WizardProps {
  copy: WizardCopy;
  variant?: WizardVariant;
}
