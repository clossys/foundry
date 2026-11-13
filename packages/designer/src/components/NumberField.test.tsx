import { createRef } from "react";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { NumberField } from "./NumberField.js";
const names = { incrementLabel: "Increase quantity", decrementLabel: "Decrease quantity" };
describe("NumberField candidate", () => {
  it("uses native numeric keys, step and bounds without hand-written parsing", async () => {
    const user = userEvent.setup(), changed = vi.fn();
    render(<NumberField {...names} label="Quantity" defaultValue={4} step={2} minValue={2} maxValue={6} onChange={changed} />);
    const input = screen.getByRole("textbox", { name: "Quantity" });
    act(() => input.focus());
    await user.keyboard("{ArrowUp}");
    expect(changed).toHaveBeenLastCalledWith(6);
    expect(screen.getByRole("button", { name: names.incrementLabel })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: names.decrementLabel }));
    expect(changed).toHaveBeenLastCalledWith(4);
    await user.keyboard("{ArrowDown}");
  });
  it("preserves locale formatting, validation descriptions, ref and read-only behavior", async () => {
    const user = userEvent.setup(), changed = vi.fn(), ref = createRef<HTMLDivElement>();
    render(<NumberField {...names} ref={ref} label="Cost" defaultValue={12} formatOptions={{ style: "currency", currency: "USD" }} isReadOnly isInvalid errorMessage="Review amount" description="Whole amount" onChange={changed} />);
    const input = screen.getByRole("textbox", { name: "Cost" });
    expect(input).toHaveValue("$12.00");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription("Whole amount Review amount");
    expect(ref.current).toContainElement(input);
    act(() => input.focus()); await user.keyboard("{ArrowUp}");
    expect(changed).not.toHaveBeenCalled();
  });
  it("disables both steppers and the editor", async () => {
    const changed = vi.fn();
    render(<NumberField {...names} label="Quantity" isDisabled defaultValue={3} onChange={changed} />);
    expect(screen.getByRole("textbox")).toBeDisabled();
    for (const button of screen.getAllByRole("button")) expect(button).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: names.incrementLabel }));
    expect(changed).not.toHaveBeenCalled();
  });
});
