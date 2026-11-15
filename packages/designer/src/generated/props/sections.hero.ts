// Generated from sections.hero by src/generated/props/generate.ts; do not edit.
export const heroContractSha256 = "c70455c25db356733938106e71d15510bc62ef02fc1ecb64dab724218622c3c3";

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
