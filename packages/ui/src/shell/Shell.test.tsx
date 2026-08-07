import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Shell } from "./Shell.js";

function FullShell() {
  return (
    <Shell>
      <Shell.Header>Brand</Shell.Header>
      <Shell.SideNav>Nav links</Shell.SideNav>
      <Shell.Main>Page content</Shell.Main>
      <Shell.Rail>Context panel</Shell.Rail>
      <Shell.Footer>Legal</Shell.Footer>
    </Shell>
  );
}

describe("Shell", () => {
  it("renders every slot's content when all five are present", () => {
    render(<FullShell />);
    expect(screen.getByText("Brand")).toBeInTheDocument();
    expect(screen.getByText("Nav links")).toBeInTheDocument();
    expect(screen.getByText("Page content")).toBeInTheDocument();
    expect(screen.getByText("Context panel")).toBeInTheDocument();
    expect(screen.getByText("Legal")).toBeInTheDocument();
  });

  it("uses correct landmark roles for every slot", () => {
    render(<FullShell />);
    expect(screen.getByRole("banner")).toHaveTextContent("Brand");
    expect(screen.getByRole("navigation")).toHaveTextContent("Nav links");
    expect(screen.getByRole("main")).toHaveTextContent("Page content");
    expect(screen.getByRole("complementary")).toHaveTextContent("Context panel");
    expect(screen.getByRole("contentinfo")).toHaveTextContent("Legal");
  });

  it("renders exactly one <main>, even with every other slot present", () => {
    render(<FullShell />);
    expect(screen.getAllByRole("main")).toHaveLength(1);
  });

  it("renders correctly with only the required Main slot — no other landmark exists at all", () => {
    render(
      <Shell>
        <Shell.Main>Only content</Shell.Main>
      </Shell>,
    );
    expect(screen.getByRole("main")).toHaveTextContent("Only content");
    expect(screen.queryByRole("banner")).not.toBeInTheDocument();
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
    expect(screen.queryByRole("contentinfo")).not.toBeInTheDocument();
  });

  it("an absent Rail leaves no trace in the DOM at all — not just visually hidden", () => {
    const { container } = render(
      <Shell>
        <Shell.Header>Brand</Shell.Header>
        <Shell.Main>Content</Shell.Main>
      </Shell>,
    );
    // Proof of "no empty grid track, no phantom spacing": the slot's own
    // element simply isn't rendered, so there is no node left over that
    // could be occupying — or reserving — space for it.
    expect(container.querySelector("aside")).toBeNull();
    expect(container.querySelector("nav")).toBeNull();
    expect(container.querySelector("footer")).toBeNull();
  });

  it("labels the primary navigation by default", () => {
    render(<FullShell />);
    expect(screen.getByRole("navigation", { name: "Primary" })).toBeInTheDocument();
  });

  it("lets a consumer override SideNav's default aria-label", () => {
    render(
      <Shell>
        <Shell.SideNav aria-label="Sections">Nav</Shell.SideNav>
        <Shell.Main>Content</Shell.Main>
      </Shell>,
    );
    expect(screen.getByRole("navigation", { name: "Sections" })).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Primary" })).not.toBeInTheDocument();
  });

  it("forwards className on every slot, merged with its own built-in classes", () => {
    render(
      <Shell className="my-shell">
        <Shell.Header className="my-header">Brand</Shell.Header>
        <Shell.Main className="my-main">Content</Shell.Main>
      </Shell>,
    );
    expect(screen.getByRole("banner").className).toContain("my-header");
    expect(screen.getByRole("main").className).toContain("my-main");
  });

  it("Shell.Main ignores a consumer-supplied id — the skip link depends on the real one", () => {
    render(
      <Shell>
        {/* @ts-expect-error — `id` is deliberately not in ShellMainProps */}
        <Shell.Main id="consumer-chosen-id">Content</Shell.Main>
      </Shell>,
    );
    const main = screen.getByRole("main");
    expect(main.id).not.toBe("consumer-chosen-id");
    expect(main.id).toBeTruthy();
  });

  describe("skip link", () => {
    it("is the first focusable element in the document", async () => {
      const user = userEvent.setup();
      render(<FullShell />);
      await user.tab();
      expect(screen.getByRole("link", { name: "Skip to content" })).toHaveFocus();
    });

    it("moves focus to Shell.Main when activated", async () => {
      const user = userEvent.setup();
      render(<FullShell />);
      await user.tab();
      const skipLink = screen.getByRole("link", { name: "Skip to content" });
      expect(skipLink).toHaveFocus();
      await user.keyboard("{Enter}");
      expect(screen.getByRole("main")).toHaveFocus();
    });

    it("points its href at Shell.Main's real id", () => {
      render(<FullShell />);
      const skipLink = screen.getByRole("link", { name: "Skip to content" });
      const main = screen.getByRole("main");
      expect(skipLink.getAttribute("href")).toBe(`#${main.id}`);
    });
  });
});
