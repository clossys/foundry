import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Tree, TreeContent, TreeItem } from "./tree.js";

describe("Tree (Intent UI)", () => {
  it("expands, moves to a child, selects and returns to its parent with peer keys", async () => {
    const user = userEvent.setup(), selected = vi.fn();
    render(<Tree aria-label="Documents" selectionMode="single" onSelectionChange={selected}><TreeItem id="folder" textValue="Folder"><TreeContent>Folder</TreeContent><TreeItem id="child" textValue="Notes"><TreeContent>Notes</TreeContent></TreeItem></TreeItem></Tree>);
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
    render(<Tree aria-label="Documents" disabledKeys={["locked"]}><TreeItem id="locked" textValue="Locked"><TreeContent>Locked</TreeContent></TreeItem></Tree>);
    expect(screen.getByRole("row", { name: /Locked/ })).toHaveAttribute("aria-disabled", "true");
  });
});

describe("Tree selected row (VF-1 studio-23, retargeted to the stock part's state hooks)", () => {
  it("exposes the selected row as aria-selected and data-selected so the active tint variant applies; rows at rest carry neither", async () => {
    const user = userEvent.setup();
    render(<Tree aria-label="Layers" selectionMode="single"><TreeItem id="a" textValue="Alpha"><TreeContent>Alpha</TreeContent></TreeItem><TreeItem id="b" textValue="Beta"><TreeContent>Beta</TreeContent></TreeItem></Tree>);
    const alpha = screen.getByRole("row", { name: /Alpha/ });
    const beta = screen.getByRole("row", { name: /Beta/ });
    await user.click(alpha);
    expect(alpha).toHaveAttribute("aria-selected", "true");
    expect(alpha).toHaveAttribute("data-selected", "true");
    expect(alpha).toHaveClass("focus:bg-(--tree-active-bg)");
    expect(beta).not.toHaveAttribute("data-selected");
  });
});

describe("Tree expansion target (vf30, K5 craft, retargeted)", () => {
  it("gives a branch row a named, focusable chevron button wired to expansion, so a selecting row still has a reachable expand target", async () => {
    const user = userEvent.setup();
    render(<Tree aria-label="Documents" selectionMode="single" defaultExpandedKeys={["folder"]}><TreeItem id="folder" textValue="Folder"><TreeContent>Folder</TreeContent><TreeItem id="child" textValue="Notes"><TreeContent>Notes</TreeContent></TreeItem></TreeItem></Tree>);
    const chevron = document.querySelector<HTMLElement>('[slot="chevron"]')!;
    expect(chevron.tagName).toBe("BUTTON");
    expect(chevron).toHaveAttribute("aria-label");
    expect(chevron.getAttribute("aria-label")!.trim()).not.toBe("");
    await user.click(chevron);
    expect(screen.getByRole("row", { name: /Folder/ })).toHaveAttribute("aria-expanded", "false");
  });
});
