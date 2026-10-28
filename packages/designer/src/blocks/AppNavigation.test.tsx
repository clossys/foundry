import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { I18nProvider } from "react-aria-components";
import { act } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppNavigation as ShellFixtureAppNavigation } from "./AppNavigation.js";
import { Icon } from "../components/Icon.js";
import { ChevronDown } from "../icons/ChevronDown.js";
import { getAppNavigationCloseStyle } from "./app-navigation-layout.js";
import type { AppNavigationNode } from "./app-navigation-tree.js";
import { withShellCopy } from "../frames/__fixtures__/shell-copy.js";
const AppNavigation = withShellCopy(ShellFixtureAppNavigation);



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
  it("routes real parent and nested links through the host once while preserving native destinations and active state", async () => {
    const navigate = vi.fn().mockResolvedValue(undefined);
    render(<AppNavigation tree={tree} activeId="blocks" onNavigate={navigate} />);
    const nested = screen.getByRole("link", { name: "Blocks" });
    expect(nested).toHaveAttribute("href", "#blocks");
    expect(nested).toHaveAttribute("aria-current", "page");
    await userEvent.click(nested);
    await waitFor(() => expect(navigate).toHaveBeenCalledExactlyOnceWith("#blocks"));
    navigate.mockClear();
    const parent = screen.getByRole("link", { name: "Catalogs" });
    expect(parent).toHaveAttribute("href", "#catalogs");
    await userEvent.click(parent);
    await waitFor(() => expect(navigate).toHaveBeenCalledExactlyOnceWith("#catalogs"));
  });

  it.each([
    [{}, "Open navigation", "Close navigation"],
    [{ openLabel: "Show destinations", closeLabel: "Hide destinations" }, "Show destinations", "Hide destinations"],
    [{ openLabel: "Show destinations", closeLabel: "Hide destinations", expandLabel: "Expand destinations", collapseLabel: "Collapse destinations" }, "Expand destinations", "Collapse destinations"],
  ] as const)("preserves both wide label branches and their host aliases for %j", async (copy, openName, closeName) => {
    render(<AppNavigation tree={tree} defaultCollapsed {...copy} />);
    const opener = screen.getByRole("button", { name: openName });
    expect(opener).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(opener);
    const closer = screen.getByRole("button", { name: closeName });
    expect(closer).toBe(opener);
    expect(closer).toHaveAttribute("aria-expanded", "true");
    await userEvent.click(closer);
    expect(screen.getByRole("button", { name: openName })).toBe(opener);
  });

  it("keeps the technical close position equivalent for measured LTR and RTL corners", () => {
    const rect = { top: 35, left: 755, right: 799 };
    expect(getAppNavigationCloseStyle({ ...rect, rtl: false })).toEqual({ position: "fixed", direction: "ltr", insetBlockStart: 35, insetInlineStart: 755, insetInlineEnd: "auto" });
    expect(getAppNavigationCloseStyle({ ...rect, rtl: true })).toEqual({ position: "fixed", direction: "rtl", insetBlockStart: 35, insetInlineStart: "calc(100% - 799px)", insetInlineEnd: "auto" });
    expect(getAppNavigationCloseStyle(undefined)).toBeUndefined();
  });

  it("remeasures a changed custom trigger while the narrow Drawer remains open", async () => {
    wide = false;
    let left = 35;
    const original = HTMLElement.prototype.getBoundingClientRect;
    const measured = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      return this.getAttribute("aria-label") === "Host corner" ? new DOMRect(left, 27, 44, 44) : original.call(this);
    });
    try {
      const view = render(<I18nProvider locale="en"><div dir="rtl"><AppNavigation tree={tree} drawerOpen trigger={<button aria-label="Host corner" style={{ direction: "rtl" }} />} /></div></I18nProvider>);
      const close = await screen.findByRole("button", { name: "Close navigation", expanded: true });
      await waitFor(() => expect(close).toHaveStyle({ insetBlockStart: "27px", insetInlineStart: "35px", direction: "ltr" }));
      left = 621;
      view.rerender(<I18nProvider locale="ar"><div dir="ltr"><AppNavigation tree={tree} drawerOpen trigger={<button aria-label="Host corner" style={{ direction: "ltr" }} />} /></div></I18nProvider>);
      await waitFor(() => expect(close).toHaveStyle({ insetBlockStart: "27px", insetInlineStart: "calc(100% - 665px)", direction: "rtl" }));
    } finally { measured.mockRestore(); }
  });

  it.each([true, false])("matches the corner tooltip to the host alias when collapsed is %s", async collapsed => {
    render(<AppNavigation tree={tree} collapsed={collapsed} openLabel="Show destinations" closeLabel="Hide destinations" expandLabel="Expand destinations" collapseLabel="Collapse destinations" />);
    const label = collapsed ? "Expand destinations" : "Collapse destinations";
    const trigger = screen.getByRole("button", { name: label });
    fireEvent.mouseMove(document.body);
    await userEvent.hover(trigger);
    expect(await screen.findByRole("tooltip")).toHaveTextContent(label);
  });

  it("uses host copy for panel toggles and both disclosure states", async () => {
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
    expect(link.closest("[role=row]")).toHaveAttribute("data-active-ancestor", "true");
    expect(link.closest("[role=row]")).toHaveAttribute("data-current-ancestor");
    expect(screen.getByRole("treegrid", { name: "Navigation" })).toContainElement(link);
    expect(disclosure).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("link", { name: "Blocks" })).toHaveAttribute("aria-current", "page");
    await userEvent.click(disclosure);
    expect(screen.queryByRole("link", { name: "Blocks" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Catalogs" })).toHaveAttribute("href", "#catalogs");
  });

  it("turns the disclosure chevron on the motion tokens and snaps under reduced motion", async () => {
    render(<AppNavigation tree={tree} activeId="home" />);
    const glyph = (name: string) => screen.getByRole("button", { name }).querySelector("svg")!;
    const MOTION = ["transition-transform", "motion-reduce:transition-none"];
    const closed = glyph("Expand Catalogs");
    expect(closed).toHaveClass(...MOTION);
    // Named classes only: arbitrary-value classes ship no compiled CSS.
    expect([...closed.classList].filter(name => name.includes("("))).toEqual([]);
    expect(closed).not.toHaveClass("rotate-180");
    await userEvent.click(screen.getByRole("button", { name: "Expand Catalogs" }));
    const open = glyph("Collapse Catalogs");
    expect(open).toHaveClass(...MOTION, "rotate-180");
  });

  it("leaves the current destination's group header row without a fill", () => {
    render(<AppNavigation tree={tree} activeId="blocks" />);
    const row = screen.getByRole("button", { name: "Collapse Catalogs" }).parentElement!;
    expect([...row.classList].filter(name => name.startsWith("bg-"))).toEqual([]);
    expect(screen.getByRole("link", { name: "Blocks" })).toHaveClass("bg-surface-selected");
  });

  it("uses the existing named 44px target contracts without caller inline sizing", () => {
    render(<AppNavigation tree={tree} activeId="blocks" />);
    for (const name of ["Home", "Catalogs", "Blocks"]) {
      const control = screen.getByRole("link", { name });
      expect(control).toHaveClass("control-h-md");
      expect(control).not.toHaveAttribute("style");
    }
    const actionControl = screen.getByRole("button", { name: "Actions" });
    expect(actionControl).toHaveClass("control-h-md");
    expect(actionControl).not.toHaveAttribute("style");
    const chevron = screen.getByRole("button", { name: "Collapse Catalogs" });
    expect(chevron).toHaveClass("icon-control-md");
    expect(chevron).not.toHaveAttribute("style");
    const css = readFileSync(resolve(import.meta.dirname, "../../styles/compiled.css"), "utf8");
    expect(css).toMatch(/\.control-h-md \{[\s\S]*?min-block-size: var\(--ui-control-h-md, 32px\)/);
    expect(css).toMatch(/\.icon-control-md \{\s*inline-size: var\(--ui-layout-tap-target, 44px\);\s*block-size: var\(--ui-layout-tap-target, 44px\)/);
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

  it("programmatic parent restoration requirement probe: native parent key follows the focused anchor", async () => {
    render(<AppNavigation tree={tree} activeId="blocks" />);
    const home = screen.getByRole("link", { name: "Home" });
    const catalogs = screen.getByRole("link", { name: "Catalogs" });
    const blocks = screen.getByRole("link", { name: "Blocks" });
    const actionButton = screen.getByRole("button", { name: "Actions" });
    const activate = vi.fn((event: Event) => event.preventDefault());
    home.addEventListener("click", activate);
    act(() => home.focus());
    await userEvent.keyboard("{Enter}");
    expect(activate).toHaveBeenCalledOnce();
    expect(home).toHaveAttribute("href", "#home");
    await userEvent.keyboard("{ArrowDown}");
    expect(catalogs).toHaveFocus();
    await userEvent.keyboard("{ArrowDown}");
    expect(blocks).toHaveFocus();
    await userEvent.keyboard("{ArrowDown}");
    expect(actionButton.closest("[role=row]")).toHaveFocus();
    await userEvent.tab();
    expect(actionButton).toHaveFocus();
    await userEvent.keyboard("{Enter} ");
    expect(action).toHaveBeenCalledTimes(2);
    act(() => blocks.focus());
    expect(blocks).toHaveFocus();
    await userEvent.keyboard("{ArrowLeft}");
    expect(catalogs).toHaveFocus();
    screen.getByRole("button", { name: "Collapse Catalogs" }).focus();
    await userEvent.keyboard(" ");
    expect(screen.getByRole("button", { name: "Expand Catalogs" })).toHaveFocus();
    await userEvent.keyboard("{ArrowUp}");
    expect(home).toHaveFocus();
  });

  it("follows the native Actions to Blocks to parent keyboard path with exact anchor focus", async () => {
    render(<AppNavigation tree={tree} activeId="blocks" />);
    const catalogs = screen.getByRole("link", { name: "Catalogs" });
    const blocks = screen.getByRole("link", { name: "Blocks" });
    const actionButton = screen.getByRole("button", { name: "Actions" });
    const activate = vi.fn((event: Event) => event.preventDefault());
    blocks.addEventListener("click", activate);
    await userEvent.tab();
    expect(screen.getByRole("button", { name: "Close navigation" })).toHaveFocus();
    await userEvent.tab();
    expect(blocks).toHaveFocus();
    expect(blocks).toHaveAttribute("href", "#blocks");
    await userEvent.keyboard("{Enter}");
    expect(activate).toHaveBeenCalledOnce();
    await userEvent.keyboard("{ArrowDown}");
    expect(actionButton.closest("[role=row]")).toHaveFocus();
    await userEvent.tab();
    expect(actionButton).toHaveFocus();
    await userEvent.keyboard("{Enter} ");
    expect(action).toHaveBeenCalledTimes(2);
    await userEvent.keyboard("{ArrowUp}");
    expect(blocks).toHaveFocus();
    await userEvent.keyboard("{ArrowLeft}");
    expect(catalogs).toHaveFocus();
    expect(catalogs).toHaveAttribute("href", "#catalogs");
  });

  it.each(["ltr", "rtl"])("expands and collapses from actual keyboard entry in %s", async dir => {
    document.documentElement.dir = dir;
    render(<I18nProvider locale={dir === "rtl" ? "ar" : "en-US"}><AppNavigation tree={tree} activeId="home" /></I18nProvider>);
    const home = screen.getByRole("link", { name: "Home" });
    const catalogs = screen.getByRole("link", { name: "Catalogs" });
    const activate = vi.fn((event: Event) => event.preventDefault());
    catalogs.addEventListener("click", activate);
    await userEvent.tab();
    expect(screen.getByRole("button", { name: "Close navigation" })).toHaveFocus();
    await userEvent.tab();
    expect(home).toHaveFocus();
    await userEvent.keyboard("{ArrowDown}");
    expect(catalogs).toHaveFocus();
    await userEvent.keyboard(dir === "rtl" ? "{ArrowLeft}" : "{ArrowRight}");
    expect(screen.getByRole("link", { name: "Blocks" })).toHaveAttribute("href", "#blocks");
    expect(catalogs).toHaveFocus();
    await userEvent.keyboard(dir === "rtl" ? "{ArrowRight}" : "{ArrowLeft}");
    expect(screen.queryByRole("link", { name: "Blocks" })).not.toBeInTheDocument();
    expect(catalogs).toHaveFocus();
    expect(catalogs).toHaveAttribute("href", "#catalogs");
    await userEvent.keyboard("{Enter}");
    expect(activate).toHaveBeenCalledOnce();
  });

  it("Home and End requirement probe: real destination anchor focus reaches the first and last row", async () => {
    render(<AppNavigation tree={tree} activeId="blocks" />);
    const home = screen.getByRole("link", { name: "Home" });
    const blocks = screen.getByRole("link", { name: "Blocks" });
    act(() => blocks.focus());
    expect(blocks).toHaveFocus();
    await userEvent.keyboard("{Home}");
    expect.soft(home).toHaveFocus();
    act(() => home.focus());
    expect(home).toHaveFocus();
    await userEvent.keyboard("{End}");
    expect.soft(screen.getByRole("button", { name: "Actions" }).closest("[role=row]")).toHaveFocus();
  });

  it.each(["ltr", "rtl"])("programmatic expansion requirement probe in %s", async dir => {
    document.documentElement.dir = dir;
    render(<I18nProvider locale={dir === "rtl" ? "ar" : "en-US"}><AppNavigation tree={tree} activeId="home" /></I18nProvider>);
    const catalogs = screen.getByRole("link", { name: "Catalogs" });
    const activate = vi.fn((event: Event) => event.preventDefault());
    catalogs.addEventListener("click", activate);
    act(() => catalogs.focus());
    expect(catalogs).toHaveFocus();
    await userEvent.keyboard(dir === "rtl" ? "{ArrowLeft}" : "{ArrowRight}");
    expect(screen.getByRole("link", { name: "Blocks" })).toHaveAttribute("href", "#blocks");
    expect(catalogs).toHaveFocus();
    await userEvent.keyboard(dir === "rtl" ? "{ArrowRight}" : "{ArrowLeft}");
    expect(screen.queryByRole("link", { name: "Blocks" })).not.toBeInTheDocument();
    expect(catalogs).toHaveAttribute("href", "#catalogs");
    expect(catalogs).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    expect(activate).toHaveBeenCalledOnce();
  });

  it("keeps destinations named on reopening and hands collapsed focus to the corner control", async () => {
    const view = render(<AppNavigation tree={tree} activeId="blocks" />);
    screen.getByRole("link", { name: "Blocks" }).focus();
    view.rerender(<AppNavigation tree={tree} activeId="blocks" collapsed />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Open navigation" })).toHaveFocus());
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
    view.rerender(<AppNavigation tree={tree} activeId="blocks" collapsed={false} />);
    for (const name of ["Home", "Catalogs", "Blocks"]) expect(screen.getByRole("link", { name })).toHaveAttribute("href");
    expect(screen.getByRole("button", { name: "Actions" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("link", { name: "Blocks" })).toHaveFocus());
    fireEvent.mouseMove(document.body);
    await userEvent.hover(screen.getByRole("button", { name: "Close navigation" }));
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Close navigation");
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

  it.each(["Escape", "Enter", "blur", "leave", "switch"])("does not resurrect a corner tooltip after %s", async how => {
    const view = render(<AppNavigation tree={tree} collapsed />);
    const trigger = screen.getByRole("button", { name: "Open navigation" });
    if (how === "leave" || how === "switch") { fireEvent.mouseMove(document.body); await userEvent.hover(trigger); }
    else { trigger.focus(); }
    if (how === "Escape" || how === "Enter") await userEvent.keyboard(`{${how}}`);
    if (how === "blur") trigger.blur();
    if (how === "leave") await userEvent.unhover(trigger);
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
      expect(source).not.toMatch(/forced-color-adjust-none|animate-|transition-(?!none|transform\b)/);
    }
  });
});


describe("AppNavigation frame slots", () => {
  it("places the host header before destinations and footer after them with no title or rail", async () => {
    const user = userEvent.setup();
    render(<AppNavigation tree={tree} label="Workspace destinations" header={<button>Find a command</button>} footer={<button>Host account</button>} />);
    const nav = screen.getByRole("navigation", { name: "Workspace destinations" });
    const controls = [...nav.querySelectorAll("button, a")];
    expect(controls[0]).toHaveAccessibleName("Find a command");
    expect(controls.at(-1)).toHaveAccessibleName("Host account");
    expect(within(nav).getByRole("button", { name: "Find a command" })).toBeInTheDocument();
    expect(within(nav).getByRole("button", { name: "Host account" })).toBeInTheDocument();
    expect(screen.queryByText("Workspace destinations")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Close navigation" }));
    expect(screen.queryByRole("navigation", { name: "Workspace destinations" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open navigation" })).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "Open navigation" }));
    expect(screen.getByRole("navigation", { name: "Workspace destinations" })).toBeInTheDocument();
  });
});

describe("AppNavigation visual pass (VF-1 shell-01/02, cross-05)", () => {
  it("marks the current destination with the selected surface and an accent edge, never an outline", () => {
    render(<AppNavigation tree={tree} activeId="blocks" />);
    const current = screen.getByRole("link", { name: "Blocks" });
    expect(current).toHaveClass("bg-surface-selected", "border-s-2", "border-s-accent", "font-medium");
    expect(current).not.toHaveClass("outline-solid", "outline-line-strong", "font-semibold");
    const rest = screen.getByRole("link", { name: "Home" });
    expect(rest).toHaveClass("border-s-2", "border-s-transparent", "hover:bg-control-tonal-hover");
    expect(rest).not.toHaveClass("hover:bg-surface-sunken");
  });

  it("binds destination icons to the small icon step", () => {
    const withIcon: readonly AppNavigationNode[] = [{ id: "home", label: "Home", href: "#home", icon: <Icon glyph={ChevronDown} decorative size="lg" /> }];
    const { container } = render(<AppNavigation tree={withIcon} activeId="home" />);
    const svg = container.querySelector("[data-navigation-node-id=home] svg") as SVGElement;
    expect(svg.style.width).toContain("--ui-icon-sm");
    expect((svg.parentElement as HTMLElement).style.inlineSize).toContain("--ui-icon-sm");
  });
});
