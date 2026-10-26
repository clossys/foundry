import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ChartFrame } from "./ChartFrame.js";
import { AreaChart } from "./AreaChart.js";
import { Heatmap } from "./Heatmap.js";
import { StatusStrip } from "./StatusStrip.js";
import { RangeChart } from "./RangeChart.js";
import { ScatterChart } from "./ScatterChart.js";
import { WaterfallChart } from "./WaterfallChart.js";

describe("SEL2 shared chart tooltip", () => {
 it("uses one server-safe tooltip part with keyboard and pointer CSS and authored text", () => {
  const {container}=render(<ChartFrame title="Values" table={{headers:[],rows:[]}}>{plot =>
   <ChartFrame.Tooltip plot={plot} x={100} y={40} text="Authored value 42"><circle cx={100} cy={40} r={4}/></ChartFrame.Tooltip>
  }</ChartFrame>);
  const trigger=container.querySelector('[data-chart-tooltip-trigger]')!;
  expect(trigger).toHaveAttribute("tabindex", "0");
  expect(trigger).toHaveAttribute("aria-label", "Authored value 42");
  expect(trigger.querySelector('[data-chart-part="tooltip"]')).toHaveTextContent("Authored value 42");
  expect(container.querySelector("style")).toHaveTextContent(":focus");
  expect(container.querySelector("style")).toHaveTextContent(":hover");
 });
 it("shows authored area values through existing focus inspection and clears on blur", () => {
  const {container}=render(<AreaChart title="Volume" x={["Jan","Feb"]} series={[{name:"First",values:[10,20]}]} valueFormat={v=>`${v} items`} />);
  const overlay=container.querySelector('[data-chart-part="hover-overlay"]')!;
  fireEvent.focus(overlay);
  expect(container.querySelector('[data-chart-part="tooltip"]')).toHaveTextContent("Jan: First 10 items");
  fireEvent.blur(overlay);
  expect(container.querySelector('[data-chart-part="tooltip"]')).toBeNull();
 });
 it("shares the part for heatmap and status inspection", () => {
  const heat=render(<Heatmap title="Capacity" rows={["East"]} columns={["Mon"]} values={[[42]]} />);
  fireEvent.pointerEnter(heat.container.querySelector('[data-chart-part="cell"]')!);
  expect(heat.container.querySelector('[data-chart-part="tooltip"]')).toHaveTextContent("East, Mon, 42");
  heat.unmount();
  const status=render(<StatusStrip title="Health" segments={[{from:0,to:10,status:"ok"}]} />);
  fireEvent.focus(status.container.querySelector('[data-chart-part="segment"]')!);
  expect(status.container.querySelector('[data-chart-part="tooltip"]')).toHaveTextContent("0–10");
 });
 it("renders focusable shared parts in the three static charts without requiring client state", () => {
  const range=render(<RangeChart title="Schedule" ticks={["Mon","Tue"]} rows={[{id:"a",label:"Build",from:0,to:2}]} labels={{table:"Data",category:"Task",from:"Start",to:"End"}} />);
  expect(range.container.querySelector('[data-chart-tooltip-trigger]')).toHaveAttribute("aria-label", "Build: Start 0; End 2");
  expect(range.container.querySelector('[data-chart-part="tooltip"]')).toBeInTheDocument(); range.unmount();
  const scatter=render(<ScatterChart title="Points" points={[{id:"a",label:"A",x:1,y:1},{id:"b",label:"B",x:2,y:2},{id:"c",label:"C",x:3,y:3}]} x={{label:"Time"}} y={{label:"Cost"}} labels={{table:"Data",category:"Record"}} />);
  expect(scatter.container.querySelector('[data-chart-tooltip-trigger]')).toHaveAttribute("aria-label", "A: Time 1; Cost 1"); scatter.unmount();
  const waterfall=render(<WaterfallChart title="Balance" start={{label:"Opening",value:10}} steps={[{id:"a",label:"Sales",value:2}]} end={{label:"Closing"}} labels={{table:"Data",category:"Stage",value:"Amount"}} />);
  expect(waterfall.container.querySelectorAll('[data-chart-part="tooltip"]')).toHaveLength(3);
  expect(waterfall.container.querySelector('[data-chart-tooltip-trigger]')).toHaveAttribute("aria-label", "Opening: Amount +10");
 });
});

it("retains complete long authored text and table data in a narrow plot", () => {
 const label="An authored interval name that exceeds the available narrow plot width by a considerable amount";
 const {container}=render(<RangeChart title="Schedule" width={100} ticks={["A"]} rows={[{id:"a",label,from:0,to:1}]} labels={{table:"Data",category:"Task",from:"Start",to:"End"}} />);
 expect(container.querySelector("table tbody td")?.textContent).toBe(label);
 expect(container.querySelector('[data-chart-tooltip-trigger]')).toHaveAttribute("aria-label", `${label}: Start 0; End 1`);
 expect(container.querySelector('[data-chart-part="tooltip"] text')?.textContent).toBe(`${label}: Start 0; End 1`);
 // Text retention does not assert containment or browser accessibility conformance.
});
