// Generated from sections.logo-cloud by src/generated/props/generate.ts; do not edit.
export const logoCloudContractSha256 = "e883cf16f24a2216247124f34318f4de8b2a15aad1085c2abaf60b56a06256e3";

export type LogoCloudCopy = {
  header?: {
    eyebrow?: string; // eyebrow
    heading?: string; // heading
    description?: string; // lead
  };
  logos: Array<{
    name: string; // label
  }>;
};
export type LogoCloudVariant = {
  count?: "3" | "4" | "6" | "8" | "12";
  monochrome?: "true" | "false";
};
export interface LogoCloudProps {
  copy: LogoCloudCopy;
  variant?: LogoCloudVariant;
}
