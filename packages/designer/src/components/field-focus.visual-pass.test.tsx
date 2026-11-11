import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { SearchField, SearchInput } from "./intent/search-field.js";
import { Label } from "./intent/field.js";
import { Textarea } from "./preview-runtime/components/text-field/text-field.js";
import { TextField } from "./preview-runtime/components/text-field/text-field.js";

/*
 * Visual pass (VF-1, shell-01): a text entry never shows the browser's own
 * focus outline; SearchField (Intent UI) draws one token ring on focus. TextField and Textarea are the stock shadcn@aria input and textarea
 * (R2F-33d1): their focus ring is the stock focus-visible outline.
 */
describe("text entry focus (VF-1 shell-01)", () => {
  // R2F-51: SearchField is the Intent UI search field: the native outline stays hidden and one token ring
  // (`--color-ring`) draws on focus by class; no inline outline or box-shadow is painted.
  it("SearchField hides the native outline and draws one token focus ring", async () => {
    render(<SearchField><Label>Search</Label><SearchInput /></SearchField>);
    const field = screen.getByRole("searchbox");
    expect(field).toHaveClass("outline-hidden", "focus:ring-3", "focus:ring-ring/20", "focus:border-ring/70");
    await userEvent.tab();
    expect(field).toHaveFocus();
    expect(field).toHaveAttribute("data-focused", "true");
    expect(field.style.outline).toBe("");
    expect(field.style.boxShadow).toBe("");
  });
  it.each([
    ["TextField", () => render(<TextField label="Notes" />)],
    ["Textarea", () => render(<Textarea label="Notes" />)],
  ] as const)("%s takes keyboard focus and draws only the stock focus-visible outline", async (_name, mount) => {
    mount();
    const field = screen.getByRole("textbox", { name: "Notes" });
    expect(field).toHaveClass("focus-visible:outline-solid", "focus-visible:outline-(--color-focus-ring)", "focus-visible:outline-offset-(--ui-focus-offset)");
    await userEvent.tab();
    expect(field).toHaveFocus();
    expect(field.style.boxShadow).toBe("");
    expect(field.style.outline).toBe("");
  });
});
