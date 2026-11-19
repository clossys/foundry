// Generated from sections.hero by src/generated/props/generate.ts; do not edit.
export const heroContractSha256 = "2c20205b0da61b4f06f9dd32ad1c834c01a3a41c574622f6848d3c53306434ae";

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
