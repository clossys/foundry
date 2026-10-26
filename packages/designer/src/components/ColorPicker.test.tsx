import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ColorPicker } from "./ColorPicker.js";
describe("ColorPicker candidate", () => {
  it("synchronizes a real hex editor with the root value", async () => {
    const user = userEvent.setup(), changed = vi.fn();
    render(<ColorPicker defaultValue="#ff0000" onChange={changed}>{({ color }) => <><ColorPicker.Field label="Hex" /><output aria-label="Selected color">{color.toString("hex")}</output></>}</ColorPicker>);
    const field = screen.getByRole("textbox", { name: "Hex" });
    await user.clear(field); await user.type(field, "00ff00"); await user.tab();
    expect(screen.getByLabelText("Selected color")).toHaveTextContent("#00FF00");
    expect(changed).toHaveBeenCalled();
  });
  it("provides actual area, wheel and slider controls and disabled semantics", () => {
    render(<ColorPicker defaultValue="hsl(0, 100%, 50%)"><ColorPicker.Area aria-label="Saturation and lightness" colorSpace="hsl" xChannel="saturation" yChannel="lightness" isDisabled style={{ width: 160, height: 160 }} /><ColorPicker.Wheel aria-label="Hue wheel" outerRadius={80} innerRadius={60} isDisabled style={{ width: 160, height: 160 }} /><ColorPicker.Slider label="Hue" channel="hue" isDisabled /></ColorPicker>);
    // RAC hides the unfocused second area axis until a keyboard value change.
    const sliders = screen.getAllByRole("slider", { hidden: true });
    expect(sliders).toHaveLength(4);
    for (const slider of sliders) expect(slider).toBeDisabled();
  });
  it("selects a real swatch through native keyboard events", async () => {
    const user = userEvent.setup();
    render(<ColorPicker defaultValue="#ff0000">{({ color }) => <><ColorPicker.SwatchPicker aria-label="Palette" layout="stack"><ColorPicker.Swatch color="#ff0000" /><ColorPicker.Swatch color="#0000ff" /></ColorPicker.SwatchPicker><output aria-label="Selected color">{color.toString("hex")}</output></>}</ColorPicker>);
    act(() => screen.getAllByRole("option")[0]!.focus()); await user.keyboard("{ArrowDown} ");
    expect(screen.getByLabelText("Selected color")).toHaveTextContent("#0000FF");
  });
});
