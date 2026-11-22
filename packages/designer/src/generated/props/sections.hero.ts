// Generated from sections.hero by src/generated/props/generate.ts; do not edit.
export const heroContractSha256 = "23b1bf5730497046348a7adaa0b2cff56bac0eee7bb1ee610522154e5e6024c6";

export type HeroCopy = {
  header: {
    heading: string; // heading
    eyebrow?: string; // eyebrow
    description?: string; // lead
  };
  actions?: {
    primary?: {
      label?: string; // action
    };
    secondary?: {
      label?: string; // action
    };
  };
  media?: {
    title?: string; // heading
    series?: Array<{
      name?: string; // label
    }>;
  };
};
export type HeroVariant = {
  layout?: "editorial" | "split" | "full-bleed";
  size?: "display" | "compact" | "default";
  ground?: "base" | "inverse";
  backdrop?: "scrim.light" | "scrim.strong";
};
export interface HeroProps {
  copy: HeroCopy;
  variant?: HeroVariant;
}
