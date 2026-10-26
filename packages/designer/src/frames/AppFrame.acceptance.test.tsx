// @vitest-environment jsdom
import React, { useEffect, useState } from "react";
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Button, Dialog } from "../components/index.js";
import { Panel } from "../blocks/index.js";
import { ThemeToggle, useTheme } from "../theme/index.js";
import { AppFrame } from "./AppFrame.js";
import type { AppFrameProps } from "./app-frame-types.js";

let viewport: number;
let listeners: Set<() => void>;
beforeEach(() => {
  viewport = 1280;
  Object.defineProperty(window, "innerWidth", { configurable: true, get: () => viewport });
  listeners = new Set();
  localStorage.clear();
  // The literal root command has no package JSX configuration.
  vi.stubGlobal("React", React);
  vi.stubGlobal("matchMedia", vi.fn((media: string) => ({
    media, get matches() {
      if (media === "all") return true;
      const match = media.match(/^\(min-width: ([\d.]+)(px|rem)\)$/);
      return match ? viewport >= Number(match[1]) * (match[2] === "rem" ? 16 : 1) : false;
    },
    addEventListener: (_: string, listener: () => void) => { listeners.add(listener); },
    removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
    addListener: () => {}, removeListener: () => {},
  })));
});
afterEach(() => {
  cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals();
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.style.removeProperty("color-scheme");
  window.history.replaceState(null, "", "/");
});
function resize(matches: boolean) { act(() => { viewport = matches ? 1280 : 375; for (const listener of listeners) listener(); }); }
function fixture(): AppFrameProps {
  return {
    brand: { markSrc: "/mark.svg", wordmark: "Atlas", label: "Atlas workspace" },
    navigation: { label: "Workspace navigation", activeId: "tasks", tree: [
      { id: "home", label: "Home", href: "#home" },
      { id: "projects", label: "Projects", href: "#projects", children: [{ id: "tasks", label: "Tasks", href: "#tasks" }] },
    ] },
    account: { actor: { name: "Example member" }, signedOutLabel: "Signed out", sections: [{ id: "account", entries: [
      { kind: "link", id: "profile", label: "Profile", href: "#profile" },
    ] }] },
    commands: { triggerLabel: "Find a command", heading: "Commands", searchLabel: "Search commands", closeLabel: "Close commands", emptyMessage: "No commands", groups: [
      { id: "destinations", label: "Destinations", items: [
        { id: "home", label: "Open home", href: "#home" },
        { id: "projects", label: "Open projects", href: "#projects" },
        { id: "tasks", label: "Open tasks", href: "#tasks" },
      ] },
    ] },
    children: <><h1>Workspace</h1><button>Host action</button></>,
  };
}
function ThemeBlock({ mounted }: { mounted: () => void }) {
  const { resolvedTheme } = useTheme();
  const [count, setCount] = useState(0);
  useEffect(mounted, [mounted]);
  return <Panel role="region" aria-label="Themed block"><output aria-label="Resolved theme">{resolvedTheme}</output><button onClick={() => setCount(count + 1)}>Retained count {count}</button></Panel>;
}
function AccountHost({ destroy }: { destroy: () => void }) {
  const [confirm, setConfirm] = useState(false);
  const props = fixture();
  props.account.sections = [{ id: "account", entries: [
    { kind: "link", id: "profile", label: "Profile", href: "#profile" },
    { kind: "destructive", id: "delete", label: "Delete workspace", onAction: () => setConfirm(true) },
  ] }];
  return <AppFrame {...props}><Dialog trigger={null} isOpen={confirm} onOpenChange={setConfirm}>
    {({ close }) => <><Dialog.Heading>Confirm workspace deletion</Dialog.Heading><Button onPress={close}>Cancel deletion</Button><Button onPress={() => { destroy(); close(); }}>Confirm deletion</Button></>}
  </Dialog></AppFrame>;
}

