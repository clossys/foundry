import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fireEvent, render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { NavDisclosure } from "./NavDisclosure.js";

describe("NavDisclosure trigger", () => {
  it("renders the default and explicit label triggers as the same collapsed toggle", () => {
    const markup = renderToStaticMarkup(<NavDisclosure triggerLabel="Sections menu"><a href="#about">About</a></NavDisclosure>);
    expect(renderToStaticMarkup(<NavDisclosure trigger="label" triggerLabel="Sections menu"><a href="#about">About</a></NavDisclosure>)).toBe(markup);
    const host = document.createElement("div");
    host.innerHTML = markup;
    const nav = host.querySelector("nav")!;
    expect(nav).toHaveAttribute("aria-label", "Primary");
    const toggle = nav.querySelector("button")!;
    expect(toggle).toHaveAttribute("type", "button");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle.textContent).toBe("Sections menu");
    expect(toggle).not.toHaveAttribute("aria-label");
    // The toggle keeps its tap target and a visible focus outline.
    expect(toggle).toHaveClass("min-size-tap", "nav-disclosure-toggle", "focus-visible:outline-2");
    const panel = host.querySelector(`#${CSS.escape(toggle.getAttribute("aria-controls")!)}`)!;
    expect(panel).toHaveClass("nav-disclosure-panel");
    expect(panel.querySelector("a")).toHaveAttribute("href", "#about");
  });

  it.each([undefined, "label", "icon"] as const)("preserves default and caller labels for trigger %s", trigger => {
    const view = render(<NavDisclosure trigger={trigger}><a href="#about">About</a></NavDisclosure>);
    const toggle = screen.getByRole("button", { name: "Menu" });
    expect(toggle.textContent).toBe(trigger === "icon" ? "" : "Menu");
    if (trigger === "icon") expect(toggle).toHaveAttribute("aria-label", "Menu");
    else expect(toggle).not.toHaveAttribute("aria-label");

    view.rerender(<NavDisclosure trigger={trigger} triggerLabel="Browse sections"><a href="#about">About</a></NavDisclosure>);
    expect(screen.getByRole("button", { name: "Browse sections" })).toBe(toggle);
    expect(toggle.textContent).toBe(trigger === "icon" ? "" : "Browse sections");
    if (trigger === "icon") expect(toggle).toHaveAttribute("aria-label", "Browse sections");
    else expect(toggle).not.toHaveAttribute("aria-label");
  });

  it("preserves the button, controls, expansion and focus when switching trigger modes", () => {
    const view = render(<NavDisclosure trigger="icon" triggerLabel="Browse sections"><a href="#about">About</a></NavDisclosure>);
    const toggle = screen.getByRole("button", { name: "Browse sections" });
    const panel = screen.getByRole("link", { name: "About" }).parentElement!;
    toggle.focus();
    fireEvent.click(toggle);
    const controls = toggle.getAttribute("aria-controls");

    for (const trigger of ["label", "icon"] as const) {
      view.rerender(<NavDisclosure trigger={trigger} triggerLabel="Browse sections"><a href="#about">About</a></NavDisclosure>);
      expect(screen.getByRole("button", { name: "Browse sections" })).toBe(toggle);
      expect(toggle).toHaveAttribute("aria-controls", controls);
      expect(toggle).toHaveAttribute("aria-expanded", "true");
      expect(panel).toHaveAttribute("data-expanded");
      expect(panel.id).toBe(controls);
      expect(toggle).toHaveFocus();
    }
  });

  it("renders two decorative token-coloured bars with triggerLabel as its accessible name", () => {
    render(<NavDisclosure trigger="icon" triggerLabel="Sections menu"><a href="#about">About</a></NavDisclosure>);
    const toggle = screen.getByRole("button", { name: "Sections menu" });
    expect(toggle).toHaveAttribute("aria-label", "Sections menu");
    expect(toggle.textContent).toBe("");
    const icon = toggle.querySelector(".nav-disclosure-icon")!;
    expect(icon).toHaveAttribute("aria-hidden", "true");
    expect(icon.children).toHaveLength(2);
    for (const bar of icon.children) expect(bar.tagName).toBe("SPAN");
    const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "styles", "theme-keys.css"), "utf8");
    const utility = css.slice(css.indexOf("@utility nav-disclosure-icon"), css.indexOf("\n}", css.indexOf("@utility nav-disclosure-icon")) + 2);
    expect(utility).toContain("background-color: currentColor");
    expect(utility).toContain("var(--ui-border-hairline");
    expect(utility).toContain("var(--ui-icon-md");
  });

  it("keeps instance-local aria controls, tap targets, Escape and focus return with an icon", () => {
    render(<NavDisclosure trigger="icon" triggerLabel="Open navigation"><a href="#about">About</a></NavDisclosure>);
    const toggle = screen.getByRole("button", { name: "Open navigation" });
    const link = screen.getByRole("link", { name: "About" });
    const panel = link.parentElement!;
    expect(toggle).toHaveAttribute("aria-controls", panel.id);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    // Both tap-target dimensions come from the Components toggle's min-size-tap utility, not inline style.
    expect(toggle).toHaveClass("min-size-tap");
    expect(toggle.getAttribute("style")).toBeNull();
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(panel).toHaveAttribute("data-expanded");
    link.focus();
    fireEvent.keyDown(link, { key: "Escape" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(panel).not.toHaveAttribute("data-expanded");
    expect(toggle).toHaveFocus();
  });
});
