// Generated from sections.link-index by src/generated/props/generate.ts; do not edit.
export const linkIndexContractSha256 = "8afebed40af38f10aba282f2ffddad29ff38cca46be077efec0384b6151b93c6";

export type LinkIndexCopy = {
  header?: {
    eyebrow?: string; // eyebrow
    heading?: string; // heading
    description?: string; // lead
  };
  links: Array<{
    title: string; // heading
    description?: string; // body
    label?: string; // label
    badge?: string; // label
  }>;
};
export type LinkIndexVariant = {
  layout?: "list" | "grid" | "cards";
};
export interface LinkIndexProps {
  copy: LinkIndexCopy;
  variant?: LinkIndexVariant;
}
