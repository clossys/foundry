// Generated from sections.content by src/generated/props/generate.ts; do not edit.
export const contentContractSha256 = "ec28de1b312f444a42766bb7ce655ad577cb7cac702c30bf6534aa0224510508";

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
