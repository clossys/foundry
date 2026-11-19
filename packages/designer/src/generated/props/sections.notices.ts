// Generated from sections.notices by src/generated/props/generate.ts; do not edit.
export const noticesContractSha256 = "177b7d316c46af863b085538e1ceb7df935888c30249a4f472c23ff646d597cd";

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
