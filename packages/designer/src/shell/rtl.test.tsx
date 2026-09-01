import { act } from "react";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NavShell } from "./NavShell.js";
import { Shell } from "./Shell.js";
import { SkipLink } from "./SkipLink.js";
import { Toaster, toast } from "./Toaster.js";

describe("shell RTL logical-direction utilities", () => {
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
    expect(nav.className).toContain("border-e");
    expect(nav.style.borderInlineEndWidth).toBeTruthy();
    expect(rail.className).toContain("border-s");
    expect(rail.style.borderInlineStartWidth).toBeTruthy();
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
    expect(dialog.parentElement?.className).toContain("start-0");
    expect(dialog.className).toContain("border-e");
  });

  it("anchors toasts at inline-end", () => {
    const { unmount } = render(<Toaster />);
    act(() => toast.info("A notification"));
    const region = screen.getByRole("region");
    expect(region.className).toContain("end-md");
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
      expect(link.className).toContain("focus:start-sm");
      expect(link.className).not.toContain("focus:left-sm");
    }
  });
});
