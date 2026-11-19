// Generated from sections.wizard by src/generated/props/generate.ts; do not edit.
export const wizardContractSha256 = "7e921a067744eb09ed92c6ebaa11d8f75531a355f03723be3e3ecbce4bc759cd";

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
