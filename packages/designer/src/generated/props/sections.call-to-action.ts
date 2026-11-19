// Generated from sections.call-to-action by src/generated/props/generate.ts; do not edit.
export const callToActionContractSha256 = "8d87a00220edc699652a849b3c4d37dd012f1c6fe8f3882817b9020f0c2cb0ba";

export type CallToActionCopy = {
  header: {
    title: string; // heading
    eyebrow?: string; // eyebrow
    description?: string; // lead
  };
  actions: {
    primary: {
      label: string; // action
    };
    secondary?: {
      label?: string; // action
    };
  };
};
export type CallToActionVariant = Record<string, never>;
export interface CallToActionProps {
  copy: CallToActionCopy;
  variant?: CallToActionVariant;
}
