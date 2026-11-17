// Generated from sections.call-to-action by src/generated/props/generate.ts; do not edit.
export const callToActionContractSha256 = "d8a760b5fa2e8b2cb674a9d3a0e8cd50dc97722e022bc04f0e12e89419ae05be";

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
