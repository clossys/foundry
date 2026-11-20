// Generated from sections.section-header by src/generated/props/generate.ts; do not edit.
export const sectionHeaderContractSha256 = "24153d9472e7c5d4c7924eb221fae3adc9a8c5e24515f9fc99b75e2908a42ea7";

export type SectionHeaderCopy = {
  eyebrow?: string; // eyebrow
  heading: string; // heading
  description?: string; // body
  actions?: Array<{
    label?: string; // action
  }>;
};
export type SectionHeaderVariant = {
  align?: "start" | "center";
  density?: "display" | "standard" | "compact";
};
export interface SectionHeaderProps {
  copy: SectionHeaderCopy;
  variant?: SectionHeaderVariant;
}
