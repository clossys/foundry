import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SearchField } from "./SearchField.js";

describe("SearchField", () => {
  it("renders a labeled input with the correct type=search semantics", () => {
    render(<SearchField label="Search prompts" />);
    const input = screen.getByRole("searchbox", { name: /Search prompts/ });
    expect(input).toBeInTheDocument();
    expect(input).toHaveAttribute("type", "search");
  });

  it("shows no clear button while empty", () => {
    render(<SearchField label="Search prompts" />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("shows a clear button once there's a value, and pressing it clears the field", async () => {
    const user = userEvent.setup();
    render(<SearchField label="Search prompts" />);
    const input = screen.getByRole("searchbox", { name: /Search prompts/ });
    await user.type(input, "eval");
    expect(input).toHaveValue("eval");
    const clearButton = screen.getByRole("button");
    await user.click(clearButton);
    expect(input).toHaveValue("");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("clears the value on Escape", async () => {
    const user = userEvent.setup();
    render(<SearchField label="Search prompts" />);
    const input = screen.getByRole("searchbox", { name: /Search prompts/ });
    await user.type(input, "eval");
    expect(input).toHaveValue("eval");
    await user.keyboard("{Escape}");
    expect(input).toHaveValue("");
  });

  it("calls onClear when the value is cleared via the clear button", async () => {
    const onClear = vi.fn();
    const user = userEvent.setup();
    render(<SearchField label="Search prompts" onClear={onClear} defaultValue="eval" />);
    const clearButton = screen.getByRole("button");
    await user.click(clearButton);
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it("renders a description and links it to the input via aria-describedby", () => {
    render(<SearchField label="Search prompts" description="Matches title and tags." />);
    const input = screen.getByRole("searchbox", { name: /Search prompts/ });
    const description = screen.getByText("Matches title and tags.");
    expect(input.getAttribute("aria-describedby")).toContain(description.id);
  });

  it("announces a validation error, linked via aria-describedby", () => {
    render(<SearchField label="Search prompts" isInvalid errorMessage="Enter a search term." />);
    const input = screen.getByRole("searchbox", { name: /Search prompts/ });
    const error = screen.getByText("Enter a search term.");
    expect(input.getAttribute("aria-describedby")).toContain(error.id);
  });

  it("forwards className onto the outer field wrapper, and the consumer's conflicting class wins the merge", () => {
    render(<SearchField label="Search prompts" className="gap-lg" />);
    const wrapper = screen.getByText("Search prompts").closest("div") as HTMLElement;
    expect(wrapper.className).toContain("gap-lg");
    expect(wrapper.className).not.toContain("gap-xs");
  });

  it("forwards inputClassName onto the input, and the consumer's conflicting class wins the merge", () => {
    render(<SearchField label="Search prompts" inputClassName="pl-2xl" />);
    const input = screen.getByRole("searchbox", { name: /Search prompts/ });
    expect(input.className).toContain("pl-2xl");
    expect(input.className).not.toContain("pl-md");
  });

  it("disabled: the input is disabled and does not accept typing", async () => {
    const user = userEvent.setup();
    render(<SearchField label="Search prompts" isDisabled />);
    const input = screen.getByRole("searchbox", { name: /Search prompts/ });
    expect(input).toBeDisabled();
    await user.type(input, "eval");
    expect(input).toHaveValue("");
  });
});
