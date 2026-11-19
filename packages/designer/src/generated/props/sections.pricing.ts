// Generated from sections.pricing by src/generated/props/generate.ts; do not edit.
export const pricingContractSha256 = "897e10d30d2d8ac5d12cc73fbdfb9227ee272039b58e62d2dd745c7c45abc1a8";

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
