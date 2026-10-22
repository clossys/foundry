import type { CSSProperties } from "react";

export interface SignatureChartLabels {
  /** @default "No data" */
  empty: string;
  /** @default "Loading data" */
  loading: string;
  /** @default "No data" */
  missing: string;
  /** @default "X" */
  xColumn: string;
  /** @default "Row" */
  rowColumn: string;
  /** @default "From" */
  fromColumn: string;
  /** @default "To" */
  toColumn: string;
  /** @default "Status" */
  statusColumn: string;
  /** @default "{title}: use arrow keys to inspect values; Enter to select" */
  inspection: (title: string) => string;
  /** @default "{title} series" */
  series: (title: string) => string;
  /** @default "Scale: {minimum} to {maximum}" */
  scale: (minimum: string, maximum: string) => string;
  /** @default The authored status key: ok, warn, error or unknown. */
  status: (status: StatusStripSegment["status"]) => string;
}

export interface SignatureChartProps {
  title: string;
  description?: string;
  width?: number;
  height?: number;
  loading?: boolean;
  /** Optional translations of the documented shared chart copy defaults. */
  labels?: Partial<SignatureChartLabels>;
  /** Controlled inspected datum, or omit for local keyboard/pointer state. */
  activeIndex?: number | null;
  onActiveIndexChange?: (index: number | null) => void;
  /** Controlled selection. Indices refer to x, row-major cells, or gap-inclusive intervals. */
  selectedIndex?: number | null;
  onSelectionChange?: (index: number | null) => void;
  tableFallbackLabel?: string;
  className?: string;
  style?: CSSProperties;
}

export interface AreaChartSeries {
  readonly name: string;
  readonly values: readonly (number | null)[];
  readonly color?: string;
}

export interface AreaChartProps extends SignatureChartProps {
  readonly x: readonly (string | number | Date)[];
  readonly series: readonly AreaChartSeries[];
  readonly colorDomain?: readonly string[];
  stacked?: boolean;
  /** Implies stacked; each nonzero column totals 100 percent. */
  normalized?: boolean;
  smooth?: boolean;
  hiddenSeries?: readonly string[];
  onHiddenSeriesChange?: (names: readonly string[]) => void;
  valueFormat?: (value: number) => string;
  xFormat?: (value: string | number | Date) => string;
}

export interface HeatmapProps extends SignatureChartProps {
  readonly rows: readonly string[];
  readonly columns: readonly string[];
  readonly values: ReadonlyArray<ReadonlyArray<number | string | null>>;
  categorical?: boolean;
  /** Full stable identity domain for categorical mode (at most eight). */
  readonly colorDomain?: readonly string[];
  valueFormat?: (value: number | string) => string;
}

export interface StatusStripSegment {
  readonly from: number | Date;
  readonly to: number | Date;
  readonly status: "ok" | "warn" | "error" | "unknown";
}

export interface StatusStripProps extends SignatureChartProps {
  readonly segments: readonly StatusStripSegment[];
  /** Optional full observation window; uncovered intervals become explicit unknown segments. */
  readonly domain?: readonly [number | Date, number | Date];
  intervalFormat?: (value: number | Date) => string;
}
