// Generated from sections.pricing by src/generated/props/generate.ts; do not edit.
export const pricingContractSha256 = "9d35f810c46f8b53e117fef6d70c30458e8af78e764419b813f7166a5a66b250";

export type PricingCopy = {
  header?: {
    eyebrow?: string; // eyebrow
    heading?: string; // heading
    description?: string; // lead
  };
  plans: Array<{
    name: string; // label
    price?: string; // label
    description?: string; // body
    features?: string[]; // label
    cta: {
      label: string; // label
    };
    badge?: string; // label
    "price-by-interval": Array<{
      amount: string; // label
      "price-text": string; // label
    }>;
  }>;
  interval?: string; // label
};
export type PricingVariant = Record<string, never>;
export interface PricingProps {
  copy: PricingCopy;
  variant?: PricingVariant;
}
