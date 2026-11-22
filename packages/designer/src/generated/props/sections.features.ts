// Generated from sections.features by src/generated/props/generate.ts; do not edit.
export const featuresContractSha256 = "e235895c296b1275d86ba117fea34118e6b4a9bed768918a79d7aef5e042cf07";

export type FeaturesCopy = {
  header?: {
    eyebrow?: string; // eyebrow
    heading?: string; // heading
    description?: string; // lead
  };
  items: Array<{
    heading: string; // heading
    description?: string; // body
  }>;
};
export type FeaturesVariant = {
  layout?: "grid" | "list" | "split" | "bento" | "tabs" | "alternating" | "scroll";
  about?: "features";
};
export interface FeaturesProps {
  copy: FeaturesCopy;
  variant?: FeaturesVariant;
}
