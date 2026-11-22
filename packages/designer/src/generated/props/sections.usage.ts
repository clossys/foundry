// Generated from sections.usage by src/generated/props/generate.ts; do not edit.
export const usageContractSha256 = "aed6330e4427e3ac4cfa6df366223969bee9469ec835e2af55d419d74e60d6f4";

export type UsageCopy = {
  header?: {
    eyebrow?: string; // eyebrow
    heading?: string; // heading
    description?: string; // lead
  };
  meters: Array<{
    label: string; // label
    "used-text"?: string; // label
    "limit-text"?: string; // label
    "period-text"?: string; // label
    "projected-text"?: string; // label
    thresholds?: Array<{
      message?: string; // label
    }>;
  }>;
  labels?: {
    label?: string; // label
  };
  states: {
    loading: {
      label: string; // label
      description?: string; // body
    };
    empty: {
      label: string; // label
      description?: string; // body
    };
    error: {
      label: string; // label
      description?: string; // body
    };
  };
};
export type UsageVariant = Record<string, never>;
export interface UsageProps {
  copy: UsageCopy;
  variant?: UsageVariant;
}
