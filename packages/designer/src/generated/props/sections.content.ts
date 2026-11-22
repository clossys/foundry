// Generated from sections.content by src/generated/props/generate.ts; do not edit.
export const contentContractSha256 = "84f615cc83ad44017e926e60b1445cf9d41806e63c94304b97a68ce8a5e9dba5";

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
