import type { RangeChartProps } from "../RangeChart.js";
import type { RangeChartProps as ChartProps } from "../index.js";
import type { RangeChartProps as ServerProps } from "../server.js";
import type { RangeChartProps as RootProps } from "../../index.js";
import type { StatusMarkTone } from "../../atoms/StatusMark.js";

type Row = RangeChartProps["rows"][number];
type Labels = RangeChartProps["labels"];
type RowTone = NonNullable<Row["status"]>["tone"];

function checkRangeContract() {
  const labels: Labels = { table: "Schedule data", category: "Activity", from: "Start boundary", to: "End boundary" };
  const statusLabels: Labels = { ...labels, status: "State" };
  const tones: readonly StatusMarkTone[] = ["success", "warning", "danger", "info", "neutral"];
  const rowTones: readonly RowTone[] = tones;
  const atomTones: readonly StatusMarkTone[] = rowTones;
  const rows: readonly Row[] = tones.map((tone, index) => ({ id: String(index), label: `Activity ${index}`, from: 0, to: 4, status: { tone, label: "Authored state" } }));
  const plain: RangeChartProps = { title: "Schedule", ticks: ["First", "Next"], rows: [{ id: "a", label: "Activity", from: 0.5, to: 2 }], labels };
  const chart: ChartProps = plain;
  const server: ServerProps = chart;
  const root: RootProps = server;
  const source: RangeChartProps = root;
  const withStatus: RangeChartProps = { ...plain, ticks: ["A", "B", "C", "D"], rows, labels: statusLabels };

  // @ts-expect-error All rows require authored identity and label.
  const missingRowLabel: Row = { id: "a", from: 0, to: 1 };
  // @ts-expect-error A status requires its authored visible label.
  const missingStatusLabel: Row = { id: "a", label: "Activity", from: 0, to: 1, status: { tone: "info" } };
  // @ts-expect-error A status label is text, not a numeric code.
  const numericStatusLabel: Row = { id: "a", label: "Activity", from: 0, to: 1, status: { tone: "info", label: 7 } };
  // @ts-expect-error Only the five existing StatusMarkTone values are allowed.
  const unknownStatusTone: Row = { id: "a", label: "Activity", from: 0, to: 1, status: { tone: "complete", label: "Complete" } };
  // @ts-expect-error Numeric tones are not accepted.
  const numericStatusTone: Row = { id: "a", label: "Activity", from: 0, to: 1, status: { tone: 1, label: "Complete" } };
  // @ts-expect-error Authored table disclosure is required.
  const missingTable: Labels = { category: "Activity", from: "Start", to: "End" };
  // @ts-expect-error Authored category header is required.
  const missingCategory: Labels = { table: "Data", from: "Start", to: "End" };
  // @ts-expect-error Authored start-boundary header is required.
  const missingFrom: Labels = { table: "Data", category: "Activity", to: "End" };
  // @ts-expect-error Authored end-boundary header is required.
  const missingTo: Labels = { table: "Data", category: "Activity", from: "Start" };
  // @ts-expect-error A provided status header must be authored text.
  const numericStatusHeader: Labels = { ...labels, status: 1 };
  // @ts-expect-error The required label collection cannot be omitted.
  const missingLabels: RangeChartProps = { title: "Schedule", ticks: ["First"], rows: [] };

  // Blank copy, finite numeric bounds and labels.status iff any row has status
  // remain runtime validation. This fixture does not claim conditional-array
  // typing can enforce that dynamic status-header requirement.
  void [plain, chart, server, root, source, withStatus, atomTones, missingRowLabel, missingStatusLabel, numericStatusLabel, unknownStatusTone, numericStatusTone, missingTable, missingCategory, missingFrom, missingTo, numericStatusHeader, missingLabels];
}
void checkRangeContract;
