// Generated from sections.consent by src/generated/props/generate.ts; do not edit.
export const consentContractSha256 = "a160dae6246d8264797f530055fda092212081d356fa7a4a861d10f66a208573";

export type ConsentCopy = {
  header?: {
    eyebrow?: string; // eyebrow
    heading?: string; // heading
    description?: string; // lead
  };
  copy: {
    title: string; // heading
    body: string; // body
  };
  actions: Array<{
    label: string; // action
  }>;
  policy: {
    label: string; // label
  };
};
export type ConsentVariant = Record<string, never>;
export interface ConsentProps {
  copy: ConsentCopy;
  variant?: ConsentVariant;
}
