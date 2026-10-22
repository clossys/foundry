import {
  AreaChart,
  Heatmap,
  StatusStrip,
  type AreaChartProps,
  type AreaChartSeries,
  type SignatureChartLabels,
  type HeatmapProps,
  type StatusStripProps,
  type StatusStripSegment,
} from "../index.js";
import {
  AreaChart as ServerArea,
  Heatmap as ServerHeatmap,
  StatusStrip as ServerStrip,
} from "../server.js";

const series: AreaChartSeries = { name: "Volume", values: [1, null] };
const labels: Partial<SignatureChartLabels> = { missing: "Absent", inspection: title => `${title}: inspect` };
const area: AreaChartProps = {
  title: "Volume",
  x: ["A", "B"],
  series: [series],
  normalized: true,
  labels,
  onActiveIndexChange: (index) => {
    const nullable: number | null = index;
    void nullable;
  },
};
const heat: HeatmapProps = {
  title: "Grid",
  rows: ["R"],
  columns: ["C"],
  values: [[null]],
  categorical: true,
};
const segment: StatusStripSegment = {
  from: new Date(0),
  to: new Date(10),
  status: "unknown",
};
const strip: StatusStripProps = {
  title: "History",
  segments: [segment],
  selectedIndex: null,
};
const contracts = [
  <AreaChart {...area} />,
  <ServerArea {...area} />,
  <Heatmap {...heat} />,
  <ServerHeatmap {...heat} />,
  <StatusStrip {...strip} />,
  <ServerStrip {...strip} />,
];
void contracts;

// @ts-expect-error Unknown status is outside the finite public interval contract.
const invalidStatus: StatusStripSegment = { from: 0, to: 1, status: "healthy" };
// @ts-expect-error An area gap is null, never a string datum.
const invalidArea: AreaChartSeries = { name: "Wrong", values: ["missing"] };
const invalidCallback: HeatmapProps = {
  ...heat,
  // @ts-expect-error Selection callbacks carry an index or null, not an authored record.
  onSelectionChange: (record: { id: string }) => {},
};
void [invalidStatus, invalidArea, invalidCallback];
