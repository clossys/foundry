// Generated from sections.section-header by src/generated/props/generate.ts; do not edit.
export const sectionHeaderContractSha256 = "16c55c40f7619491e61681f615b6621bab3126869f1719240a4445503dfddfb9";

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
