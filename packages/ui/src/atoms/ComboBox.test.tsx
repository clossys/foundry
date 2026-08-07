import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ComboBox } from "./ComboBox.js";

const FRUIT_OPTIONS = [
  { id: "apple", label: "Apple" },
  { id: "banana", label: "Banana" },
  { id: "cherry", label: "Cherry", isDisabled: true },
  { id: "cranberry", label: "Cranberry" },
];

describe("ComboBox", () => {
  it("renders a labeled text input", () => {
    render(<ComboBox label="Favorite fruit" options={FRUIT_OPTIONS} />);
    expect(screen.getByRole("combobox", { name: /Favorite fruit/ })).toBeInTheDocument();
  });

  it("opens the list on ArrowDown and shows every option", async () => {
    const user = userEvent.setup();
    render(<ComboBox label="Favorite fruit" options={FRUIT_OPTIONS} />);
    const input = screen.getByRole("combobox", { name: /Favorite fruit/ });
    input.focus();
    await user.keyboard("{ArrowDown}");
    expect(await screen.findByRole("listbox")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Apple" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Cranberry" })).toBeInTheDocument();
  });

  it("filters the option list as the user types", async () => {
    const user = userEvent.setup();
    render(<ComboBox label="Favorite fruit" options={FRUIT_OPTIONS} />);
    const input = screen.getByRole("combobox", { name: /Favorite fruit/ });
    await user.click(input);
    await user.type(input, "cran");
    const listbox = await screen.findByRole("listbox");
    expect(within(listbox).getByRole("option", { name: "Cranberry" })).toBeInTheDocument();
    expect(within(listbox).queryByRole("option", { name: "Apple" })).not.toBeInTheDocument();
    expect(within(listbox).queryByRole("option", { name: "Banana" })).not.toBeInTheDocument();
  });

  it("selects a filtered option with the keyboard: ArrowDown then Enter", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<ComboBox label="Favorite fruit" options={FRUIT_OPTIONS} onChange={onChange} />);
    const input = screen.getByRole("combobox", { name: /Favorite fruit/ });
    await user.click(input);
    await user.type(input, "ban");
    await screen.findByRole("listbox");
    await user.keyboard("{ArrowDown}{Enter}");
    expect(onChange).toHaveBeenCalledWith("banana");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(input).toHaveValue("Banana");
  });

  it("skips disabled options during keyboard navigation", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<ComboBox label="Favorite fruit" options={FRUIT_OPTIONS} onChange={onChange} />);
    const input = screen.getByRole("combobox", { name: /Favorite fruit/ });
    await user.click(input);
    await user.type(input, "c");
    await screen.findByRole("listbox");
    // "c" matches Cherry (disabled) and Cranberry; ArrowDown must land on
    // Cranberry, skipping the disabled Cherry entirely.
    await user.keyboard("{ArrowDown}{Enter}");
    expect(onChange).toHaveBeenCalledWith("cranberry");
  });

  it("closes on Escape without changing the selection", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<ComboBox label="Favorite fruit" options={FRUIT_OPTIONS} onChange={onChange} />);
    const input = screen.getByRole("combobox", { name: /Favorite fruit/ });
    await user.click(input);
    await user.type(input, "apple");
    await screen.findByRole("listbox");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("renders a description and links it to the input via aria-describedby", () => {
    render(<ComboBox label="Favorite fruit" options={FRUIT_OPTIONS} description="Pick your favorite." />);
    const input = screen.getByRole("combobox", { name: /Favorite fruit/ });
    const description = screen.getByText("Pick your favorite.");
    expect(input.getAttribute("aria-describedby")).toContain(description.id);
  });

  it("announces a validation error, linked via aria-describedby", () => {
    render(
      <ComboBox label="Favorite fruit" options={FRUIT_OPTIONS} isInvalid errorMessage="Choose a fruit." />,
    );
    const input = screen.getByRole("combobox", { name: /Favorite fruit/ });
    const error = screen.getByText("Choose a fruit.");
    expect(input.getAttribute("aria-describedby")).toContain(error.id);
  });

  it("forwards className onto the outer field wrapper, and the consumer's conflicting class wins the merge", () => {
    render(<ComboBox label="Favorite fruit" options={FRUIT_OPTIONS} className="gap-lg" />);
    const wrapper = screen.getByText("Favorite fruit").closest("div") as HTMLElement;
    expect(wrapper.className).toContain("gap-lg");
    expect(wrapper.className).not.toContain("gap-xs");
  });

  it("disabled: the input is disabled and does not open", async () => {
    const user = userEvent.setup();
    render(<ComboBox label="Favorite fruit" options={FRUIT_OPTIONS} isDisabled />);
    const input = screen.getByRole("combobox", { name: /Favorite fruit/ });
    expect(input).toBeDisabled();
    await user.click(input);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });
});
