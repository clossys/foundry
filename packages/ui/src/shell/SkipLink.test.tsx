import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
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
});
