/** Designer-owned previews explicitly choose this standalone implementation set. */
import * as components from "../components/index.js";
import { BarChart } from "../charts/BarChart.js";
import { LineChart } from "../charts/LineChart.js";
export const standaloneComponents = Object.freeze({ ...components, Logo: components.Logomark, ChartBar: BarChart, ChartLine: LineChart });
