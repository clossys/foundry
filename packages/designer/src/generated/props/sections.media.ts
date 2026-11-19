// Generated from sections.media by src/generated/props/generate.ts; do not edit.
export const mediaContractSha256 = "f41470ca27da5af5afc987f8b89e905297618b12ec343eb1246c9ac262578e25";

export type MediaCopy = {
  header?: {
    eyebrow?: string; // eyebrow
    heading?: string; // heading
    description?: string; // lead
  };
  figure: {
    caption?: string; // body
    media: {
      title: string; // heading
      series?: Array<{
        name?: string; // label
      }>;
    };
    "chrome-label"?: string; // label
  };
  callouts?: {
    label?: string; // label
    items?: Array<{
      body?: string; // body
    }>;
  };
};
export type MediaVariant = {
  chrome?: "browser" | "device" | "bare";
};
export interface MediaProps {
  copy: MediaCopy;
  variant?: MediaVariant;
}
