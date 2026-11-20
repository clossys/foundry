// Generated from sections.timeline by src/generated/props/generate.ts; do not edit.
export const timelineContractSha256 = "4736d275a33f89779ef505db8e75db215245e61381ed9f29fd0357c81d6d0075";

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
