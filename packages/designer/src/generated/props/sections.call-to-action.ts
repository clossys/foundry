// Generated from sections.call-to-action by src/generated/props/generate.ts; do not edit.
export const callToActionContractSha256 = "6c4ae1fa78dd38ded745175410473e5ed61792067c4384a2a6fdcee76a690d1f";

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
