// Generated from sections.faq by src/generated/props/generate.ts; do not edit.
export const faqContractSha256 = "e90beb25392c67d6831888bf66eea6d439380d0fc20276a65831881801d1b686";

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
