import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RadioGroupContext, Label, Text, FieldError } from "react-aria-components";
import type { ReactNode } from "react";
import { RadioGroup, RadioGroupItem } from "./preview-runtime/components/radio-group/radio-group.js";
import type { RadioGroupProps } from "./RadioGroup.types.js";

function BasicGroup({ description, errorMessage, ...props }: Partial<Omit<RadioGroupProps, "children">> & { description?: ReactNode; errorMessage?: ReactNode } = {}) {
  return (
    <RadioGroup {...props}><Label>Delivery speed</Label>
      {description ? <Text slot="description">{description}</Text> : null}
      <FieldError>{errorMessage}</FieldError>
      <RadioGroupItem value="standard">Standard</RadioGroupItem>
      <RadioGroupItem value="express">Express</RadioGroupItem>
      <RadioGroupItem value="overnight" isDisabled>
        Overnight
      </RadioGroupItem>
    </RadioGroup>
  );
}

describe("RadioGroup", () => {
  it("inherits horizontal orientation from the native provider when the prop is omitted", () => {
    render(<RadioGroupContext.Provider value={{ orientation: "horizontal" }}><BasicGroup /></RadioGroupContext.Provider>);
    expect(screen.getByRole("radiogroup")).toHaveAttribute("aria-orientation", "horizontal");
    expect(screen.getByRole("radiogroup")).toHaveClass("cn-radio-group");
  });

  it("keeps native default vertical semantics and the pinned root classes", () => {
    render(<BasicGroup />);
    const group = screen.getByRole("radiogroup");
    expect(group).toHaveAttribute("aria-orientation", "vertical");
    expect(group).toHaveClass("cn-radio-group", "w-full");
    expect(screen.getByRole("radio", { name: "Standard" }).closest("label")).toHaveClass("cn-radio-group-item");
  });

  it("forwards horizontal and vertical orientation while retaining native keyboard selection", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<BasicGroup orientation="horizontal" defaultValue="standard" />);
    const group = screen.getByRole("radiogroup");
    const standard = screen.getByRole("radio", { name: "Standard" });
    expect(group).toHaveAttribute("aria-orientation", "horizontal");
    expect(group).toHaveClass("cn-radio-group", "w-full");
    standard.focus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("radio", { name: "Express" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Express" })).toHaveFocus();
    rerender(<BasicGroup orientation="vertical" defaultValue="standard" />);
    expect(group).toHaveAttribute("aria-orientation", "vertical");
  });

  it("renders a labeled group with role='radiogroup', containing labeled radio options", () => {
    render(<BasicGroup />);
    const group = screen.getByRole("radiogroup", { name: "Delivery speed" });
    expect(group).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Standard" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Express" })).toBeInTheDocument();
  });

  it("renders a description and links it to the group via aria-describedby", () => {
    render(<BasicGroup description="Choose how fast you need it." />);
    const group = screen.getByRole("radiogroup", { name: "Delivery speed" });
    const description = screen.getByText("Choose how fast you need it.");
    expect(group.getAttribute("aria-describedby")).toContain(description.id);
  });

  it("announces a validation error: renders it, marks the group invalid, and links it via aria-describedby", () => {
    render(<BasicGroup isInvalid errorMessage="Pick a delivery speed." />);
    const group = screen.getByRole("radiogroup", { name: "Delivery speed" });
    const error = screen.getByText("Pick a delivery speed.");
    expect(group).toHaveAttribute("aria-invalid", "true");
    expect(group.getAttribute("aria-describedby")).toContain(error.id);
  });

  it("selects an option on click, and reports it via onChange", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<BasicGroup onChange={onChange} />);
    await user.click(screen.getByRole("radio", { name: "Express" }));
    expect(onChange).toHaveBeenCalledWith("express");
    expect(screen.getByRole("radio", { name: "Express" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Standard" })).not.toBeChecked();
  });

  it("arrow-key navigation moves selection between enabled options", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<BasicGroup onChange={onChange} defaultValue="standard" />);
    screen.getByRole("radio", { name: "Standard" }).focus();
    await user.keyboard("{ArrowDown}");
    expect(onChange).toHaveBeenLastCalledWith("express");
    expect(screen.getByRole("radio", { name: "Express" })).toHaveFocus();
  });

  it("a disabled option is neither selectable nor reachable via arrow keys", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<BasicGroup onChange={onChange} defaultValue="express" />);
    const overnight = screen.getByRole("radio", { name: "Overnight" });
    expect(overnight).toBeDisabled();
    screen.getByRole("radio", { name: "Express" }).focus();
    await user.keyboard("{ArrowDown}");
    // Wraps back to the first enabled option, skipping the disabled last one.
    expect(onChange).not.toHaveBeenCalledWith("overnight");
  });

  it("a controlled value reflects as the checked option", () => {
    const { rerender } = render(<BasicGroup value="standard" onChange={() => {}} />);
    expect(screen.getByRole("radio", { name: "Standard" })).toBeChecked();
    rerender(<BasicGroup value="express" onChange={() => {}} />);
    expect(screen.getByRole("radio", { name: "Express" })).toBeChecked();
  });

  it("renders a per-option description", () => {
    render(
      <RadioGroup><Label>Plan</Label>
        <RadioGroupItem value="free">
          Free <span>No credit card required.</span>
        </RadioGroupItem>
      </RadioGroup>,
    );
    expect(screen.getByText("No credit card required.")).toBeInTheDocument();
  });

  it("forwards className onto the field wrapper, and the consumer's conflicting class wins the merge", () => {
    const { container } = render(<BasicGroup className="gap-lg" />);
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.className).toContain("gap-lg");
    expect(wrapper.className).not.toContain("gap-xs");
  });

  it("C12: the selected ring and dot bind action-color (ink), never the accent", () => {
    render(<BasicGroup value="express" onChange={() => {}} />);
    const label = screen.getByRole("radio", { name: "Express" }).closest("label")!;
    expect(label).toHaveClass("cn-radio-group-item", "cn-radio-group-item-aria");
    expect(label.querySelector(".cn-radio-group-indicator-icon")).not.toBeNull();
    expect(label.innerHTML).not.toMatch(/\b(?:bg|border)-accent\b/);
  });
});
