// Generated from sections.features by src/generated/props/generate.ts; do not edit.
export const featuresContractSha256 = "dd7221449dcc344b9f7c777b989c91cac257f664425438e477a97dcec8819d10";

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
