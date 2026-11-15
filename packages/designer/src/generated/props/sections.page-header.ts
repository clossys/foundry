// Generated from sections.page-header by src/generated/props/generate.ts; do not edit.
export const pageHeaderContractSha256 = "282f4190f165eac34d04c5c2d1296ad69a9954a1d58378d20615f788952cca46";

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
