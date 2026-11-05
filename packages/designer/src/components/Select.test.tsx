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

  it("uses the documented default placeholder when placeholder is omitted", () => {
    render(<Select label="Favorite fruit" options={FRUIT_OPTIONS} />);
    expect(screen.getByRole("button", { name: /Select an option/ })).toBeInTheDocument();
  });

  it.each([
    ["sm", "control-h-sm px-sm text-body-s"],
    ["md", "control-h-md px-md text-body"],
    ["lg", "control-h-lg px-lg text-body-l"],
  ] as const)("size=%s sets the trigger's padding and type step", (size, classes) => {
    render(<Select label="Favorite fruit" options={FRUIT_OPTIONS} size={size} />);
    const trigger = screen.getByRole("button", { name: /Favorite fruit/ });
    const own = classes.split(" ");
    expect(trigger).toHaveClass(...own);
    for (const cls of ["px-sm", "py-xs", "text-body-s", "control-h-md", "px-md", "text-body", "px-lg", "py-md", "text-body-l"]) {
      if (!own.includes(cls)) expect(trigger).not.toHaveClass(cls);
    }
    expect(trigger).not.toHaveAttribute("size");
  });

  it("defaults to md, the long-standing trigger look", () => {
    render(<Select label="Favorite fruit" options={FRUIT_OPTIONS} />);
    expect(screen.getByRole("button", { name: /Favorite fruit/ })).toHaveClass("control-h-md", "px-md", "text-body");
  });

  it("keeps keyboard selection and the invalid border at every size", async () => {
    const user = userEvent.setup();
    const onSelectionChange = vi.fn();
    render(<Select label="Favorite fruit" options={FRUIT_OPTIONS} size="sm" isInvalid errorMessage="Pick a fruit" onSelectionChange={onSelectionChange} />);
    const trigger = screen.getByRole("button", { name: /Favorite fruit/ });
    expect(trigger).toHaveClass("border-status-danger", "px-sm");
    trigger.focus();
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    await user.keyboard("{Enter}");
    expect(onSelectionChange).toHaveBeenCalledWith("apple");
  });

  it("lets triggerClassName override the size padding", () => {
    render(<Select label="Favorite fruit" options={FRUIT_OPTIONS} size="lg" triggerClassName="px-sm" />);
    const trigger = screen.getByRole("button", { name: /Favorite fruit/ });
    expect(trigger).toHaveClass("control-h-lg", "px-sm", "text-body-l");
    expect(trigger).not.toHaveClass("px-lg");
  });

  it("disabled: the trigger is disabled and does not open", async () => {
    const user = userEvent.setup();
    render(<Select label="Favorite fruit" options={FRUIT_OPTIONS} isDisabled />);
    const trigger = screen.getByRole("button", { name: /Favorite fruit/ });
    expect(trigger).toBeDisabled();
    await user.click(trigger);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });
  it("takes its accessible name from aria-label when no visible label is rendered", () => {
    const { container } = render(<Select label={null} aria-label="Theme" options={FRUIT_OPTIONS} />);
    expect(screen.getByRole("button", { name: /Theme/ })).toBeInTheDocument();
    const visibleLabels = [...container.querySelectorAll("label")].filter(label => !label.closest('[data-testid="hidden-select-container"]'));
    expect(visibleLabels).toEqual([]);
  });

  it("takes its accessible name from aria-labelledby when no visible label is rendered", () => {
    render(<><span id="external-name">Workspace</span><Select label={null} aria-labelledby="external-name" options={FRUIT_OPTIONS} /></>);
    expect(screen.getByRole("button", { name: /Workspace/ })).toBeInTheDocument();
  });

  it("refuses a select with no label, aria-label or aria-labelledby", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Select label={null} options={FRUIT_OPTIONS} />)).toThrow("Select requires a label, aria-label or aria-labelledby.");
    vi.mocked(console.error).mockRestore();
  });

  it("compact width sizes the field to its content instead of filling the row", () => {
    const { container, rerender } = render(<Select label="Fruit" options={FRUIT_OPTIONS} />);
    const field = () => container.querySelector("div[data-rac]");
    expect(field()).not.toHaveClass("w-fit");
    rerender(<Select label="Fruit" width="compact" options={FRUIT_OPTIONS} />);
    expect(field()).toHaveClass("inline-flex", "w-fit", "max-w-full");
    expect(screen.getByRole("button", { name: /Fruit/ })).toBeInTheDocument();
  });
});
