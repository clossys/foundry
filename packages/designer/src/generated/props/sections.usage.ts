// Generated from sections.usage by src/generated/props/generate.ts; do not edit.
export const usageContractSha256 = "cffb1b48ed3ad2e66f522a16f264509dd5cbaafd9dbf288232e0cbd2ee813383";

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
