import {
  AreaChart,
  type AreaChartProps,
  type AreaChartSeries,
  type SignatureChartLabels,
} from "../index.js";
import {
  AreaChart as ServerArea,
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
const contracts = [
  <AreaChart {...area} />,
  <ServerArea {...area} />,
];
void contracts;

// @ts-expect-error An area gap is null, never a string datum.
const invalidArea: AreaChartSeries = { name: "Wrong", values: ["missing"] };
const invalidCallback: AreaChartProps = {
  ...area,
  // @ts-expect-error Selection callbacks carry an index or null, not an authored record.
  onSelectionChange: (record: { id: string }) => {},
};
void [invalidArea, invalidCallback];
