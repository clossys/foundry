// Generated from sections.article by src/generated/props/generate.ts; do not edit.
export const articleContractSha256 = "636419d9dbbe1dc8c4df45845d01dd9736ae3d1f7663c84f0c3f27b3cca93809";

export type ArticleCopy = {
  header?: {
    eyebrow?: string; // eyebrow
    heading?: string; // heading
    description?: string; // lead
  };
  body: Array<{
    text: string; // body
    items?: string[]; // body
  }>;
  toc?: {
    label?: string; // label
    items?: Array<{
      label?: string; // label
    }>;
  };
};
export type ArticleVariant = {
  typography?: "drop-cap";
};
export interface ArticleProps {
  copy: ArticleCopy;
  variant?: ArticleVariant;
}
