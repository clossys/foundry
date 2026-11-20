// Generated from sections.page-header by src/generated/props/generate.ts; do not edit.
export const pageHeaderContractSha256 = "5d4204a5572ff83915009e8d1ddf61a23440dab9e7f900384c9c165388134a01";

export type PageHeaderCopy = {
  header?: {
    eyebrow?: string; // eyebrow
    heading?: string; // heading
    description?: string; // lead
  };
  title: string; // heading
  description?: string; // body
  breadcrumbs?: {
    label?: string; // label
    items?: Array<{
      label?: string; // label
    }>;
  };
  actions?: Array<{
    label?: string; // action
  }>;
  meta?: Array<{
    label?: string; // label
    value?: string; // label
  }>;
};
export type PageHeaderVariant = {
  config?: "standard" | "record";
  contact?: "header";
};
export interface PageHeaderProps {
  copy: PageHeaderCopy;
  variant?: PageHeaderVariant;
}
