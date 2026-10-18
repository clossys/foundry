import { render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SiteHeader } from "./SiteHeader.js";

// Captured from main before adding mobileLayout.
const DEFAULT_HEADERS = {
  "leading": "<header class=\"bg-surface-raised py-sm border-b border-line-base\" style=\"position:relative;z-index:var(--ui-z-shell, 20);border-bottom-width:var(--ui-border-hairline, 1px)\"><div class=\"mx-auto flex w-full flex-wrap items-center justify-between gap-md\" style=\"padding-inline:var(--ui-width-page-padding-x, clamp(16px, 4vw, 48px))\"><div class=\"flex items-center gap-lg\"><a href=\"/\">Example</a><nav aria-label=\"Primary\"><a href=\"/about\">About</a></nav></div><div class=\"flex items-center gap-sm\"><a href=\"/sign-in\">Sign in</a><button type=\"button\">Start</button></div></div></header>",
  "centered": "<header class=\"bg-surface-raised py-sm border-b border-line-base\" style=\"position:relative;z-index:var(--ui-z-shell, 20);border-bottom-width:var(--ui-border-hairline, 1px)\"><div class=\"mx-auto flex w-full flex-wrap items-center gap-md\" style=\"padding-inline:var(--ui-width-page-padding-x, clamp(16px, 4vw, 48px))\"><div class=\"flex flex-1 items-center\"><a href=\"/\">Example</a></div><div class=\"flex items-center\"><nav aria-label=\"Primary\"><a href=\"/about\">About</a></nav></div><div class=\"flex flex-1 items-center justify-end gap-sm\"><a href=\"/sign-in\">Sign in</a><button type=\"button\">Start</button></div></div></header>"
};

function header(navPlacement: "leading" | "centered", mobileLayout?: "inline" | "menu-brand-action") {
  return <SiteHeader navPlacement={navPlacement} mobileLayout={mobileLayout}
    brand={<a href="/">Example</a>}
    nav={<nav aria-label="Primary"><a href="/about">About</a></nav>}
    secondaryAction={<a href="/sign-in">Sign in</a>}
    actions={<button type="button">Start</button>} />;
}

describe("SiteHeader mobile layout", () => {
  it.each(["leading", "centered"] as const)("default output is byte-identical for %s navigation", navPlacement => {
    expect(renderToStaticMarkup(header(navPlacement))).toBe(DEFAULT_HEADERS[navPlacement]);
    expect(renderToStaticMarkup(header(navPlacement, "inline"))).toBe(DEFAULT_HEADERS[navPlacement]);
  });

  it.each(["leading", "centered"] as const)("menu-brand-action puts nav, brand and actions in columns 1, 2 and 3 for %s navigation", navPlacement => {
    render(header(navPlacement, "menu-brand-action"));
    const row = screen.getByRole("banner").firstElementChild!;
    expect(row).toHaveClass("grid", "tablet:flex", "tablet:flex-wrap");
    expect((row as HTMLElement).style.gridTemplateColumns).toBe("auto minmax(0, 1fr) auto");
    expect(screen.getByRole("link", { name: "Example" }).parentElement).toHaveClass("col-start-2", "row-start-1");
    expect(screen.getByRole("navigation").parentElement).toHaveClass("col-start-1", "row-start-1");
    expect(screen.getByRole("button", { name: "Start" }).parentElement).toHaveClass("col-start-3", "row-start-1");
  });

  it.each(["leading", "centered"] as const)("restores the %s navPlacement layout from tablet up", navPlacement => {
    render(header(navPlacement, "menu-brand-action"));
    const brand = screen.getByRole("link", { name: "Example" }).parentElement!;
    const nav = screen.getByRole("navigation").parentElement!;
    const actions = screen.getByRole("button", { name: "Start" }).parentElement!;
    if (navPlacement === "leading") {
      expect(brand).toHaveClass("tablet:contents");
      expect(nav).toHaveClass("tablet:contents");
      expect(brand.parentElement).toBe(nav.parentElement);
      expect(brand.parentElement).toHaveClass("contents", "tablet:flex", "tablet:items-center", "tablet:gap-lg");
      expect(screen.getByRole("banner").firstElementChild).toHaveClass("tablet:justify-between");
    } else {
      expect(brand).toHaveClass("tablet:flex", "tablet:flex-1", "tablet:items-center");
      expect(nav).toHaveClass("tablet:flex", "tablet:items-center");
      expect(actions).toHaveClass("tablet:flex-1", "tablet:justify-end");
    }
  });

  it.each(["leading", "centered"] as const)("keeps brand, nav and actions in DOM order and a shrinkable brand track for %s navigation", navPlacement => {
    render(header(navPlacement, "menu-brand-action"));
    const brand = screen.getByRole("link", { name: "Example" });
    const nav = screen.getByRole("navigation");
    const actions = screen.getByRole("button", { name: "Start" });
    expect(brand.compareDocumentPosition(nav) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(nav.compareDocumentPosition(actions) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(brand.parentElement).toHaveClass("min-w-0", "justify-self-center");
    expect((screen.getByRole("banner").firstElementChild as HTMLElement).style.gridTemplateColumns).toBe("auto minmax(0, 1fr) auto");
    expect(screen.getAllByRole("navigation")).toHaveLength(1);
    expect(screen.getAllByRole("banner")).toHaveLength(1);
  });

  it.each(["leading", "centered"] as const)("allows omitted optional slots with %s navigation", navPlacement => {
    render(<SiteHeader mobileLayout="menu-brand-action" navPlacement={navPlacement} brand={<a href="/">Example</a>} />);
    expect(screen.getByRole("link", { name: "Example" }).parentElement).toHaveClass("col-start-2");
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
