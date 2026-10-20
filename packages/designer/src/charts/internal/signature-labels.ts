import type { SignatureChartLabels, SignatureChartProps } from "./signature-types.js";

/** Defaults for the public, overridable label contract; data and geometry contain no copy. */
const defaults: SignatureChartLabels = {
  empty: "No data",
  loading: "Loading data",
  missing: "No data",
  xColumn: "X",
  rowColumn: "Row",
  fromColumn: "From",
  toColumn: "To",
  statusColumn: "Status",
  inspection: title => `${title}: use arrow keys to inspect values; Enter to select`,
  series: title => `${title} series`,
  scale: (minimum, maximum) => `Scale: ${minimum} to ${maximum}`,
  status: status => status,
};

export function resolveLabels(props: SignatureChartProps): SignatureChartLabels {
  const authored = Object.fromEntries(Object.entries(props.labels ?? {}).filter(([, value]) => value !== undefined));
  return { ...defaults, ...authored };
}