describe("AppFrame acceptance", () => {
  it("navigation: drives two levels by pointer and Arrow/Home/End/Enter with current state and collapse focus", async () => {
    const user = userEvent.setup(); render(<AppFrame {...fixture()} />);
    expect(screen.getByRole("link", { name: "Tasks" })).toHaveAttribute("aria-current", "page");
    const disclosure = screen.getByRole("button", { name: "Collapse Projects" });
    await user.click(disclosure);
    expect(screen.queryByRole("link", { name: "Tasks" })).not.toBeInTheDocument();
    expect(disclosure).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("link", { name: "Tasks" })).toBeInTheDocument();
    await user.keyboard("{Home}{ArrowDown}");
    expect(screen.getByRole("link", { name: "Projects" })).toHaveFocus();
    await user.keyboard("{End}");
    expect(screen.getByRole("link", { name: "Tasks" })).toHaveFocus();
    await user.keyboard("{ArrowUp}{Enter}");
    expect(disclosure).toHaveFocus();
    expect(screen.queryByRole("link", { name: "Tasks" })).not.toBeInTheDocument();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("link", { name: "Tasks" })).toBeInTheDocument();
    await user.keyboard("{ArrowLeft}");
    expect(screen.queryByRole("link", { name: "Tasks" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Projects" })).toHaveFocus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("link", { name: "Tasks" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Close navigation" }));
    expect(screen.getByRole("button", { name: "Open navigation" })).toHaveFocus();
  });

  it("commands: opens by shortcut and trigger, filters, selects a host href and restores focus on Escape", async () => {
    const user = userEvent.setup(); render(<AppFrame {...fixture()} />);
    const trigger = screen.getByRole("button", { name: "Find a command" }); trigger.focus();
    const apple = /Mac|iPhone|iPad|iPod/.test(navigator.platform);
    await user.keyboard(apple ? "{Meta>}k{/Meta}" : "{Control>}k{/Control}");
    const search = await screen.findByRole("combobox", { name: "Search commands" });
    await user.type(search, "Open p");
    expect(screen.getAllByRole("option")).toHaveLength(1);
    expect(screen.getByRole("option", { name: "Open projects" })).toHaveAttribute("href", "#projects");
    await user.clear(search); await user.type(search, "Open");
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("option", { name: "Open projects" })).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{Enter}");
    await waitFor(() => expect(window.location.hash).toBe("#projects"));
    await waitFor(() => expect(trigger).toHaveFocus());
    await user.click(trigger);
    expect(await screen.findByRole("dialog", { name: "Commands" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("account: lists host items, dismisses with Escape and requires the supplied destructive confirmation", async () => {
    const user = userEvent.setup(); const destroy = vi.fn(); render(<AccountHost destroy={destroy} />);
    const trigger = screen.getByRole("button", { name: "Example member" });
    await user.click(trigger);
    expect(await screen.findByRole("menuitem", { name: "Profile" })).toHaveAttribute("href", "#profile");
    expect(screen.getByRole("menuitem", { name: "Delete workspace" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
    await user.click(trigger); await user.click(await screen.findByRole("menuitem", { name: "Delete workspace" }));
    expect(await screen.findByRole("dialog", { name: "Confirm workspace deletion" })).toBeInTheDocument();
    expect(destroy).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Cancel deletion" }));
    expect(destroy).not.toHaveBeenCalled();
    await user.click(trigger); await user.click(await screen.findByRole("menuitem", { name: "Delete workspace" }));
    await user.click(await screen.findByRole("button", { name: "Confirm deletion" }));
    expect(destroy).toHaveBeenCalledOnce();
  });

  it("theme: the navigation footer slot updates a child Block through the native provider without remount", async () => {
    const user = userEvent.setup(); const mounted = vi.fn();
    render(<AppFrame {...fixture()} theme={{ defaultPreference: "light" }} themeControl={<ThemeToggle aria-label="Host theme" />}><ThemeBlock mounted={mounted} /></AppFrame>);
    const block = screen.getByRole("region", { name: "Themed block" });
    const output = screen.getByLabelText("Resolved theme");
    expect(output).toHaveTextContent("light");
    await user.click(screen.getByRole("button", { name: "Retained count 0" }));
    const control = screen.getByRole("button", { name: "Host theme" });
    expect(control.closest('[data-application-frame-slot="theme-control"]')).not.toBeNull();
    await user.click(control);
    expect(output).toHaveTextContent("dark");
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
    await user.click(control);
    expect(output).toHaveTextContent("light");
    expect(screen.getByRole("region", { name: "Themed block" })).toBe(block);
    expect(screen.getByRole("button", { name: "Retained count 1" })).toBeInTheDocument();
    expect(mounted).toHaveBeenCalledOnce();
  });

  it("mobile: the breakpoint creates a navigation sheet with focus containment and Escape/navigation dismissal", async () => {
    const user = userEvent.setup(); const props = fixture(); const view = render(<AppFrame {...props} />);
    resize(false);
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
    const trigger = screen.getByRole("button", { name: "Open navigation" });
    await user.click(trigger);
    const sheet = await screen.findByRole("dialog", { name: "Workspace navigation" });
    expect(within(sheet).getByRole("navigation", { name: "Workspace navigation" })).toBeInTheDocument();
    for (let i = 0; i < 9; i++) { await user.tab(); expect(sheet).toContainElement(document.activeElement as HTMLElement); }
    for (let i = 0; i < 9; i++) { await user.tab({ shift: true }); expect(sheet).toContainElement(document.activeElement as HTMLElement); }
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
    await user.click(trigger); await user.click(await screen.findByRole("link", { name: "Home" }));
    // The host supplies the new route after the anchor navigation, as a router would.
    view.rerender(<AppFrame {...props} navigation={{ ...props.navigation, activeId: "home", navigationKey: "home" }} />);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("panels: defaults to no right panel, bounds keyboard resizing and restores focus after the modal Drawer closes", async () => {
    const user = userEvent.setup(); const props = fixture(); const view = render(<AppFrame {...props} />);
    expect(screen.queryByRole("separator")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open panel" })).not.toBeInTheDocument();
    props.rightPanel = { label: "Inspector", handleLabel: "Resize inspector", min: 200, max: 400, defaultValue: 300, step: 20, children: <Button>Inspector action</Button> };
    view.rerender(<AppFrame {...props} />);
    const handle = screen.getByRole("separator", { name: "Resize inspector" }); handle.focus();
    await user.keyboard("{ArrowRight}"); expect(handle).toHaveAttribute("aria-valuenow", "320");
    await user.keyboard("{End}{ArrowRight}"); expect(handle).toHaveAttribute("aria-valuenow", "400");
    await user.keyboard("{Home}{ArrowLeft}"); expect(handle).toHaveAttribute("aria-valuenow", "200");
    resize(false);
    expect(screen.queryByRole("separator")).not.toBeInTheDocument();
    const trigger = screen.getByRole("button", { name: "Open panel" }); await user.click(trigger);
    const drawer = await screen.findByRole("dialog", { name: "Inspector" });
    expect(drawer).toContainElement(document.activeElement as HTMLElement);
    await user.tab(); expect(drawer).toContainElement(document.activeElement as HTMLElement);
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
    await user.click(trigger); await user.click(await screen.findByRole("button", { name: "Close panel" }));
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("landmarks: exposes one main and nav and the skip link focuses the sole main", async () => {
    const user = userEvent.setup(); render(<AppFrame {...fixture()} />);
    expect(screen.getAllByRole("main")).toHaveLength(1);
    expect(screen.getAllByRole("navigation")).toHaveLength(1);
    const main = screen.getByRole("main"); const skip = screen.getByRole("link", { name: "Skip to content" });
    expect(skip).toHaveAttribute("href", "#" + main.id);
    await user.click(skip); expect(main).toHaveFocus();
  });
});

function stageFixture() {
  return {
    ...fixture(),
    brand: { markSrc: "/mark.svg", wordmark: "Atlas", label: "Atlas workspace", href: "#home" },
    rightPanel: { children: <button>Context action</button>, label: "Context", handleLabel: "Resize context", min: 200, max: 500, defaultValue: 300 },
    page: {
      title: "Project board", breadcrumb: [{ id: "projects", label: "Projects", href: "#projects", siblings: [{ id: "library", label: "Library", href: "#library" }] }],
      status: <span>Ready</span>, description: "Current project details", updatedAt: "Updated today", meta: <span>Owned by the team</span>, scope: <span>All projects</span>,
      actions: [{ id: "save", label: "Save changes", onAction: vi.fn(), primary: true }, { id: "export", label: "Export project", onAction: vi.fn() }],
    },
    children: <><p>Route body</p><button>Route action</button></>,
  };
}
function region(name: string) { return document.querySelector<HTMLElement>(`[data-application-frame-region="${name}"]`)!; }
function setViewport(width: number) {
  act(() => { viewport = width; Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: width }); for (const listener of listeners) listener(); window.dispatchEvent(new Event("resize")); });
}

describe("AppFrame floating stage", () => {
  it("keeps resize geometry committed while a panel-width transition is suspended", async () => {
    setViewport(1100);
    let changeWidth!: (width: number) => void;
    let release!: () => void;
    let suspended = true;
    const attempted = vi.fn();
    const pending = new Promise<void>(resolve => { release = resolve; });
    function Route({ width }: { width: number }) {
      attempted(width);
      if (width === 500 && suspended) throw pending;
      return <output aria-label="Committed panel width">{width}</output>;
    }
    function Host() {
      const [width, setWidth] = useState(300); changeWidth = setWidth;
      const props = stageFixture();
      return <React.Suspense fallback={<p>Pending route</p>}><AppFrame {...props} rightPanel={{ ...props.rightPanel, value: width }}><Route width={width} /></AppFrame></React.Suspense>;
    }
    render(<Host />);
    await waitFor(() => expect(region("stage")).toHaveAttribute("data-stage-panel", "docked"));
    await act(async () => { React.startTransition(() => changeWidth(500)); });
    expect(attempted).toHaveBeenCalledWith(500);
    expect(screen.getByRole("status", { name: "Committed panel width" })).toHaveTextContent("300");
    act(() => { window.dispatchEvent(new Event("resize")); });
    expect(region("stage")).toHaveAttribute("data-stage-panel", "docked");
    await act(async () => { suspended = false; release(); await pending; });
    await waitFor(() => expect(screen.getByRole("status", { name: "Committed panel width" })).toHaveTextContent("500"));
    await waitFor(() => expect(region("stage")).toHaveAttribute("data-stage-panel", "overlay"));
  });

  it("a: keeps two corner controls with expanded state, conditional context and return focus", async () => {
    const user = userEvent.setup(); const props = stageFixture(); const view = render(<AppFrame {...props} />);
    const nav = document.querySelector<HTMLButtonElement>('[data-application-frame-navigation="trigger"]')!;
    const panel = document.querySelector<HTMLButtonElement>('[data-application-frame-panel="trigger"]')!;
    expect(nav).toHaveAttribute("aria-expanded", "true"); expect(panel).toHaveAttribute("aria-expanded", "true");
    await user.click(nav); expect(nav).toHaveAttribute("aria-expanded", "false"); expect(nav).toHaveFocus();
    await user.click(nav); expect(nav).toHaveAttribute("aria-expanded", "true");
    await user.click(panel); expect(panel).toHaveAttribute("aria-expanded", "false"); expect(panel).toHaveFocus();
    expect(region("header")).toContainElement(nav); expect(region("header")).toContainElement(panel);
    expect(nav.style.minBlockSize).toContain("--ui-layout-tap-target"); expect(panel.style.minBlockSize).toBe(nav.style.minBlockSize);
    const { rightPanel: _, ...withoutPanel } = props; view.rerender(<AppFrame {...withoutPanel} />);
    expect(document.querySelector('[data-application-frame-panel="trigger"]')).toBeNull();
  });

  it.each(["navigation", "panel"] as const)("a: exposes an expanded corner close control inside the narrow %s modal", async side => {
    setViewport(375); const user = userEvent.setup(); render(<AppFrame {...stageFixture()} />);
    const openLabel = side === "navigation" ? "Open navigation" : "Open panel";
    const closeLabel = side === "navigation" ? "Close navigation" : "Close panel";
    const trigger = screen.getByRole("button", { name: openLabel });
    await user.click(trigger);
    const close = screen.getByRole("button", { name: closeLabel, expanded: true });
    expect(screen.getByRole("dialog")).toContainElement(close);
    await user.click(close);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it.each(["navigation", "panel"] as const)("a: delegates the RTL %s close coordinate to the CSS containing box", async side => {
    setViewport(899);
    const original = HTMLElement.prototype.getBoundingClientRect;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      return this.matches('[data-application-frame-navigation="trigger"], [data-application-frame-panel="trigger"]')
        ? new DOMRect(117, 35, 44, 44) : original.call(this);
    });
    const user = userEvent.setup(); render(<AppFrame {...stageFixture()} dir="rtl" />);
    await user.click(screen.getByRole("button", { name: side === "navigation" ? "Open navigation" : "Open panel" }));
    const close = screen.getByRole("button", { name: side === "navigation" ? "Close navigation" : "Close panel", expanded: true });
    await waitFor(() => expect(close).toHaveStyle({ insetBlockStart: "35px", insetInlineStart: "calc(100% - 161px)", direction: "rtl" }));
  });

  it("a: reserves the token-sized corner row before navigation search", () => {
    render(<AppFrame {...stageFixture()} />);
    const header = document.querySelector<HTMLElement>('[data-application-navigation-region="header"]')!;
    expect(header.firstElementChild).toContainElement(screen.getByRole("button", { name: "Find a command" }));
    const clearance = (header.firstElementChild as HTMLElement).style.paddingBlockStart;
    expect(clearance).toContain("--ui-layout-tap-target"); expect(clearance).toContain("--spacing-md");
  });

  it.each(["ltr", "rtl"] as const)("b: reserves docked widths and overlays panels before the stage drops below its minimum in %s", async dir => {
    const user = userEvent.setup(); render(<AppFrame {...stageFixture()} dir={dir} />);
    expect(region("stage")).toHaveAttribute("data-stage-navigation", "docked");
    expect(region("stage")).toHaveAttribute("data-stage-panel", "docked");
    expect(region("stage")).toHaveClass("min-w-0");
    setViewport(1024);
    await waitFor(() => expect(region("stage")).toHaveAttribute("data-stage-panel", "overlay"));
    setViewport(899);
    await waitFor(() => expect(region("stage")).toHaveAttribute("data-stage-navigation", "overlay"));
    expect(region("stage")).toHaveAttribute("data-stage-panel", "overlay");
    await user.click(screen.getByRole("button", { name: "Open panel" }));
    expect(await screen.findByRole("dialog", { name: "Context" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.getByRole("button", { name: "Open panel" })).toHaveFocus());
  });

  it("b: budgets the bounded default panel width before deciding whether to dock", async () => {
    setViewport(1024);
    const props = stageFixture();
    render(<AppFrame {...props} rightPanel={{ ...props.rightPanel, min: 300, max: 500, defaultValue: 100 }} />);
    expect(region("stage")).toHaveAttribute("data-stage-navigation", "docked");
    await waitFor(() => expect(region("stage")).toHaveAttribute("data-stage-panel", "overlay"));
    expect(screen.queryByRole("region", { name: "Context" })).not.toBeInTheDocument();
  });

  it("b: rechecks raised panel bounds against the retained width and hands off focus", async () => {
    setViewport(1100);
    const props = stageFixture();
    const view = render(<AppFrame {...props} rightPanel={{ ...props.rightPanel, min: 200, max: 800, value: 300 }} />);
    await waitFor(() => expect(region("stage")).toHaveAttribute("data-stage-panel", "docked"));
    screen.getByRole("button", { name: "Context action" }).focus();
    view.rerender(<AppFrame {...props} rightPanel={{ ...props.rightPanel, min: 500, max: 800, value: 300 }} />);
    await waitFor(() => expect(region("stage")).toHaveAttribute("data-stage-panel", "overlay"));
    await waitFor(() => expect(screen.getByRole("button", { name: "Open panel" })).toHaveFocus());
    expect(screen.queryByRole("region", { name: "Context" })).not.toBeInTheDocument();
  });

  it("b: budgets the capped maximum rather than an oversized retained panel width", async () => {
    setViewport(1100);
    const props = stageFixture();
    render(<AppFrame {...props} rightPanel={{ ...props.rightPanel, min: 200, max: 300, defaultValue: 700 }} />);
    await waitFor(() => expect(region("stage")).toHaveAttribute("data-stage-panel", "docked"));
    expect(screen.getByRole("region", { name: "Context" })).toHaveStyle({ inlineSize: "300px" });
  });

  it("c: keeps the stage at its full remaining width when the page changes", () => {
    const props = stageFixture(); const view = render(<AppFrame {...props} />);
    const stage = region("stage"); const main = screen.getByRole("main");
    expect(stage).toHaveClass("flex-1", "min-w-0", "overflow-hidden");
    expect(stage).not.toHaveAttribute("data-stage-width");
    expect(screen.queryByRole("button", { name: /Use .* width/ })).toBeNull();
    view.rerender(<AppFrame {...props} page={{ ...props.page, title: "Another project" }} />);
    expect(region("stage")).toBe(stage); expect(screen.getByRole("main")).toBe(main);
    expect(stage.style.maxInlineSize).toBe("");
  });

  it("d: reserves the adaptive sticky bar above the independently scrolling stage with an opaque fallback", () => {
    const supported = vi.fn(() => true);
    vi.stubGlobal("CSS", Object.assign(Object.create(globalThis.CSS ?? null), { supports: supported }));
    const view = render(<AppFrame {...stageFixture()} />);
    const bar = screen.getByRole("banner");
    expect(bar).toHaveStyle({ position: "sticky" }); expect(region("header")).toContainElement(bar);
    expect(region("stage")).not.toContainElement(bar);
    expect(screen.getByRole("main")).toHaveClass("overflow-auto");
    expect(bar.style.backdropFilter).toContain("blur");
    view.unmount(); supported.mockReturnValue(false); render(<AppFrame {...stageFixture()} />);
    expect(screen.getByRole("banner").style.backdropFilter).toBe("none");
    expect(screen.getByRole("banner")).toHaveClass("bg-surface-raised");
  });

  it("e: exposes the home mark, brand-rooted breadcrumb, page h1 and sibling/workspace menus", async () => {
    const user = userEvent.setup(); const props = stageFixture(); const view = render(<AppFrame {...props} />);
    const trail = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(within(trail).getByRole("link", { name: "Atlas" })).toHaveAttribute("href", "#home");
    expect(screen.getByRole("heading", { level: 1, name: "Project board" })).toHaveAttribute("aria-current", "page");
    await user.click(within(trail).getByRole("button", { name: "Projects" }));
    expect(await screen.findByRole("menuitem", { name: "Library" })).toHaveAttribute("href", "#library");
    await user.keyboard("{Escape}");
    view.rerender(<AppFrame {...props} workspaces={[{ id: "atlas", label: "Atlas", href: "#atlas" }, { id: "research", label: "Research", href: "#research" }]} />);
    await user.click(within(screen.getByRole("navigation", { name: "Breadcrumb" })).getByRole("button", { name: "Atlas" }));
    expect(await screen.findByRole("menuitem", { name: "Research" })).toHaveAttribute("href", "#research");
  });

  it("e: retains ancestor sibling destinations in the collapsed narrow breadcrumb", async () => {
    setViewport(375); const user = userEvent.setup(); render(<AppFrame {...stageFixture()} />);
    await user.click(screen.getByRole("button", { name: "More breadcrumb levels" }));
    expect(await screen.findByRole("menuitem", { name: "Projects" })).toHaveAttribute("href", "#projects");
    expect(screen.getByRole("menuitem", { name: "Library" })).toHaveAttribute("href", "#library");
  });

  it.each(["ltr", "rtl"] as const)("f: preserves the explicit %s direction in the portaled information surface", async dir => {
    const user = userEvent.setup(); render(<AppFrame {...stageFixture()} dir={dir} />);
    await user.click(screen.getByRole("button", { name: "Page information" }));
    expect(region("page-info").parentElement?.parentElement).toHaveStyle({ direction: dir });
  });

  it("f: resolves inherited document direction for the portaled information", async () => {
    const previous = document.documentElement.dir; document.documentElement.dir = "rtl";
    try {
      const user = userEvent.setup(); render(<AppFrame {...stageFixture()} />);
      await user.click(screen.getByRole("button", { name: "Page information" }));
      expect(region("page-info").parentElement?.parentElement).toHaveStyle({ direction: "rtl" });
    } finally { document.documentElement.dir = previous; }
  });

  it("f: retains token typography and foreground outside the frame portal", async () => {
    const user = userEvent.setup(); render(<AppFrame {...stageFixture()} />);
    await user.click(screen.getByRole("button", { name: "Page information" }));
    expect(region("page-info").parentElement?.parentElement).toHaveClass("text-body", "text-ink-primary");
  });

  it("g: presents only the first requested primary action as primary", () => {
    const props = stageFixture();
    props.page.actions = props.page.actions.map(action => ({ ...action, primary: true }));
    render(<AppFrame {...props} />);
    const primary = document.querySelectorAll('[data-application-frame-action="primary"]');
    expect(primary).toHaveLength(1); expect(primary[0]).toHaveTextContent("Save changes");
    expect(screen.getByRole("button", { name: "Export project" })).toHaveAttribute("data-application-frame-action", "secondary");
  });

  it("f: opens optional page information as an overlay and dismisses on Escape and outside press", async () => {
    const user = userEvent.setup(); const props = stageFixture(); const view = render(<AppFrame {...props} />);
    const trigger = screen.getByRole("button", { name: "Page information" });
    expect(trigger).toHaveAttribute("aria-expanded", "false"); await user.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true"); expect(screen.getByText("Current project details")).toBeInTheDocument();
    expect(region("page-info").parentElement?.parentElement).toHaveStyle({ position: "absolute" });
    await user.keyboard("{Escape}"); await waitFor(() => expect(trigger).toHaveAttribute("aria-expanded", "false")); await waitFor(() => expect(trigger).toHaveFocus());
    await user.click(trigger); await user.click(screen.getByText("Route action"));
    await waitFor(() => expect(trigger).toHaveAttribute("aria-expanded", "false"));
    view.rerender(<AppFrame {...props} page={{ title: "Project board" }} />);
    expect(screen.queryByRole("button", { name: "Page information" })).not.toBeInTheDocument();
  });

  it("g: keeps one primary action and narrow secondary overflow", async () => {
    const user = userEvent.setup(); const props = stageFixture(); render(<AppFrame {...props} />);
    await user.click(screen.getByRole("button", { name: "Save changes" })); expect(props.page.actions[0]!.onAction).toHaveBeenCalledOnce();
    setViewport(375);
    await user.click(screen.getByRole("button", { name: "More page actions" }));
    await user.click(await screen.findByRole("menuitem", { name: "Export project" })); expect(props.page.actions[1]!.onAction).toHaveBeenCalledOnce();
    expect(screen.queryByRole("button", { name: /Use .* width/ })).toBeNull();
  });

  it("h: puts command search first, profile/theme in the footer, preserves icons and opens commands with navigation closed", async () => {
    const user = userEvent.setup(); const props = stageFixture();
    props.navigation.tree[0]!.icon = <span data-testid="home-icon" />;
    render(<AppFrame {...props} />);
    const nav = screen.getByRole("navigation", { name: "Workspace navigation" });
    expect(nav.querySelector("button")).toHaveAccessibleName("Find a command");
    expect(within(nav).getByRole("link", { name: "Home" })).toContainElement(screen.getByTestId("home-icon"));
    const footer = nav.querySelector('[data-application-navigation-region="footer"]')!;
    expect(footer).toContainElement(screen.getByRole("button", { name: "Example member" })); expect(footer).toContainElement(screen.getByRole("button", { name: /Theme:/ }));
    expect(within(nav).queryByText("Workspace navigation")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Close navigation" }));
    await user.keyboard("{Control>}k{/Control}"); expect(await screen.findByRole("dialog", { name: "Commands" })).toBeInTheDocument();
  });
});


describe("AppFrame profile brand", () => {
  it("moves the host mark to the profile Avatar and retains the document breadcrumb root", () => {
    render(<AppFrame {...stageFixture()} />);
    expect(screen.queryByRole("link", { name: "Atlas workspace" })).toBeNull();
    expect(screen.getByRole("button", { name: "Example member" }).querySelector("img")).toHaveAttribute("src", "/mark.svg");
    expect(within(screen.getByRole("navigation", { name: "Breadcrumb" })).getByRole("link", { name: "Atlas" })).toBeInTheDocument();
  });
});
