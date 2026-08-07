import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Switch } from "./Switch.js";

describe("Switch", () => {
  it("renders a labeled switch with role='switch'", () => {
    render(<Switch>Email notifications</Switch>);
    const toggle = screen.getByRole("switch", { name: "Email notifications" });
    expect(toggle).toBeInTheDocument();
  });

  it("forwards className, and the consumer's conflicting class wins the merge", () => {
    render(<Switch className="gap-lg">Email notifications</Switch>);
    const toggle = screen.getByRole("switch", { name: "Email notifications" });
    const label = toggle.closest("label");
    expect(label?.className).toContain("gap-lg");
    expect(label?.className).not.toContain("gap-sm");
  });

  it("toggles on click and on Space, starting unchecked by default", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Switch onChange={onChange}>Email notifications</Switch>);
    const toggle = screen.getByRole("switch", { name: "Email notifications" });
    expect(toggle).not.toBeChecked();
    await user.click(toggle);
    expect(onChange).toHaveBeenCalledWith(true);
    toggle.focus();
    await user.keyboard(" ");
    expect(onChange).toHaveBeenCalledWith(false);
  });

  it("disabled: does not fire onChange and is not tab-reachable", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <Switch onChange={onChange} isDisabled>
        Email notifications
      </Switch>,
    );
    const toggle = screen.getByRole("switch", { name: "Email notifications" });
    expect(toggle).toBeDisabled();
    await user.click(toggle);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("a controlled isSelected reflects as the checked state", () => {
    const { rerender } = render(<Switch isSelected={false}>Email notifications</Switch>);
    expect(screen.getByRole("switch", { name: "Email notifications" })).not.toBeChecked();
    rerender(<Switch isSelected>Email notifications</Switch>);
    expect(screen.getByRole("switch", { name: "Email notifications" })).toBeChecked();
  });
});
