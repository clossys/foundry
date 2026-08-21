import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RadioGroup, type RadioGroupProps } from "./RadioGroup.js";

function BasicGroup(props: Partial<Omit<RadioGroupProps, "label" | "children">> = {}) {
  return (
    <RadioGroup label="Delivery speed" {...props}>
      <RadioGroup.Radio value="standard">Standard</RadioGroup.Radio>
      <RadioGroup.Radio value="express">Express</RadioGroup.Radio>
      <RadioGroup.Radio value="overnight" isDisabled>
        Overnight
      </RadioGroup.Radio>
    </RadioGroup>
  );
}

describe("RadioGroup", () => {
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
      <RadioGroup label="Plan">
        <RadioGroup.Radio value="free" description="No credit card required.">
          Free
        </RadioGroup.Radio>
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
});
