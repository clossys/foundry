import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Description, FieldError, Label } from "./field.js";
import { SearchField, SearchInput } from "./search-field.js";

function Search(props: React.ComponentProps<typeof SearchField> & { description?: string; error?: string }) {
  const { description, error, ...rest } = props;
  return (
    <SearchField {...rest}>
      <Label>Search prompts</Label>
      <SearchInput placeholder="Find" />
      {description ? <Description>{description}</Description> : null}
      {error ? <FieldError>{error}</FieldError> : null}
    </SearchField>
  );
}

describe("SearchField (Intent search-field)", () => {
  it("is named by its visible label only, never a doubled default name", () => {
    render(<Search />);
    expect(screen.getByRole("searchbox", { name: "Search prompts" })).toBeInTheDocument();
  });

  it("renders a labeled input with type=search semantics", () => {
    render(<Search />);
    expect(screen.getByRole("searchbox", { name: "Search prompts" })).toHaveAttribute("type", "search");
  });

  it("keeps the clear button out of the tab order and hidden while empty", () => {
    const { container } = render(<Search />);
    const field = container.querySelector('[data-slot="control"].group\\/search-field') as HTMLElement;
    expect(field).toHaveAttribute("data-empty", "true");
    const clear = screen.getByRole("button", { hidden: true });
    expect(clear).toHaveAttribute("tabindex", "-1");
    expect(clear.className).toContain("group-empty/search-field:invisible");
  });

  it("pressing the named clear button clears the field and the field reports empty again", async () => {
    const user = userEvent.setup();
    const { container } = render(<Search />);
    const input = screen.getByRole("searchbox", { name: "Search prompts" });
    await user.type(input, "eval");
    expect(input).toHaveValue("eval");
    const clear = screen.getByRole("button", { name: /clear/i });
    await user.click(clear);
    expect(input).toHaveValue("");
    expect(container.querySelector(".group\\/search-field")).toHaveAttribute("data-empty", "true");
  });

  it("clears the value on Escape", async () => {
    const user = userEvent.setup();
    render(<Search />);
    const input = screen.getByRole("searchbox", { name: "Search prompts" });
    await user.type(input, "eval");
    await user.keyboard("{Escape}");
    expect(input).toHaveValue("");
  });

  it("calls onClear when the value is cleared via the clear button", async () => {
    const onClear = vi.fn();
    const user = userEvent.setup();
    render(<Search onClear={onClear} defaultValue="eval" />);
    await user.click(screen.getByRole("button", { name: /clear/i }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it("links a description to the input via aria-describedby", () => {
    render(<Search description="Matches title and tags." />);
    const input = screen.getByRole("searchbox", { name: "Search prompts" });
    expect(input.getAttribute("aria-describedby")).toContain(screen.getByText("Matches title and tags.").id);
  });

  it("announces a validation error, linked via aria-describedby", () => {
    render(<Search isInvalid error="Enter a search term." />);
    const input = screen.getByRole("searchbox", { name: "Search prompts" });
    expect(input.getAttribute("aria-describedby")).toContain(screen.getByText("Enter a search term.").id);
  });

  it("forwards className onto the outer field and the consumer's conflicting class wins", () => {
    const { container } = render(<Search className="gap-lg" />);
    const field = container.querySelector(".group\\/search-field") as HTMLElement;
    expect(field.className).toContain("gap-lg");
  });

  it("disabled: the input is disabled and does not accept typing", async () => {
    const user = userEvent.setup();
    render(<Search isDisabled />);
    const input = screen.getByRole("searchbox", { name: "Search prompts" });
    expect(input).toBeDisabled();
    await user.type(input, "eval");
    expect(input).toHaveValue("");
  });

  it("decorative search icon is hidden from assistive tech and positioned by the input group", () => {
    const { container } = render(<Search />);
    const icon = container.querySelector('svg[data-slot="icon"]') as SVGElement;
    expect(icon).toHaveAttribute("aria-hidden", "true");
  });
});
