// Generated from sections.band by src/generated/props/generate.ts; do not edit.
export const bandContractSha256 = "d266147617247a6d9c2a8ebb49ea846a1ebbdea64abfb6b0869029fa391f13f8";

export type BandCopy = Record<string, never>;
export type BandVariant = {
  ground?: "base" | "sunken" | "inverse" | "transparent";
  measure?: "prose" | "content" | "wide";
};
export interface BandProps {
  copy: BandCopy;
  variant?: BandVariant;
}
