// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { AuthFrame } from "./AuthFrame.js";

afterEach(cleanup);

describe("AuthFrame", () => {
  it("owns one main and moves skip-link focus to it", () => {
    const { container } = render(<AuthFrame skipLabel="Jump to sign in"><section><h1>Sign in</h1></section></AuthFrame>);
    const main = screen.getByRole("main"), skip = screen.getByRole("link", { name: "Jump to sign in" });
    expect(container.firstElementChild?.firstElementChild).toBe(skip);
    expect(skip).toHaveAttribute("href", `#${main.id}`);
    expect(main).toHaveAttribute("tabindex", "-1");
    fireEvent.click(skip);
    expect(main).toHaveFocus();
    expect(screen.getAllByRole("main")).toHaveLength(1);
    expect(main).toContainElement(screen.getByRole("heading", { name: "Sign in" }));
  });

  it("keeps multiple host sections in one centred, measured column in authored order", () => {
    render(<AuthFrame skipLabel="Skip"><section>First</section><section>Second</section></AuthFrame>);
    const main = screen.getByRole("main");
    expect(main).toHaveClass("mx-auto", "flex", "flex-col", "justify-center", "min-h-dvh", "w-full");
    expect(main.style.maxWidth).toBe("var(--ui-width-form-max, 38rem)");
    expect(Array.from(main.children, child => child.textContent)).toEqual(["First", "Second"]);
  });

  it("server-renders its registered frame provenance around host-owned content", () => {
    const html = renderToStaticMarkup(<AuthFrame skipLabel="Skip"><section>Unavailable</section></AuthFrame>);
    expect(html).toContain('data-ds-leaf="frames.auth-shell"');
    expect(html).toContain('data-ds-fill="foundry/frames.auth-shell"');
    expect(html).toContain('<main id="main-content" tabindex="-1"');
    expect(html).toContain("Unavailable");
  });

  it("requires consumer-authored skip copy", () => {
    expect(() => renderToStaticMarkup(<AuthFrame skipLabel=" "><section /></AuthFrame>)).toThrow(/skipLabel/);
  });
});
