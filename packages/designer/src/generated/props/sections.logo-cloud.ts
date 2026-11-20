// Generated from sections.logo-cloud by src/generated/props/generate.ts; do not edit.
export const logoCloudContractSha256 = "541f367223cdf62cba5287a2fac1686720debe7f8da1a8e8d3f302be045768de";

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
