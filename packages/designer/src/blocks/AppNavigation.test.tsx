import { readFileSync } from "node:fs";
import { act } from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppNavigation } from "./AppNavigation.js";
import type { AppNavigationNode } from "./app-navigation-tree.js";

const action = vi.fn();
const tree: readonly AppNavigationNode[] = [
  { id: "home", label: "Home", href: "#home" },
  { id: "catalogs", label: "Catalogs", href: "#catalogs", children: [
    { id: "blocks", label: "Blocks", href: "#blocks" },
    { id: "actions", label: "Actions", onAction: action },
  ] },
];
let wide: boolean;
let listeners: Set<() => void>;
beforeEach(() => {
  wide = true;
  listeners = new Set();
  action.mockClear();
  vi.stubGlobal("matchMedia", vi.fn((media: string) => ({
    media, get matches() { return media === "(min-width: 768px)" && wide; },
    addEventListener: (_: string, fn: () => void) => listeners.add(fn),
    removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
    addListener: () => {}, removeListener: () => {}, dispatchEvent: () => true,
  })));
});
afterEach(() => { document.documentElement.dir = ""; vi.unstubAllGlobals(); });

describe("AppNavigation", () => {
  it("uses host copy for rail toggles and both disclosure states", async () => {
    const formatDisclosureLabel = vi.fn((label: string, expanded: boolean) => (expanded ? "Fermer " : "Ouvrir ") + label);
    const copy = { expandLabel: "Agrandir", collapseLabel: "Reduire", formatDisclosureLabel };
    render(<AppNavigation tree={tree} activeId="blocks" label="Destinations" {...copy} />);
    expect(screen.getByRole("navigation", { name: "Destinations" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Catalogs" })).toHaveAttribute("href", "#catalogs");
    await userEvent.click(screen.getByRole("button", { name: "Fermer Catalogs" }));
    expect(screen.queryByRole("link", { name: "Blocks" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Ouvrir Catalogs" }));
    expect(screen.getByRole("link", { name: "Blocks" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Reduire" }));
    await userEvent.click(screen.getByRole("button", { name: "Agrandir" }));
    expect(formatDisclosureLabel).toHaveBeenCalledWith("Catalogs", true);
    expect(formatDisclosureLabel).toHaveBeenCalledWith("Catalogs", false);
  });

  it("uses host copy for narrow open, close, heading and empty state", async () => {
    wide = false;
    render(<AppNavigation tree={[]} label="Destinations" emptyMessage="Aucune destination" openLabel="Ouvrir" closeLabel="Fermer" />);
    await userEvent.click(screen.getByRole("button", { name: "Ouvrir" }));
    expect(screen.getByRole("dialog", { name: "Destinations" })).toBeInTheDocument();
    expect(screen.getByText("Aucune destination")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Fermer" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("uses descriptive navigation attribute prefixes on the rendered controls and regions", () => {
    const { container } = render(<AppNavigation tree={tree} activeId="blocks" footer="Host profile" />);
    const controls = [...container.querySelectorAll("[data-application-navigation-control]")];
    expect(controls.map(element => element.getAttribute("data-navigation-node-id"))).toEqual(["home", "catalogs", "catalogs", "blocks", "actions"]);
    expect(container.querySelector("[data-application-navigation-region=links]")).toBeInTheDocument();
    expect(container.querySelector("[data-application-navigation-region=footer]")).toHaveTextContent("Host profile");
    for (const element of container.querySelectorAll("*")) {
      expect(element.getAttributeNames().filter(name => /^data-(?:app|node)(?:-|$)/.test(name))).toEqual([]);
    }
  });

  it("separates parent navigation and disclosure with current and ancestor state", async () => {
    render(<AppNavigation tree={tree} activeId="blocks" />);
    const link = screen.getByRole("link", { name: "Catalogs" });
    const disclosure = screen.getByRole("button", { name: "Collapse Catalogs" });
    expect(link).toHaveAttribute("href", "#catalogs");
    expect(link).not.toHaveAttribute("aria-expanded");
    expect(link).not.toHaveAttribute("aria-current");
    expect(link.closest("li")).toHaveAttribute("data-active-ancestor", "true");
    expect(disclosure).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("link", { name: "Blocks" })).toHaveAttribute("aria-current", "page");
    await userEvent.click(disclosure);
    expect(screen.queryByRole("link", { name: "Blocks" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Catalogs" })).toHaveAttribute("href", "#catalogs");
  });

  it("expands a new active ancestor and rejects third-level unsafe trees", () => {
    const view = render(<AppNavigation tree={tree} activeId="home" />);
    expect(screen.queryByRole("link", { name: "Blocks" })).not.toBeInTheDocument();
    view.rerender(<AppNavigation tree={tree} activeId="blocks" />);
    expect(screen.getByRole("link", { name: "Blocks" })).toHaveAttribute("aria-current", "page");
    expect.soft(() => view.rerender(<AppNavigation tree={[{ id: "a", label: "A", children: [
      { id: "b", label: "B", children: [{ id: "c", label: "C", href: "#c" }] },
    ] }] as any} />)).toThrow(/two levels/i);
    expect(screen.queryByRole("link", { name: "C" })).not.toBeInTheDocument();
  });

  it("supports arrows, Home, End, Enter and Space on visible controls", async () => {
    render(<AppNavigation tree={tree} activeId="blocks" />);
    const home = screen.getByRole("link", { name: "Home" });
    home.focus();
    await userEvent.keyboard("{End}");
    expect(screen.getByRole("button", { name: "Actions" })).toHaveFocus();
    await userEvent.keyboard("{Enter} ");
    expect(action).toHaveBeenCalledTimes(2);
    await userEvent.keyboard("{Home}{ArrowDown}");
    expect(screen.getByRole("link", { name: "Catalogs" })).toHaveFocus();
    await userEvent.keyboard("{ArrowDown}");
    expect(screen.getByRole("button", { name: "Collapse Catalogs" })).toHaveFocus();
    await userEvent.keyboard(" ");
    expect(screen.getByRole("button", { name: "Expand Catalogs" })).toHaveFocus();
    await userEvent.keyboard("{ArrowUp}");
    expect(screen.getByRole("link", { name: "Catalogs" })).toHaveFocus();
  });

  it.each(["ltr", "rtl"])("uses logical expansion keys in %s", async dir => {
    document.documentElement.dir = dir;
    render(<AppNavigation tree={tree} activeId="home" />);
    screen.getByRole("button", { name: "Expand Catalogs" }).focus();
    await userEvent.keyboard(dir === "rtl" ? "{ArrowLeft}" : "{ArrowRight}");
    expect(screen.getByRole("link", { name: "Blocks" })).toBeInTheDocument();
    await userEvent.keyboard(dir === "rtl" ? "{ArrowRight}" : "{ArrowLeft}");
    expect(screen.queryByRole("link", { name: "Blocks" })).not.toBeInTheDocument();
  });

  it("keeps every rail destination named and shows real focus tooltips", async () => {
    const view = render(<AppNavigation tree={tree} activeId="blocks" />);
    screen.getByRole("link", { name: "Blocks" }).focus();
    view.rerender(<AppNavigation tree={tree} activeId="blocks" collapsed />);
    await waitFor(() => expect(screen.getByRole("link", { name: "Blocks" })).toHaveFocus());
    for (const name of ["Home", "Catalogs", "Blocks"]) expect(screen.getByRole("link", { name })).toHaveAttribute("href");
    expect(screen.getByRole("button", { name: "Actions" })).toBeInTheDocument();
    await userEvent.tab();
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Actions");
    expect(screen.getByRole("button", { name: "Actions" })).toHaveAccessibleName("Actions");
  });

  it("places the plain footer outside the independently scrolling links", () => {
    const { container } = render(<AppNavigation tree={tree} footer={<button>Profile</button>} />);
    const scroll = container.querySelector('[data-application-navigation-region="links"]')!;
    const footer = container.querySelector('[data-application-navigation-region="footer"]')!;
    expect(scroll).toHaveClass("min-h-0", "overflow-auto");
    expect(footer).toHaveClass("shrink-0");
    expect(scroll).not.toContainElement(footer);
    expect(footer).toContainElement(screen.getByRole("button", { name: "Profile" }));
  });

  it.each(["Escape", "route", "wide"])("closes the real narrow Drawer on %s and releases focus and scroll locks", async reason => {
    wide = false;
    const changed = vi.fn();
    const overflow = document.documentElement.style.overflow;
    const view = render(<AppNavigation tree={tree} activeId="blocks" onDrawerOpenChange={changed} />);
    const trigger = screen.getByRole("button", { name: "Open navigation" });
    await userEvent.click(trigger);
    const dialog = await screen.findByRole("dialog", { name: "Navigation" });
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    expect(document.documentElement.style.overflow).toBe("hidden");
    expect(within(dialog).getByRole("link", { name: "Blocks" })).toHaveAttribute("aria-current", "page");
    if (reason === "Escape") await userEvent.keyboard("{Escape}");
    if (reason === "route") view.rerender(<AppNavigation tree={tree} activeId="home" onDrawerOpenChange={changed} />);
    if (reason === "wide") await act(async () => { wide = true; for (const notify of listeners) notify(); });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(document.documentElement.style.overflow).toBe(overflow);
    expect(document.activeElement?.isConnected).toBe(true);
    expect(dialog).not.toContainElement(document.activeElement as HTMLElement);
    if (reason !== "wide") await waitFor(() => expect(trigger).toHaveFocus());
    else await waitFor(() => expect(screen.getByRole("link", { name: "Blocks" })).toHaveFocus());
    expect(document.activeElement?.closest('[aria-hidden="true"],[hidden],[inert]')).toBeNull();
    expect(changed).toHaveBeenLastCalledWith(false);
  });

  it("keeps destinations stable for an empty tree and omits an absent footer", () => {
    const { container } = render(<AppNavigation tree={[]} emptyMessage="No destinations available" />);
    expect(screen.getByRole("navigation", { name: "Navigation" })).toHaveTextContent("No destinations available");
    expect(container.querySelector('[data-application-navigation-region="footer"]')).toBeNull();
  });

  it.each(["action", "wide"])("dismisses a held controlled Drawer on %s without reviving it", async reason => {
    wide = false;
    const changed = vi.fn();
    render(<AppNavigation tree={tree} activeId="blocks" drawerOpen onDrawerOpenChange={changed} />);
    await screen.findByRole("dialog");
    if (reason === "action") await userEvent.click(screen.getByRole("button", { name: "Actions" }));
    else await act(async () => { wide = true; for (const notify of listeners) notify(); });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    if (reason === "wide") await act(async () => { wide = false; for (const notify of listeners) notify(); });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(changed).toHaveBeenLastCalledWith(false);
    await userEvent.click(screen.getByRole("button", { name: "Open navigation" }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("dismisses a late controlled Drawer request made while wide", async () => {
    const changed = vi.fn();
    const view = render(<AppNavigation tree={tree} drawerOpen={false} onDrawerOpenChange={changed} />);
    view.rerender(<AppNavigation tree={tree} drawerOpen onDrawerOpenChange={changed} />);
    expect.soft(changed).toHaveBeenLastCalledWith(false);
    await act(async () => { wide = false; for (const notify of listeners) notify(); });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: "Open navigation" }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("hands desktop footer focus to the visible narrow trigger", async () => {
    render(<AppNavigation tree={tree} footer={<button>Profile</button>} />);
    screen.getByRole("button", { name: "Profile" }).focus();
    await act(async () => { wide = false; for (const notify of listeners) notify(); });
    await waitFor(() => expect(screen.getByRole("button", { name: "Open navigation" })).toHaveFocus());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it.each(["Escape", "Enter", "blur", "leave", "switch"])("does not resurrect a rail tooltip after %s", async how => {
    const view = render(<AppNavigation tree={tree} collapsed />);
    const home = screen.getByRole("link", { name: "Home" });
    if (how === "leave" || how === "switch") await userEvent.hover(home);
    else { screen.getByRole("button", { name: "Expand navigation" }).focus(); await userEvent.keyboard("{Tab}"); }
    if (how === "Escape" || how === "Enter") await userEvent.keyboard(`{${how}}`);
    if (how === "blur") screen.getByRole("button", { name: "Expand navigation" }).focus();
    if (how === "leave") await userEvent.unhover(home);
    if (how === "switch") view.rerender(<AppNavigation tree={tree} collapsed={false} />);
    await act(async () => { await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); });
    await waitFor(() => expect(screen.queryByRole("tooltip")).not.toBeInTheDocument());
  });

  it("has no router, storage, fetching, private account or sibling layer imports", () => {
    for (const file of ["AppNavigation.tsx", "app-navigation-tree.ts"]) {
      const source = readFileSync(new URL(file, import.meta.url), "utf8");
      expect(source).not.toMatch(/(?:from|import\s*)\s*["'][^"']*(?:router|storage|theme|shell|AccountMenu|publisher)/i);
      expect(source).not.toMatch(/\b(?:localStorage|sessionStorage|fetch|XMLHttpRequest)\b/);
      expect(source).not.toMatch(/#[\da-f]{3,8}\b|\b(?:rgb|oklch)\(/i);
      expect(source).not.toMatch(/forced-color-adjust-none|animate-|transition-(?!none)/);
    }
  });
});
