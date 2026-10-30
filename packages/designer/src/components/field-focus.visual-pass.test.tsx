import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { SearchField } from "./SearchField.js";
import { Textarea } from "./Textarea.js";
import { TextField } from "./TextField.js";

/*
 * Visual pass (VF-1, shell-01): a text entry never shows the browser's own
 * focus outline; TextField and SearchField draw one offset
 * token outline for keyboard focus. Textarea retains its separate focus contract.
 */
describe("text entry focus (VF-1 shell-01)", () => {
  it.each([
    ["TextField", () => render(<TextField label="Name" />), "textbox"],
    ["SearchField", () => render(<SearchField label="Search" />), "searchbox"],
  ] as const)("%s uses one keyboard outline and no pointer ring", async (_name, mount, role) => {
    mount();
    const field = screen.getByRole(role);
    expect(field).toHaveClass("outline-none");
    await userEvent.click(field);
    expect(field.style.boxShadow).toBe("");
    expect(field.style.outline).toBe("");
    await userEvent.tab();
    await userEvent.tab({ shift: true });
    expect(field).toHaveFocus();
    expect(field.style.outline).toContain("--color-focus-ring");
    expect(field.style.outlineOffset).toContain("--ui-focus-offset");
    expect(field.style.boxShadow).toBe("");
  });
  it("Textarea retains its pointer ring", async () => {
    render(<Textarea label="Notes" />);
    const field = screen.getByRole("textbox");
    expect(field).toHaveClass("outline-hidden");
    await userEvent.click(field);
    expect(field.style.boxShadow).toContain("--ui-ring-focus");
  });
});
