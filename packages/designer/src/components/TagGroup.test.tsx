import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TagGroup } from "./TagGroup.js";
describe("TagGroup candidate", () => {
  it("refuses a removable tag without host-authored removal text", () => {
    expect(() => render(<TagGroup label="Filters" onRemove={() => {}}><TagGroup.List><TagGroup.Item id="one" textValue="Design">Design</TagGroup.Item></TagGroup.List></TagGroup>)).toThrow(/host removeLabel/);
  });
  it.each(["none", "single", "multiple"] as const)("retains peer %s selection and removal keyboard semantics", async selectionMode => {
    const user = userEvent.setup(), selected = vi.fn(), removed = vi.fn();
    render(<TagGroup label="Filters" selectionMode={selectionMode} onSelectionChange={selected} onRemove={removed}><TagGroup.List><TagGroup.Item id="one" textValue="Design" removeLabel="Remove Design">Design</TagGroup.Item><TagGroup.Item id="two" textValue="Code" removeLabel="Remove Code">Code</TagGroup.Item></TagGroup.List></TagGroup>);
    const row = screen.getByRole("row", { name: /Design/ });
    act(() => row.focus()); await user.keyboard(" ");
    expect(selected.mock.calls.length > 0).toBe(selectionMode !== "none");
    await user.keyboard("{Delete}");
    expect([...removed.mock.calls[0]![0]]).toEqual(["one"]);
    expect(screen.getByRole("button", { name: "Remove Design" })).toBeInTheDocument();
  });
  it("moves between tags and prevents removal of a disabled item", async () => {
    const user = userEvent.setup(), removed = vi.fn();
    render(<TagGroup label="Filters" disabledKeys={["two"]} onRemove={removed}><TagGroup.List><TagGroup.Item id="one" textValue="Design" removeLabel="Remove Design">Design</TagGroup.Item><TagGroup.Item id="two" textValue="Code" removeLabel="Remove Code">Code</TagGroup.Item></TagGroup.List></TagGroup>);
    act(() => screen.getByRole("row", { name: /Design/ }).focus()); await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("row", { name: /Code/ })).toHaveAttribute("aria-disabled", "true");
    await user.click(screen.getByRole("button", { name: "Remove Code" }));
    expect(removed).not.toHaveBeenCalled();
  });
});
