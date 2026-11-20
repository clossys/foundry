// Generated from sections.link-index by src/generated/props/generate.ts; do not edit.
export const linkIndexContractSha256 = "a221005ca28adf58056a4c2b53827015e552424101dda61c64ef5020c05aaac0";

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
