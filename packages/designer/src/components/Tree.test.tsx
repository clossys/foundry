import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Tree } from "./Tree.js";
describe("Tree candidate", () => {
  it("expands, moves to a child, selects and returns to its parent with peer keys", async () => {
    const user = userEvent.setup(), selected = vi.fn();
    render(<Tree aria-label="Documents" selectionMode="single" onSelectionChange={selected}><Tree.Node id="folder" textValue="Folder" label="Folder" expandLabel="Toggle Folder"><Tree.Node id="child" textValue="Notes" label="Notes" expandLabel="Toggle Notes" /></Tree.Node></Tree>);
    const folder = screen.getByRole("row", { name: /Folder/ });
    act(() => folder.focus()); await user.keyboard("{ArrowRight}");
    expect(folder).toHaveAttribute("aria-expanded", "true");
    await user.keyboard("{ArrowDown}");
    const child = screen.getByRole("row", { name: /Notes/ }); expect(child).toHaveFocus();
    await user.keyboard(" "); expect([...selected.mock.calls.at(-1)![0]]).toEqual(["child"]);
    await user.keyboard("{ArrowLeft}"); expect(folder).toHaveFocus();
    await user.keyboard("{ArrowLeft}"); expect(folder).toHaveAttribute("aria-expanded", "false");
  });
  it("exposes disabled state and host empty content without inventing selection", () => {
    render(<Tree aria-label="Documents" disabledKeys={["locked"]}><Tree.Node id="locked" textValue="Locked" label="Locked" expandLabel="Toggle Locked" /></Tree>);
    expect(screen.getByRole("row", { name: /Locked/ })).toHaveAttribute("aria-disabled", "true");
  });
});
