// Generated from sections.stats by src/generated/props/generate.ts; do not edit.
export const statsContractSha256 = "33cec29338a4875b9ee73bf6dd7cf22d3b81749aa33d217ed10ff97bccd12a5e";

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
