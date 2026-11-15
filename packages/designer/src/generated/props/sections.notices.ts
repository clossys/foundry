// Generated from sections.notices by src/generated/props/generate.ts; do not edit.
export const noticesContractSha256 = "37831040a1f979913c537bd6c3bbd85c72d417de9258f6116f1034a4c4dba7cf";

export type NoticesCopy = {
  header?: {
    eyebrow?: string; // eyebrow
    heading?: string; // heading
    description?: string; // lead
  };
  notices: Array<{
    title: string; // heading
    body?: string; // body
    action?: {
      label?: string; // label
    };
    "dismiss-label"?: string; // label
  }>;
};
export type NoticesVariant = {
  legal?: "draft";
};
export interface NoticesProps {
  copy: NoticesCopy;
  variant?: NoticesVariant;
}
