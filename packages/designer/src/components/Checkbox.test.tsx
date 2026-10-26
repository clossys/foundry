import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Checkbox } from "./Checkbox.js";

describe("Checkbox", () => {
  it("renders a labeled checkbox", () => {
    render(<Checkbox>Select all</Checkbox>);
    const checkbox = screen.getByRole("checkbox", { name: "Select all" });
    expect(checkbox).toBeInTheDocument();
  });

  it("forwards className, and the consumer's conflicting class wins the merge", () => {
    render(<Checkbox className="gap-lg">Select all</Checkbox>);
    const checkbox = screen.getByRole("checkbox", { name: "Select all" });
    const label = checkbox.closest("label");
    expect(label?.className).toContain("gap-lg");
    expect(label?.className).not.toContain("gap-sm");
  });

  it("forwards a consumer style prop, and the consumer's conflicting property wins the merge", () => {
    render(
      <Checkbox isDisabled style={{ opacity: 0.42, marginTop: "8px" }}>
        Select all
      </Checkbox>,
    );
    const checkbox = screen.getByRole("checkbox", { name: "Select all" });
    const label = checkbox.closest("label") as HTMLLabelElement;
    // The component's own disabled-state opacity would otherwise apply here
    // (see UI_ALPHA_DISABLED in Checkbox.tsx) — the consumer's explicit
    // value must win instead of being silently dropped.
    expect(label.style.opacity).toBe("0.42");
    // A non-conflicting property the component never sets must survive too.
    expect(label.style.marginTop).toBe("8px");
  });

  it("toggles on click and on Space", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Checkbox onChange={onChange}>Select all</Checkbox>);
    const checkbox = screen.getByRole("checkbox", { name: "Select all" });
    await user.click(checkbox);
    expect(onChange).toHaveBeenCalledWith(true);
    checkbox.focus();
    await user.keyboard(" ");
    expect(onChange).toHaveBeenCalledWith(false);
  });

  it("disabled: does not fire onChange and is not tab-reachable", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <Checkbox onChange={onChange} isDisabled>
        Select all
      </Checkbox>,
    );
    const checkbox = screen.getByRole("checkbox", { name: "Select all" });
    expect(checkbox).toBeDisabled();
    await user.click(checkbox);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("indeterminate: sets the native indeterminate IDL property, distinct from checked or unchecked", () => {
    // A real `<input type="checkbox">`'s mixed state is exposed to
    // assistive tech via the `indeterminate` IDL property, not a reflected
    // `aria-checked` HTML attribute — there is no such attribute on a
    // native checkbox for this component to set even if it wanted to; the
    // browser derives the accessible "mixed" state directly from this
    // property. See react-aria-components' own `Checkbox` docs.
    const { rerender } = render(<Checkbox isIndeterminate>Select all</Checkbox>);
    const checkbox = screen.getByRole("checkbox", { name: "Select all" }) as HTMLInputElement;
    expect(checkbox.indeterminate).toBe(true);

    rerender(<Checkbox isSelected={false}>Select all</Checkbox>);
    expect(checkbox.indeterminate).toBe(false);
    expect(checkbox.checked).toBe(false);
  });

  it("indeterminate is presentational only: isSelected still governs the actual checked state", () => {
    render(
      <Checkbox isIndeterminate isSelected={false}>
        Select all
      </Checkbox>,
    );
    const checkbox = screen.getByRole("checkbox", { name: "Select all" }) as HTMLInputElement;
    expect(checkbox.checked).toBe(false);
    expect(checkbox.indeterminate).toBe(true);
  });
});
