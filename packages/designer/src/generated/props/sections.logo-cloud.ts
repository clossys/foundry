// Generated from sections.logo-cloud by src/generated/props/generate.ts; do not edit.
export const logoCloudContractSha256 = "8543961addcd94ded67f96a9cdd44fcd8a0761b756eea56ed3eaa38e38314b14";

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
