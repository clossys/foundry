// Generated from sections.stats by src/generated/props/generate.ts; do not edit.
export const statsContractSha256 = "06e350f72645e6741828f964648a24e8b7f0c6e09ccc90f13e4f7639f2cd9cdb";

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
