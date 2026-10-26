import { createRef } from "react";
import { NavigationTree as PeerNavigationTree, NavigationTreeItem as PeerItem, Link } from "react-aria-components";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { NavigationTree, NavigationTreeItem, NavigationTreeItemContent } from "./NavigationTree.js";

describe("selected NavigationTree primitive", () => {
  it("retains exact peer roots and route identity without substituting Tree", () => {
    expect(NavigationTree).toBe(PeerNavigationTree);
    expect(NavigationTreeItem).toBe(PeerItem);
    const ref=createRef<HTMLDivElement>();
    render(<NavigationTree ref={ref} aria-label="Documents" selectedRoute="/notes" defaultExpandedKeys={["folder"]}>
      <NavigationTreeItem id="folder" textValue="Folder"><NavigationTreeItemContent><Link>Folder</Link></NavigationTreeItemContent>
        <NavigationTreeItem id="notes" textValue="Notes" href="/notes"><NavigationTreeItemContent>{({isCurrent})=><Link className={isCurrent?"current":"other"}>Notes</Link>}</NavigationTreeItemContent></NavigationTreeItem>
      </NavigationTreeItem>
    </NavigationTree>);
    expect(ref.current).toBe(screen.getByRole("treegrid",{name:"Documents"}));
    const notes=screen.getByRole("link",{name:"Notes"});
    expect(notes).toHaveAttribute("href","/notes");
    expect(notes).toHaveAttribute("aria-current","page");
    expect(notes).toHaveClass("current");
  });
  it("expands nested routes, moves by keyboard, and reports the controlled expansion protocol", async () => {
    const user=userEvent.setup(), expanded=vi.fn();
    render(<NavigationTree aria-label="Documents" onExpandedChange={expanded}>
      <NavigationTreeItem id="folder" textValue="Folder"><NavigationTreeItemContent><Link>Folder</Link></NavigationTreeItemContent>
        <NavigationTreeItem id="notes" textValue="Notes" href="/notes"><NavigationTreeItemContent><Link>Notes</Link></NavigationTreeItemContent></NavigationTreeItem>
      </NavigationTreeItem>
    </NavigationTree>);
    const folder=screen.getByRole("row",{name:/Folder/});
    act(()=>folder.focus());
    await user.keyboard("{ArrowRight}");
    expect(folder).toHaveAttribute("aria-expanded","true");
    expect([...expanded.mock.calls.at(-1)![0]]).toEqual(["folder"]);
    await user.keyboard("{ArrowDown}");
    const notes=screen.getByRole("link",{name:"Notes"});
    expect(notes).toHaveFocus();
    await user.keyboard("{ArrowLeft}");
    expect(folder).toHaveFocus();
    await user.keyboard("{ArrowLeft}");
    expect(folder).toHaveAttribute("aria-expanded","false");
  });
});
