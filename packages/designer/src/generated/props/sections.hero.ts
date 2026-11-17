// Generated from sections.hero by src/generated/props/generate.ts; do not edit.
export const heroContractSha256 = "754ee7479eeedbb0e110db0bbbeff382ce2b4b71c02821154deab67512639a6a";

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
