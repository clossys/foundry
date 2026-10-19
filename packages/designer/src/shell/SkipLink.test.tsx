import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SkipLink } from "./SkipLink.js";

function Page() {
  return (
    <>
      <SkipLink targetId="page-content">Skip to content</SkipLink>
      <header>
        <a href="/one">One</a>
        <a href="/two">Two</a>
      </header>
      <main id="page-content" tabIndex={-1}>
        Content
      </main>
    </>
  );
}

describe("SkipLink", () => {
  it("is the first focusable element in the document", async () => {
    const user = userEvent.setup();
    render(<Page />);
    await user.tab();
    expect(screen.getByRole("link", { name: "Skip to content" })).toHaveFocus();
  });

  it("points its href at the given targetId", () => {
    render(<Page />);
    expect(screen.getByRole("link", { name: "Skip to content" })).toHaveAttribute("href", "#page-content");
  });

  it("moves focus to the target element when activated", async () => {
    const user = userEvent.setup();
    render(<Page />);
    await user.tab();
    const link = screen.getByRole("link", { name: "Skip to content" });
    expect(link).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("main")).toHaveFocus();
  });

  it("renders exactly the consumer-supplied label — no built-in copy", () => {
    render(<SkipLink targetId="x">Jump past navigation</SkipLink>);
    expect(screen.getByRole("link", { name: "Jump past navigation" })).toBeInTheDocument();
  });

  describe("hash-routed applications", () => {
    beforeEach(async () => {
      window.location.hash = "#/inbox/42";
        // Let the hashchange from setting the route flush before a test listens.
        await new Promise((resolve) => setTimeout(resolve, 0));
    });
    afterEach(() => {
      window.location.hash = "";
    });

    it("leaves location.hash untouched when activated with a pointer", async () => {
      const user = userEvent.setup();
      const onHashChange = vi.fn();
      window.addEventListener("hashchange", onHashChange);
      render(<Page />);
      await user.click(screen.getByRole("link", { name: "Skip to content" }));
      await Promise.resolve();
      window.removeEventListener("hashchange", onHashChange);
      expect(window.location.hash).toBe("#/inbox/42");
      expect(onHashChange).not.toHaveBeenCalled();
      expect(screen.getByRole("main")).toHaveFocus();
    });

    it("leaves location.hash untouched and moves focus on Enter", async () => {
      const user = userEvent.setup();
      render(<Page />);
      await user.tab();
      await user.keyboard("{Enter}");
      expect(window.location.hash).toBe("#/inbox/42");
      expect(screen.getByRole("main")).toHaveFocus();
    });

    it("leaves location.hash untouched and moves focus on Space", async () => {
      const user = userEvent.setup();
      render(<Page />);
      await user.tab();
      await user.keyboard(" ");
      expect(window.location.hash).toBe("#/inbox/42");
      expect(screen.getByRole("main")).toHaveFocus();
    });

    it("cancels the default navigation when it moves focus", () => {
      render(<Page />);
      const link = screen.getByRole("link", { name: "Skip to content" });
      const notPrevented = fireEvent.click(link);
      expect(notPrevented).toBe(false);
    });

    it("scrolls the target into view by moving focus without preventScroll", async () => {
      const user = userEvent.setup();
      render(<Page />);
      const main = screen.getByRole("main");
      const focus = vi.spyOn(main, "focus");
      await user.click(screen.getByRole("link", { name: "Skip to content" }));
      expect(focus).toHaveBeenCalledTimes(1);
      expect(focus.mock.calls[0]?.[0]?.preventScroll).not.toBe(true);
    });

    it("keeps the default href behavior for modified clicks (open in new tab)", () => {
      render(<Page />);
      const link = screen.getByRole("link", { name: "Skip to content" });
      expect(fireEvent.click(link, { ctrlKey: true })).toBe(true);
      expect(fireEvent.click(link, { metaKey: true })).toBe(true);
      expect(fireEvent.click(link, { shiftKey: true })).toBe(true);
      expect(fireEvent.click(link, { button: 1 })).toBe(true);
    });

    it("falls back to the href when the target is not in the document", () => {
      render(<SkipLink targetId="absent">Skip to content</SkipLink>);
      const link = screen.getByRole("link", { name: "Skip to content" });
      expect(fireEvent.click(link)).toBe(true);
    });
  });
});
