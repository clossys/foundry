// Generated from sections.pricing by src/generated/props/generate.ts; do not edit.
export const pricingContractSha256 = "c6f3ac703da2841e645b16ba21ecf3995af2952279a65896d0acd7a196b3ff63";

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
