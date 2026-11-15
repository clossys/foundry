// Generated from sections.media by src/generated/props/generate.ts; do not edit.
export const mediaContractSha256 = "8a87f2d2363adb7f97bfe58c532f06a3687b291c4e59977f1352c3ccb0bbbb4d";

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
