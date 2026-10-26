import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ToggleButton } from "./ToggleButton.js";
import { Check } from "../icons/index.js";
import { Icon } from "./Icon.js";

const classes = (element: HTMLElement) => element.className.split(/\s+/);

describe("Foundry ToggleButton", () => {
  it("is a real button carrying aria-pressed, toggled by click, Enter and Space", async () => {
    const user = userEvent.setup();
    render(<ToggleButton>Bold</ToggleButton>);
    const button = screen.getByRole("button", { name: "Bold" });
    expect(button.tagName).toBe("BUTTON");
    expect(button).toHaveAttribute("aria-pressed", "false");
    await user.click(button);
    expect(button).toHaveAttribute("aria-pressed", "true");
    await user.keyboard("{Enter}");
    expect(button).toHaveAttribute("aria-pressed", "false");
    await user.keyboard(" ");
    expect(button).toHaveAttribute("aria-pressed", "true");
  });

  it("selected binds to the action colour (C12); the resting look is the Button's secondary look", async () => {
    const user = userEvent.setup();
    render(<ToggleButton>Bold</ToggleButton>);
    const button = screen.getByRole("button", { name: "Bold" });
    expect(classes(button)).toEqual(expect.arrayContaining(["bg-surface-raised", "border-line-control", "text-ink-primary"]));
    expect(classes(button)).not.toContain("bg-action");
    await user.click(button);
    expect(button).toHaveAttribute("data-selected", "true");
    expect(classes(button)).toEqual(expect.arrayContaining(["bg-action", "text-ink-on-action", "border-action", "hover:bg-action-hover"]));
    expect(classes(button)).not.toContain("bg-surface-raised");
  });

  it("selected on the inverse ground takes the inverse action fill", () => {
    render(<ToggleButton ground="inverse" defaultSelected>Bold</ToggleButton>);
    expect(classes(screen.getByRole("button"))).toEqual(expect.arrayContaining(["bg-action-on-inverse", "text-ink-primary"]));
  });

  it("a primary toggle, already action-filled at rest, marks selected with an inset ring in its own ink", () => {
    const { rerender } = render(<ToggleButton variant="primary">Bold</ToggleButton>);
    expect(classes(screen.getByRole("button"))).not.toContain("ring-2");
    rerender(<ToggleButton variant="primary" isSelected>Bold</ToggleButton>);
    expect(classes(screen.getByRole("button"))).toEqual(expect.arrayContaining(["bg-action", "ring-2", "ring-inset", "ring-current"]));
  });

  it("controlled: reports the next state and follows isSelected", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ToggleButton isSelected={false} onChange={onChange}>Bold</ToggleButton>);
    const button = screen.getByRole("button", { name: "Bold" });
    await user.click(button);
    expect(onChange).toHaveBeenCalledWith(true);
    expect(button).toHaveAttribute("aria-pressed", "false");
  });

  it("disabled: does not toggle, carries the disabled attribute and the disabled opacity", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ToggleButton isDisabled onChange={onChange}>Bold</ToggleButton>);
    const button = screen.getByRole("button", { name: "Bold" });
    expect(button).toBeDisabled();
    expect(button.getAttribute("style") ?? "").toContain("opacity");
    await user.click(button);
    expect(onChange).not.toHaveBeenCalled();
    expect(button).toHaveAttribute("aria-pressed", "false");
  });

  it("pending: stays focusable and undimmed, marks data-pending, and does not toggle", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ToggleButton isPending onChange={onChange}>Bold</ToggleButton>);
    const button = screen.getByRole("button", { name: "Bold" });
    expect(button).not.toHaveAttribute("disabled");
    expect(button).toHaveAttribute("data-pending", "true");
    expect(button.getAttribute("style") ?? "").not.toContain("opacity");
    await user.click(button);
    await user.keyboard(" ");
    expect(onChange).not.toHaveBeenCalled();
    expect(button).toHaveAttribute("aria-pressed", "false");
    expect(button).toHaveFocus();
  });

  it("focus-visible: keyboard focus draws the package focus outline, pointer focus does not", async () => {
    const user = userEvent.setup();
    render(<ToggleButton>Bold</ToggleButton>);
    const button = screen.getByRole("button", { name: "Bold" });
    await user.click(button);
    expect(button.style.outline).toBe("");
    await user.keyboard("{Shift>}{Tab}{/Shift}");
    await user.tab();
    expect(button).toHaveFocus();
    expect(button).toHaveAttribute("data-focus-visible", "true");
    expect(button.style.outline).toContain("var(--color-focus-ring)");
  });

  it("variants and sizes give the Button's distinct looks; hover is the Button's hover state", () => {
    const looks = new Set<string>();
    const { rerender } = render(<ToggleButton>X</ToggleButton>);
    for (const variant of ["primary", "secondary", "ghost", "danger", "outline", "tonal", "quiet"] as const) {
      rerender(<ToggleButton variant={variant}>X</ToggleButton>);
      looks.add(screen.getByRole("button").className);
    }
    expect(looks.size).toBe(7);
    rerender(<ToggleButton size="sm">X</ToggleButton>);
    expect(classes(screen.getByRole("button"))).toContain("text-body-s");
    rerender(<ToggleButton size="lg">X</ToggleButton>);
    expect(classes(screen.getByRole("button"))).toContain("text-body-l");
    rerender(<ToggleButton variant="secondary">X</ToggleButton>);
    expect(classes(screen.getByRole("button"))).toContain("hover:bg-surface-sunken");
  });

  it("a selected quiet toggle keeps its underline, never a fill", () => {
    render(<ToggleButton variant="quiet" defaultSelected>More</ToggleButton>);
    const list = classes(screen.getByRole("button"));
    expect(list).toContain("underline");
    expect(list).not.toContain("bg-action");
  });

  it("icon-only: one decorative glyph in the square icon control, named by aria-label, selected on the action fill", () => {
    render(<ToggleButton shape="icon-only" aria-label="Bold" defaultSelected><Icon glyph={Check} decorative /></ToggleButton>);
    const button = screen.getByRole("button", { name: "Bold" });
    const list = classes(button);
    expect(list).toEqual(expect.arrayContaining(["icon-control-md", "rounded-control", "bg-action", "text-ink-on-action"]));
    expect(list.some(name => name.startsWith("aria-pressed:"))).toBe(false);
    expect(button.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });

  it("forwards its ref and the selected-state render props", async () => {
    const user = userEvent.setup(), ref = createRef<HTMLButtonElement>();
    render(<ToggleButton ref={ref} className={({ isSelected }) => isSelected ? "selected" : "rest"}>
      {({ isSelected }) => isSelected ? "Enabled" : "Enable"}
    </ToggleButton>);
    expect(ref.current).toBe(screen.getByRole("button", { name: "Enable" }));
    await user.click(ref.current!);
    expect(ref.current).toHaveClass("selected");
    expect(ref.current).toHaveTextContent("Enabled");
  });
});
