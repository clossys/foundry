import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { SearchField } from "./SearchField.js";
import { Textarea } from "./Textarea.js";
import { TextField } from "./TextField.js";

/*
 * Visual pass (VF-1, shell-01): a text entry never shows the browser's own
 * focus outline; focus by pointer or keyboard draws the package focus ring
 * (the `--ui-ring-focus` box shadow on the accent) instead.
 */
describe("text entry focus (VF-1 shell-01)", () => {
  it.each([
    ["TextField", () => render(<TextField label="Name" />), "textbox"],
    ["Textarea", () => render(<Textarea label="Notes" />), "textbox"],
    ["SearchField", () => render(<SearchField label="Search" />), "searchbox"],
  ] as const)("%s hides the browser outline and rings on pointer focus", async (_name, mount, role) => {
    mount();
    const field = screen.getByRole(role);
    expect(field).toHaveClass("outline-hidden");
    expect(field.style.boxShadow).toBe("");
    await userEvent.click(field);
    expect(field.style.boxShadow).toContain("--ui-ring-focus");
  });
});
