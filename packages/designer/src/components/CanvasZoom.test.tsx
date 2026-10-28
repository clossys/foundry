// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { CanvasZoom } from "./CanvasZoom.js";

afterEach(cleanup);
const labels = { group: "Zoom", out: "Zoom out", in: "Zoom in", fit: "Fit", percent: "Zoom level" };
const setup = (value: number, onChange = vi.fn(), onFit = vi.fn()) =>
  render(<CanvasZoom value={value} min={0.12} max={2} labels={labels} formatValue={value => `${Math.round(value)}%`} onChange={onChange} onFit={onFit} />);

it("zoom steps are square small icon buttons drawn with Minus and Plus glyphs, not text characters", () => {
  setup(0.5);
  for (const name of ["Zoom out", "Zoom in"]) {
    const button = screen.getByRole("button", { name });
    expect(button).toHaveClass("icon-control-sm", "rounded-control");
    expect(button.querySelector("svg")).not.toBeNull();
    expect(button.textContent).toBe("");
  }
  expect(screen.getByRole("button", { name: "Zoom out" }).querySelector("path")?.getAttribute("d")).toBe("M5 12h14");
  expect(screen.getByRole("button", { name: "Zoom in" }).querySelector("path")?.getAttribute("d")).toContain("M12 5v14");
});

it("zoom steps and reset still drive the camera", async () => {
  const onChange = vi.fn();
  setup(0.5, onChange);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Zoom in" }));
  expect(onChange).toHaveBeenLastCalledWith(0.6);
  await user.click(screen.getByRole("button", { name: "Zoom out" }));
  expect(onChange.mock.calls.at(-1)![0]).toBeCloseTo(0.5 / 1.2);
  await user.click(screen.getByRole("button", { name: "100%" }));
  expect(onChange).toHaveBeenLastCalledWith(1);
});

it("never shows 100% twice: the reset is inert and hidden while the readout already says 100%", () => {
  const { container } = setup(1);
  expect(screen.getByRole("status", { name: "Zoom level" })).toHaveTextContent("100%");
  const reset = container.querySelector("[data-zoom-reset]")!;
  expect(reset).toHaveClass("invisible");
  expect(reset).toHaveAttribute("inert");
  cleanup();
  const other = setup(0.5);
  const live = other.container.querySelector("[data-zoom-reset]")!;
  expect(live).not.toHaveClass("invisible");
  expect(live).not.toHaveAttribute("inert");
});

it("vf35: every zoom control carries a stable capture hook alongside its accessible name", () => {
  setup(0.5);
  const hook = (name: string) => screen.getByRole("button", { name }).getAttribute("data-studio-control");
  expect(hook("Zoom out")).toBe("zoom-out");
  expect(hook("Zoom in")).toBe("zoom-in");
  expect(hook("Fit")).toBe("zoom-fit");
  expect(hook("100%")).toBe("zoom-reset");
});
