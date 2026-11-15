// Generated from sections.article by src/generated/props/generate.ts; do not edit.
export const articleContractSha256 = "447d6c61408ea4e4efdc1ccf69ffcf311363dbf03f8162855004253626c8b870";

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
