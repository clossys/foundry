import { act } from "react";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NavShell } from "./NavShell.js";
import { Shell } from "./Shell.js";
import { SkipLink } from "./SkipLink.js";
import { Toaster, toast } from "./Toaster.js";

describe("shell RTL logical-direction utilities", () => {
  it("keeps both public and Shell skip links above progress with the dedicated skip-link token", () => {
    const { container } = render(
      <>
        <SkipLink targetId="public-content">Skip public navigation</SkipLink>
        <main id="public-content" tabIndex={-1} />
        <Shell skipLinkLabel="Skip shell navigation">
          <Shell.Main>Content</Shell.Main>
        </Shell>
      </>,
    );
    const links = container.querySelectorAll("a");
    expect(links).toHaveLength(2);
    for (const link of links) {
      // The dedicated skip-link layer utility (--ui-z-skip-link), never the tooltip layer.
      expect(link).toHaveClass("layer-skip-link");
      expect(link.className).not.toContain("tooltip");
    }
  });

  it("puts the SideNav divider at inline-end and Rail divider at inline-start", () => {
    render(
      <Shell>
        <Shell.SideNav>Navigation</Shell.SideNav>
        <Shell.Main>Content</Shell.Main>
        <Shell.Rail>Context</Shell.Rail>
      </Shell>,
    );
    const nav = screen.getByRole("navigation");
    const rail = screen.getByRole("complementary");
    expect(nav.className.split(" ")).toContain("hairline-e");
    expect(nav.className.split(" ")).not.toContain("hairline-s");
    expect(rail.className.split(" ")).toContain("hairline-s");
    expect(rail.className.split(" ")).not.toContain("hairline-e");
  });

  it("anchors the drawer at inline-start and places its divider at inline-end", async () => {
    const user = userEvent.setup();
    render(
      <NavShell>
        <a href="/one">One</a>
      </NavShell>,
    );
    await user.click(screen.getByRole("button", { name: "Menu" }));
    const dialog = await screen.findByRole("dialog");
    // The stock Sheet surface owns the side: inline-start anchor and its inline-end divider.
    const surface = dialog.closest<HTMLElement>('[data-slot="sheet-content"]')!;
    expect(surface).toHaveAttribute("data-side", "left");
    expect(surface.className.split(" ")).toEqual(expect.arrayContaining(["data-[side=left]:start-0", "data-[side=left]:border-e-(length:--ui-border-hairline)"]));
  });

  it("anchors toasts at inline-end", async () => {
    const { unmount } = render(<Toaster />);
    act(() => toast.info("A notification"));
    await screen.findByText("A notification");
    // Sonner draws the list (`ol`) inside its labelled region; the inline end is the right in left-to-right.
    const list = screen.getByRole("region", { name: "Notifications" }).querySelector("ol")!;
    expect(list.className).toContain("end-md");
    expect(list).toHaveAttribute("data-x-position", "right");
    act(() => toast.dismissAll());
    unmount();
  });

  it("uses inline-start for both public and Shell skip links", () => {
    const { container } = render(
      <>
        <SkipLink targetId="content">Skip public navigation</SkipLink>
        <main id="content" tabIndex={-1} />
        <Shell>
          <Shell.Main>Content</Shell.Main>
        </Shell>
      </>,
    );
    for (const link of container.querySelectorAll("a")) {
      expect(link.className).toContain("focus:skip-link-inset");
      expect(link.className).not.toContain("focus:left-sm");
    }
  });
});
