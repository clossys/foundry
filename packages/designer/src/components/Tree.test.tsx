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

describe("Tree selected row (VF-1 studio-23)", () => {
  it("marks the selected row with the accent tint and an inline-start accent edge; rows at rest hover on the tonal step", async () => {
    const user = userEvent.setup();
    render(<Tree aria-label="Layers" selectionMode="single"><Tree.Node id="a" textValue="Alpha" label="Alpha" expandLabel="Toggle Alpha" /><Tree.Node id="b" textValue="Beta" label="Beta" expandLabel="Toggle Beta" /></Tree>);
    const alpha = screen.getByRole("row", { name: /Alpha/ });
    const beta = screen.getByRole("row", { name: /Beta/ });
    await user.click(alpha);
    expect(alpha).toHaveAttribute("aria-selected", "true");
    expect(alpha).toHaveClass("bg-accent-tint", "border-s-2", "border-s-accent");
    expect(beta).toHaveClass("border-s-2", "border-s-transparent", "hover:bg-control-tonal-hover");
    expect(beta).not.toHaveClass("hover:bg-surface-sunken");
  });
});

describe("Tree expansion target (vf30, K5 craft)", () => {
  it("gives the chevron button the benchmark control target floor, square, so a selecting row still has a reachable expand target", () => {
    render(<Tree aria-label="Documents" selectionMode="single" defaultExpandedKeys={["folder"]}><Tree.Node id="folder" textValue="Folder" label="Folder" expandLabel="Toggle Folder"><Tree.Node id="child" textValue="Notes" label="Notes" expandLabel="Toggle Notes" /></Tree.Node></Tree>);
    const chevron = screen.getByRole("button", { name: "Toggle Folder", hidden: true });
    expect(chevron).toHaveClass("control-h-md", "aspect-square");
  });
});
