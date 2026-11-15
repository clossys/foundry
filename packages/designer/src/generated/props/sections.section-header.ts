// Generated from sections.section-header by src/generated/props/generate.ts; do not edit.
export const sectionHeaderContractSha256 = "d2758d8562f1727b1aa99af8bff079624b9c61f3b8ddada0d40161d6a27147d1";

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
