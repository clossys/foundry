// Generated from sections.faq by src/generated/props/generate.ts; do not edit.
export const faqContractSha256 = "03afe05461c9fe4cbba8cde6e1ec4e66184c91da12ad527a7354204277a242f2";

export type FaqCopy = {
  header?: {
    eyebrow?: string; // eyebrow
    heading?: string; // heading
    description?: string; // lead
  };
  items: Array<{
    question: string; // label
    answer: string; // body
  }>;
};
export type FaqVariant = {
  layout?: "list" | "two-column";
  about?: "faq";
};
export interface FaqProps {
  copy: FaqCopy;
  variant?: FaqVariant;
}
