// Generated from sections.stats by src/generated/props/generate.ts; do not edit.
export const statsContractSha256 = "f03e14ff5445532c30dfbfa6e97f99a3b8f48b95ba8dd23938496c76bfc2d7aa";

export type StatsCopy = {
  header?: {
    eyebrow?: string; // eyebrow
    heading?: string; // heading
    description?: string; // lead
  };
  stats: Array<{
    label: string; // label
    description?: string; // body
    value: string; // label
    delta?: string; // label
  }>;
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
export type StatsVariant = {
  layout?: "grid" | "row";
};
export interface StatsProps {
  copy: StatsCopy;
  variant?: StatsVariant;
}
