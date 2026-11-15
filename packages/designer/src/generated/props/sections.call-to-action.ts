// Generated from sections.call-to-action by src/generated/props/generate.ts; do not edit.
export const callToActionContractSha256 = "e93d6e53b25a6c997d56d87466d62ffc6afd55c8c87c64a2b5354bb0034710f3";

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
