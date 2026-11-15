// Generated from sections.band by src/generated/props/generate.ts; do not edit.
export const bandContractSha256 = "ae1c769c4899f3198d5b1f772e2ee56d2dda2e194b9d75bfb6fb0b4dd5cb386c";

export type BandCopy = Record<string, never>;
export type BandVariant = {
  ground?: "base" | "sunken" | "inverse" | "transparent";
  measure?: "prose" | "content" | "wide";
};
export interface BandProps {
  copy: BandCopy;
  variant?: BandVariant;
}
