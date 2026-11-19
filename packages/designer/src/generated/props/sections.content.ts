// Generated from sections.content by src/generated/props/generate.ts; do not edit.
export const contentContractSha256 = "1061a71ec9d2f78b6c0373954664eaedee799a85b26846e948fafb592d698060";

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
