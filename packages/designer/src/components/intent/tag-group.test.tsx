import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { FieldLabel } from "../preview-runtime/components/field/field.js";
import { Tag, TagGroup, TagList } from "./tag-group.js";

const tags = (props: Partial<React.ComponentProps<typeof TagGroup>> = {}, labelled = true) => <TagGroup onRemove={() => {}} {...props}><FieldLabel>Filters</FieldLabel><TagList><Tag id="one" textValue="Design" removeLabel={labelled ? "Remove Design" : undefined}>Design</Tag><Tag id="two" textValue="Code" removeLabel={labelled ? "Remove Code" : undefined}>Code</Tag></TagList></TagGroup>;

describe("TagGroup (Intent UI)", () => {
  it("never renders an unnamed remove button: host removal text wins, React Aria's localized label covers its absence", () => {
    render(tags({}, false));
    for (const tag of ["Design", "Code"]) {
      const row = screen.getByRole("row", { name: new RegExp(tag) });
      const remove = row.querySelector<HTMLElement>('[slot="remove"]')!;
      expect(remove.getAttribute("aria-label")?.trim()).toBeTruthy();
    }
  });
  it.each(["none", "single", "multiple"] as const)("retains peer %s selection and removal keyboard semantics", async selectionMode => {
    const user = userEvent.setup(), selected = vi.fn(), removed = vi.fn();
    render(tags({ selectionMode, onSelectionChange: selected, onRemove: removed }));
    const row = screen.getByRole("row", { name: /Design/ });
    act(() => row.focus()); await user.keyboard(" ");
    expect(selected.mock.calls.length > 0).toBe(selectionMode !== "none");
    await user.keyboard("{Delete}");
    expect([...removed.mock.calls[0]![0]]).toEqual(["one"]);
    expect(screen.getByRole("button", { name: "Remove Design" })).toBeInTheDocument();
  });
  it("moves between tags and prevents removal of a disabled item", async () => {
    const user = userEvent.setup(), removed = vi.fn();
    render(tags({ disabledKeys: ["two"], onRemove: removed }));
    act(() => screen.getByRole("row", { name: /Design/ }).focus()); await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("row", { name: /Code/ })).toHaveAttribute("aria-disabled", "true");
    await user.click(screen.getByRole("button", { name: "Remove Code" }));
    expect(removed).not.toHaveBeenCalled();
  });
});

describe("TagGroup craft (vf30, K5 craft, retargeted to the stock part's state hooks)", () => {
  it("exposes disabled tags through data-disabled so the stock disabled treatment applies to every tag", () => {
    render(tags({ disabledKeys: ["two"] }));
    expect(screen.getByRole("row", { name: /Code/ })).toHaveAttribute("data-disabled", "true");
    expect(screen.getByRole("row", { name: /Code/ })).toHaveClass("disabled:opacity-50");
  });
  it("keeps the remove button keyboard-reachable with a visible focus state", async () => {
    const user = userEvent.setup();
    render(tags({ disabledKeys: ["two"] }));
    const remove = screen.getByRole("button", { name: "Remove Design" });
    await user.keyboard("{Tab}{Tab}");
    expect(remove).toHaveFocus();
    expect(remove).toHaveAttribute("data-focus-visible", "true");
  });
  it("names the group by its visible field label", () => {
    render(tags());
    expect(screen.getByRole("grid", { name: "Filters" })).toBeInTheDocument();
    expect(screen.getByText("Filters")).toHaveAttribute("data-slot", "field-label");
  });
});
