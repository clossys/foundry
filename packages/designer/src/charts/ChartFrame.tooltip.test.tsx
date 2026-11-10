import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ChartFrame } from "./ChartFrame.js";
import { AreaChart } from "./AreaChart.js";

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
});

