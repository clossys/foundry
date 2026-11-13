import type { StatGroupProps } from "../blocks/StatGroup.js";
import type { StatsCopy } from "../runtime/sections/stats.js";

/** Explicit synthetic Studio contribution; the central specimen owner installs this host for sections.stats. */
export const a270StatsCopy: StatsCopy = {
  label: "ExampleCo key figures",
  trendLabels: { up: "Increase", down: "Decrease", neutral: "No change" },
  states: {
    loading: { label: "Loading ExampleCo figures", description: "The latest measurements are being retrieved." },
    empty: { label: "No ExampleCo figures yet", description: "Measurements appear when reporting begins." },
    error: { label: "ExampleCo figures unavailable", description: "Try loading the report again." },
  },
};
export const a270StatsSpecimen = {
  "aria-label": a270StatsCopy.label,
  items: [
    { id: "customers", label: "ExampleCo customers", value: "2,481", countTo: 2481, delta: "+12%", trend: "up", description: "Compared with the previous month", trendLabels: a270StatsCopy.trendLabels },
    { id: "response", label: "Median response", value: "4 min", countTo: 4, delta: "-1 min", trend: "down", description: "Compared with the previous month", trendLabels: a270StatsCopy.trendLabels },
    { id: "regions", label: "Regions served", value: 16, delta: "0", trend: "neutral", description: "Compared with the previous month", trendLabels: a270StatsCopy.trendLabels },
    { id: "availability", label: "Availability", value: "99.9%", description: "Measured over the previous month" },
  ],
} satisfies StatGroupProps;
export const a270StatsContribution = {
  id: "a270-stats", leaf: "sections.stats", fill: "foundry/sections.stats",
  selectedComponents: ["components.card", "components.semantic-content"],
  requiredCardParts: ["CardHeader", "CardTitle", "CardContent", "CardFooter"],
  requiredContractComposes: ["components.card", "components.semantic-content"],
  nativeTailwindSources: ["components/card/card.tsx", "packages/designer/src/blocks/Stat.tsx", "packages/designer/src/blocks/StatGroup.tsx", "packages/designer/src/blocks/Stats/parts.tsx", "packages/designer/src/runtime/sections/stats.tsx"],
  nativeTypographyClasses: ["text-(length:--text-body-s)", "text-(length:--text-h1)", "font-body", "font-display", "tabular-nums", "text-ink-secondary", "text-ink-primary"],
  specimenHost: { statsCopy: a270StatsCopy, statsMotion: "static" },
  specimen: a270StatsSpecimen,
} as const;
