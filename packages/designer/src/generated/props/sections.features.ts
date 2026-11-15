// Generated from sections.features by src/generated/props/generate.ts; do not edit.
export const featuresContractSha256 = "2fe32997f242760cb91eb30003d6b680bbe368e4ae40263c1fdfd6738738c076";

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
