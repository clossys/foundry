import { selectedComponent } from "#designer-component-selection";
import { BarChart as StandaloneBarChart } from "../charts/BarChart.js";
import { LineChart as StandaloneLineChart } from "../charts/LineChart.js";
export const BarChart = selectedComponent("ChartBar", StandaloneBarChart);
export const LineChart = selectedComponent("ChartLine", StandaloneLineChart);
