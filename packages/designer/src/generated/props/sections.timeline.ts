// Generated from sections.timeline by src/generated/props/generate.ts; do not edit.
export const timelineContractSha256 = "7336e366b2477534f7635f8bfbe998f14f062d79c60807a3c40bca2132619df0";

export type TimelineCopy = {
  header?: {
    eyebrow?: string; // eyebrow
    heading?: string; // heading
    description?: string; // lead
  };
  events: Array<{
    heading: string; // heading
    "date-text": string; // label
    description?: string; // body
  }>;
};
export type TimelineVariant = Record<string, never>;
export interface TimelineProps {
  copy: TimelineCopy;
  variant?: TimelineVariant;
}
