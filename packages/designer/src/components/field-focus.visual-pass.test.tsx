import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { SearchField } from "./SearchField.js";
import { Textarea } from "./preview-runtime/components/text-field/text-field.js";
import { TextField } from "./preview-runtime/components/text-field/text-field.js";

/*
 * Visual pass (VF-1, shell-01): a text entry never shows the browser's own
 * focus outline; SearchField draws one offset token outline for keyboard
 * focus. TextField and Textarea are the stock shadcn@aria input and textarea
 * (R2F-33d1): their focus ring is the stock focus-visible outline.
 */
describe("text entry focus (VF-1 shell-01)", () => {
  it.each([
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
