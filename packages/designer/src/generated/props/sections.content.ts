// Generated from sections.content by src/generated/props/generate.ts; do not edit.
export const contentContractSha256 = "309330cea74fb6be98c2e429b620d34aa392a05f42ac2a40f65351808c85dfa2";

export type ContentCopy = {
  header?: {
    eyebrow?: string; // eyebrow
    heading?: string; // heading
    description?: string; // lead
    actions?: Array<{
      label?: string; // label
    }>;
  };
  body: Array<{
    text: string; // body
    items?: string[]; // body
  }>;
  media?: {
    title?: string; // heading
    series?: Array<{
      name?: string; // label
    }>;
  };
  footnote?: string; // body
  aside?: Array<{
    label?: string; // label
    value?: string; // body
  }>;
};
export type ContentVariant = {
  layout?: "stacked" | "split-start" | "split-end";
};
export interface ContentProps {
  copy: ContentCopy;
  variant?: ContentVariant;
}
