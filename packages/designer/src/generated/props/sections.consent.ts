// Generated from sections.consent by src/generated/props/generate.ts; do not edit.
export const consentContractSha256 = "44e4d1b428e49f13b36a456d23e51e060b296f3dba65dff6b022c89461288dcc";

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
