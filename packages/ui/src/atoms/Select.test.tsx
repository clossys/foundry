import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Select } from "./Select.js";

const FRUIT_OPTIONS = [
  { id: "apple", label: "Apple" },
  { id: "banana", label: "Banana" },
  { id: "cherry", label: "Cherry", isDisabled: true },
];

describe("Select", () => {
  it("renders a labeled trigger, associated via the real label-association APIs", () => {
    render(<Select label="Favorite fruit" options={FRUIT_OPTIONS} />);
    expect(screen.getByRole("button", { name: /Favorite fruit/ })).toBeInTheDocument();
  });

  it("shows the placeholder when nothing is selected", () => {
    render(<Select label="Favorite fruit" options={FRUIT_OPTIONS} placeholder="Pick one" />);
    expect(screen.getByRole("button", { name: /Pick one/ })).toBeInTheDocument();
  });

  it("opens on keyboard (ArrowDown) and lists every option", async () => {
    const user = userEvent.setup();
    render(<Select label="Favorite fruit" options={FRUIT_OPTIONS} />);
    const trigger = screen.getByRole("button", { name: /Favorite fruit/ });
    trigger.focus();
    await user.keyboard("{ArrowDown}");
    expect(await screen.findByRole("listbox")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Apple" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Banana" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Cherry" })).toBeInTheDocument();
  });

  it("selects the focused option with Enter, closes the popover, and updates the trigger", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <Select
        label="Favorite fruit"
        options={FRUIT_OPTIONS}
        onChange={onChange}
      />,
    );
    const trigger = screen.getByRole("button", { name: /Favorite fruit/ });
    trigger.focus();
    await user.keyboard("{ArrowDown}");
    await screen.findByRole("listbox");
    await user.keyboard("{Enter}");
    expect(onChange).toHaveBeenCalledWith("apple");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Apple/ })).toBeInTheDocument();
  });

  it("closes on Escape without changing the selection", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <Select
        label="Favorite fruit"
        options={FRUIT_OPTIONS}
        onChange={onChange}
      />,
    );
    const trigger = screen.getByRole("button", { name: /Favorite fruit/ });
    trigger.focus();
    await user.keyboard("{ArrowDown}");
    await screen.findByRole("listbox");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("skips disabled options during keyboard navigation", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <Select
        label="Favorite fruit"
        options={FRUIT_OPTIONS}
        onChange={onChange}
      />,
    );
    const trigger = screen.getByRole("button", { name: /Favorite fruit/ });
    trigger.focus();
    // Opening focuses Apple (the first enabled option).
    await user.keyboard("{ArrowDown}");
    await screen.findByRole("listbox");
    // Apple -> Banana -> (Cherry is disabled and last, so focus does not
    // advance onto it and stays on Banana, the last ENABLED option).
    await user.keyboard("{ArrowDown}{ArrowDown}");
    await user.keyboard("{Enter}");
    expect(onChange).toHaveBeenCalledWith("banana");
  });

  it("renders a description and links it to the trigger via aria-describedby", () => {
    render(
      <Select
        label="Favorite fruit"
        options={FRUIT_OPTIONS}
        description="Pick your favorite."
      />,
    );
    const trigger = screen.getByRole("button", { name: /Favorite fruit/ });
    const description = screen.getByText("Pick your favorite.");
    expect(trigger.getAttribute("aria-describedby")).toContain(description.id);
  });

  it("announces a validation error: renders it and links the trigger to it via aria-describedby", () => {
    render(
      <Select
        label="Favorite fruit"
        options={FRUIT_OPTIONS}
        isInvalid
        errorMessage="Choose a fruit."
      />,
    );
    const trigger = screen.getByRole("button", { name: /Favorite fruit/ });
    const error = screen.getByText("Choose a fruit.");
    expect(trigger.getAttribute("aria-describedby")).toContain(error.id);
  });

  it("forwards className onto the outer field wrapper, and the consumer's conflicting class wins the merge", () => {
    render(<Select label="Favorite fruit" options={FRUIT_OPTIONS} className="gap-lg" />);
    const wrapper = screen.getByText("Favorite fruit").closest("div") as HTMLElement;
    expect(wrapper.className).toContain("gap-lg");
    expect(wrapper.className).not.toContain("gap-xs");
  });

  it("disabled: the trigger is disabled and does not open", async () => {
    const user = userEvent.setup();
    render(<Select label="Favorite fruit" options={FRUIT_OPTIONS} isDisabled />);
    const trigger = screen.getByRole("button", { name: /Favorite fruit/ });
    expect(trigger).toBeDisabled();
    await user.click(trigger);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });
});
