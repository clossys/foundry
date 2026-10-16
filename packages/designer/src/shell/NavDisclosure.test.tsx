import { fireEvent, render, screen, within } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { NavDisclosure } from "./NavDisclosure.js";
import { SiteHeader } from "./SiteHeader.js";

function renderNav() {
  return render(
    <SiteHeader brand={<a href="/">Example</a>} nav={
      <NavDisclosure><a href="#about">About</a><a href="#contact"><span>Contact</span></a></NavDisclosure>
    } />,
  );
}

describe("NavDisclosure", () => {
  it("one nav landmark holds the toggle and each link once, in order", () => {
    renderNav();
    expect(screen.getAllByRole("navigation")).toHaveLength(1);
    const nav = screen.getByRole("navigation", { name: "Primary" });
    const toggle = within(nav).getByRole("button", { name: "Menu" });
    const links = within(nav).getAllByRole("link");
    expect(links.map(link => link.textContent)).toEqual(["About", "Contact"]);
    expect(nav.children).toHaveLength(2);
    expect(nav.firstElementChild).toBe(toggle);
    expect(nav.lastElementChild?.tagName).toBe("DIV");
    expect(toggle.compareDocumentPosition(links[0]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("the toggle is a named button with aria-expanded and aria-controls", () => {
    renderNav();
    const toggle = screen.getByRole("button", { name: "Menu" });
    const panel = document.getElementById(toggle.getAttribute("aria-controls")!);
    expect(toggle).toHaveAttribute("type", "button");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(panel).toBe(screen.getByRole("link", { name: "About" }).parentElement);
    expect(panel).not.toHaveAttribute("data-expanded");
    expect(toggle.style.minHeight).toBe("var(--ui-layout-tap-target, 44px)");
    expect(toggle.style.minWidth).toBe("var(--ui-layout-tap-target, 44px)");
    expect(toggle.className).toContain("nav-disclosure-toggle");
    expect(toggle.className).not.toMatch(/transition|duration|delay|animate/);
    toggle.focus();
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(panel).toHaveAttribute("data-expanded");
    expect(toggle).toHaveFocus();
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(panel).not.toHaveAttribute("data-expanded");
  });

  it("Escape while expanded collapses and returns focus to the toggle", () => {
    renderNav();
    const toggle = screen.getByRole("button", { name: "Menu" });
    fireEvent.click(toggle);
    const link = screen.getByRole("link", { name: "About" });
    link.focus();
    fireEvent.keyDown(link, { key: "Escape" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(link.parentElement).not.toHaveAttribute("data-expanded");
    expect(toggle).toHaveFocus();
  });

  it("activating a link in the panel collapses it, including a nested click target", () => {
    renderNav();
    const toggle = screen.getByRole("button", { name: "Menu" });
    fireEvent.click(toggle);
    fireEvent.click(screen.getByText("Contact"));
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("link", { name: "Contact" }).parentElement).not.toHaveAttribute("data-expanded");
  });

  it("accepts landmark and trigger names and className, with instance-local controls", () => {
    render(<><NavDisclosure aria-label="Sections" triggerLabel="Sections menu" className="custom"><a href="#one">One</a></NavDisclosure><NavDisclosure><a href="#two">Two</a></NavDisclosure></>);
    expect(screen.getByRole("navigation", { name: "Sections" })).toHaveClass("custom");
    const first = screen.getByRole("button", { name: "Sections menu" }).getAttribute("aria-controls");
    const second = screen.getByRole("button", { name: "Menu" }).getAttribute("aria-controls");
    expect(first).toBeTruthy();
    expect(second).not.toBe(first);
  });

  it("server renders collapsed with the links present once for the no-JS fallback", () => {
    const html = renderToStaticMarkup(<NavDisclosure><a href="#about">About</a></NavDisclosure>);
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain("data-expanded");
    expect(html).not.toContain("hidden=");
    expect(html.match(/href="#about"/g)).toHaveLength(1);
  });

  it("exports through the client root and shell barrels, outside the server barrel", async () => {
    const shell = await import("./index.js");
    const root = await import("../index.js");
    const server = await import("./server.js");
    expect(shell.NavDisclosure).toBe(NavDisclosure);
    expect(root.NavDisclosure).toBe(NavDisclosure);
    expect(server).not.toHaveProperty("NavDisclosure");
  });
});
