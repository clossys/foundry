// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Button, Dialog } from "@clossys/designer/atoms";
import { AppFrame } from "./AppFrame.js";
import type { AppFrameProps } from "./app-frame-types.js";

let wide: { matches: boolean; listeners: Set<() => void> };
beforeEach(() => {
  localStorage.clear();
  wide = { matches: true, listeners: new Set() };
  vi.stubGlobal("matchMedia", vi.fn((media: string) => {
    const state = media === "(min-width: 768px)" ? wide : { matches: false, listeners: new Set<() => void>() };
    return { media, get matches() { return state.matches; }, addEventListener: (_: string, listener: () => void) => state.listeners.add(listener),
      removeEventListener: (_: string, listener: () => void) => state.listeners.delete(listener), addListener: () => {}, removeListener: () => {} };
  }));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.documentElement.removeAttribute("data-theme"); });

function fixture(): AppFrameProps {
  return {
    brand: { markSrc: "/mark.svg", wordmark: "Atlas", label: "Atlas workspace", href: "#home" },
    navigation: { tree: [{ id: "home", label: "Home", href: "#home" }], activeId: "home", label: "Workspace navigation" },
    account: { actor: { name: "Sam River", secondaryText: "Editor" }, signedOutLabel: "Signed out", sections: [{ id: "account", entries: [
      { kind: "link", id: "profile", label: "Profile", href: "#profile" }, { kind: "destructive", id: "out", label: "Sign out", onAction: vi.fn() },
    ] }] },
    commands: { heading: "Commands", searchLabel: "Search commands", closeLabel: "Close commands", emptyMessage: "No matching commands", triggerLabel: "Find a command", groups: [
      { id: "actions", label: "Actions", items: [{ id: "create", label: "Create document", onAction: vi.fn() }, { id: "archive", label: "Archive document", onAction: vi.fn() }] },
    ] },
    rightPanel: { children: <button>Inspector action</button>, label: "Inspector", handleLabel: "Resize inspector", min: 200, max: 500, defaultValue: 300, step: 10 },
    children: <><h1>Host content</h1><button>Host opener</button></>,
  };
}

describe("AppFrame composition", () => {
  it("owns the sole main and focusable skip target, active host navigation, and bottom account footer", async () => {
    render(<AppFrame {...fixture()} />);
    const main = screen.getByRole("main");
    expect(screen.getAllByRole("main")).toHaveLength(1);
    expect(main).toHaveAttribute("tabindex", "-1");
    expect(within(main).getByRole("heading", { name: "Host content" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Home" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("button", { name: "Sam River" }).closest('[data-application-navigation-region="footer"]')).not.toBeNull();
    await userEvent.click(screen.getByRole("link", { name: "Skip to content" }));
    expect(main).toHaveFocus();
  });

  it("cycles all three preferences, stamps the whole document, and restores persisted state", async () => {
    const props = fixture(); props.theme = { storageKey: "atlas-theme", defaultPreference: "system" };
    const view = render(<AppFrame {...props} />);
    for (const [current, next] of [["System", "light"], ["Light", "dark"], ["Dark", "system"]]) {
      await userEvent.click(screen.getByRole("button", { name: new RegExp("Theme: " + current) }));
      expect(localStorage.getItem("atlas-theme")).toBe(next);
      if (next === "system") expect(document.documentElement).not.toHaveAttribute("data-theme");
      else expect(document.documentElement).toHaveAttribute("data-theme", next);
    }
    await userEvent.click(screen.getByRole("button", { name: /Theme: System/ }));
    view.unmount(); render(<AppFrame {...props} />);
    await waitFor(() => expect(screen.getByRole("button", { name: /Theme: Light/ })).toBeInTheDocument());
  });

  it("opens real search, filters host commands, executes selection, closes and restores its button", async () => {
    const props = fixture(); render(<AppFrame {...props} />);
    const opener = screen.getByRole("button", { name: "Find a command" });
    await userEvent.click(opener);
    const search = await screen.findByRole("combobox", { name: "Search commands" });
    await userEvent.type(search, "Create");
    expect(screen.queryByRole("option", { name: "Archive document" })).not.toBeInTheDocument();
    await userEvent.keyboard("{Enter}");
    expect(props.commands.groups[0]!.items[0]!.onAction).toHaveBeenCalledOnce();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(opener).toHaveFocus());
  });

  it.each(["Win32", "MacIntel"])("opens with the platform shortcut and restores the prior host opener on %s", async platform => {
    vi.spyOn(navigator, "platform", "get").mockReturnValue(platform);
    render(<AppFrame {...fixture()} />);
    const opener = screen.getByRole("button", { name: "Host opener" }); opener.focus();
    fireEvent.keyDown(window, { key: "k", ctrlKey: platform === "Win32", metaKey: platform === "MacIntel" });
    expect(await screen.findByRole("combobox", { name: "Search commands" })).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(opener).toHaveFocus());
  });

  it("passes host account links and sign out, and restores Escape focus", async () => {
    const props = fixture(); render(<AppFrame {...props} />);
    const trigger = screen.getByRole("button", { name: "Sam River" });
    await userEvent.click(trigger);
    expect(await screen.findByRole("menuitem", { name: "Profile" })).toHaveAttribute("href", "#profile");
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(trigger).toHaveFocus());
    await userEvent.click(trigger); await userEvent.click(await screen.findByRole("menuitem", { name: "Sign out" }));
    expect((props.account.sections[0]!.entries[1] as { onAction: () => void }).onAction).toHaveBeenCalledOnce();
  });

  it("renders explicit signed-out host links with no invented actor or avatar", async () => {
    const props = fixture(); delete props.account.actor;
    render(<AppFrame {...props} />);
    expect(screen.queryByText("Sam River")).not.toBeInTheDocument();
    const trigger = screen.getByRole("button", { name: "Signed out" });
    expect(trigger.querySelector("img")).toBeNull();
    await userEvent.click(trigger);
    expect(await screen.findByRole("menuitem", { name: "Profile" })).toHaveAttribute("href", "#profile");
    await userEvent.keyboard("{Escape}"); await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("names unlabeled signed-out sections from the host label and retains explicit headings", async () => {
    const props = fixture(); delete props.account.actor;
    props.account.signedOutLabel = "Guest account";
    props.account.sections = [...props.account.sections, {
      id: "help", label: "Help destinations", entries: [{ kind: "link", id: "help", label: "Help", href: "#help" }],
    }];
    render(<AppFrame {...props} />);
    await userEvent.click(screen.getByRole("button", { name: "Guest account" }));
    expect(within(await screen.findByRole("group", { name: "Guest account" })).getByRole("menuitem", { name: "Profile" })).toHaveAttribute("href", "#profile");
    const named = screen.getByRole("group", { name: "Help destinations" });
    expect(within(named).getByText("Help destinations")).toBeVisible();
    expect(within(named).getByRole("menuitem", { name: "Help" })).toHaveAttribute("href", "#help");
  });

  it("resizes through the composed separator and retains width through collapse/reopen", async () => {
    const props = fixture(); const change = vi.fn(); props.rightPanel!.onChange = change;
    render(<AppFrame {...props} />);
    const separator = screen.getByRole("separator", { name: "Resize inspector" });
    separator.focus(); await userEvent.keyboard("{ArrowRight}");
    expect(change).toHaveBeenLastCalledWith(310);
    expect(separator).toHaveAttribute("aria-valuenow", "310");
    expect(screen.getByRole("region", { name: "Inspector" })).toHaveStyle({ inlineSize: "310px" });
    await userEvent.click(screen.getByRole("button", { name: "Close panel" }));
    expect(screen.queryByRole("separator")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Open panel" }));
    expect(screen.getByRole("separator", { name: "Resize inspector" })).toHaveAttribute("aria-valuenow", "310");
  });

  it("honors controlled panel width and collapsed state without overwriting host values", async () => {
    const props = fixture(); props.rightPanel = { ...props.rightPanel!, value: 350, onChange: vi.fn(), collapsed: false, onCollapsedChange: vi.fn() };
    render(<AppFrame {...props} />);
    fireEvent.keyDown(screen.getByRole("separator"), { key: "End" });
    expect(props.rightPanel.onChange).toHaveBeenCalledWith(500);
    expect(screen.getByRole("separator")).toHaveAttribute("aria-valuenow", "350");
    await userEvent.click(screen.getByRole("button", { name: "Close panel" }));
    expect(props.rightPanel.onCollapsedChange).toHaveBeenCalledWith(true);
    expect(screen.getByRole("separator")).toBeInTheDocument();
  });

  it("uses one narrow navigation Drawer and a separate end panel sheet with focus restoration", async () => {
    wide.matches = false;
    render(<AppFrame {...fixture()} dir="rtl" />);
    expect(screen.queryByRole("separator")).not.toBeInTheDocument();
    const trigger = screen.getByRole("button", { name: "Open panel" });
    await userEvent.click(trigger);
    const dialog = await screen.findByRole("dialog", { name: "Inspector" });
    expect(dialog.querySelector('[data-drawer-wide="sheet"]')).toHaveAttribute("data-drawer-placement", "end");
    expect(within(dialog).getByRole("button", { name: "Inspector action" })).toBeInTheDocument();
    await userEvent.keyboard("{Escape}"); await waitFor(() => expect(trigger).toHaveFocus());
    await userEvent.click(screen.getByRole("button", { name: "Open navigation" }));
    expect(await screen.findByRole("dialog", { name: "Workspace navigation" })).toBeInTheDocument();
    expect(screen.getAllByRole("navigation")).toHaveLength(1);
  });

  it("preserves logical RTL, centered mobile brand geometry, natural wordmark, accent and image opt-out", () => {
    const props = fixture(); const view = render(<AppFrame {...props} dir="rtl" />);
    const header = screen.getByRole("banner");
    expect(header.closest('[dir="rtl"]')).not.toBeNull();
    const brand = screen.getByRole("link", { name: "Atlas workspace" });
    expect(brand.parentElement).toHaveClass("absolute", "start-1/2", "-translate-x-1/2", "rtl:translate-x-1/2", "tablet:static", "tablet:translate-x-0");
    expect(within(brand).getByText("Atlas")).toHaveClass("hidden", "tablet:inline", "whitespace-nowrap");
    const mark = brand.querySelector('[data-application-frame-mark="accent"]') as HTMLElement;
    expect(mark).toHaveClass("bg-accent", "forced-colors:bg-[CanvasText]");
    expect(mark.style.maskImage).toContain("/mark.svg");
    expect(brand).toHaveClass("focus-visible:outline-accent");
    expect(brand).toHaveClass("justify-center", "tablet:justify-start");
    props.brand.markInk = "image"; view.rerender(<AppFrame {...props} dir="rtl" />);
    expect(brand.querySelector("img")).toHaveAttribute("src", "/mark.svg");
    expect(brand.querySelector('[data-application-frame-mark="accent"]')).toBeNull();
  });

  it("rejects unnamed or label-in-name-invalid brands without echoing host values", () => {
    const props = fixture(); props.brand.label = "private-value";
    const silent = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<AppFrame {...props} />)).toThrow("AppFrame: brand label must contain the visible wordmark.");
    silent.mockRestore();
  });

  it("binds host copy, custom filtering, result announcements, main target and shortcut opt-out", async () => {
    const props = fixture(); props.skipLabel = "Go to route"; props.mainId = "host-route";
    props.commands = { ...props.commands, heading: "Host launcher", searchLabel: "Host search", closeLabel: "Dismiss launcher", triggerLabel: "Open launcher",
      emptyMessage: "Host has no matches", shortcutEnabled: false, filter: (item, query) => item.id.startsWith(query), resultCountMessage: count => "Found " + count };
    render(<AppFrame {...props} />);
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to route" })).toHaveAttribute("href", "#host-route");
    await userEvent.click(screen.getByRole("button", { name: "Open launcher" }));
    expect(await screen.findByRole("dialog", { name: "Host launcher" })).toBeInTheDocument();
    const search = screen.getByRole("combobox", { name: "Host search" });
    await userEvent.type(search, "archive");
    expect(screen.getByRole("option", { name: "Archive document" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Create document" })).not.toBeInTheDocument();
    expect(screen.getByText("Found 1")).toBeInTheDocument();
    await userEvent.type(search, "missing");
    expect(screen.getByText("Host has no matches")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Dismiss launcher" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("retains resized width across narrow sheets and uses RTL in portal chrome", async () => {
    render(<AppFrame {...fixture()} dir="rtl" />);
    const separator = screen.getByRole("separator", { name: "Resize inspector" });
    fireEvent.keyDown(separator, { key: "End" });
    act(() => { wide.matches = false; for (const listener of wide.listeners) listener(); });
    await userEvent.click(screen.getByRole("button", { name: "Open panel" }));
    const dialog = await screen.findByRole("dialog", { name: "Inspector" });
    expect(dialog.closest('[data-overlay-container]')?.querySelector('[style*="direction: rtl"]')).not.toBeNull();
    await userEvent.keyboard("{Escape}");
    act(() => { wide.matches = true; for (const listener of wide.listeners) listener(); });
    expect(screen.getByRole("separator", { name: "Resize inspector" })).toHaveAttribute("aria-valuenow", "500");
  });

  it("initializes a later-supplied panel from its own default width and collapsed state", async () => {
    const props = fixture(); const { rightPanel } = props; delete props.rightPanel;
    const view = render(<AppFrame {...props} />);
    expect(screen.queryByRole("button", { name: "Open panel" })).not.toBeInTheDocument();
    view.rerender(<AppFrame {...props} rightPanel={{ ...rightPanel!, min: 220, defaultValue: 280, defaultCollapsed: true }} />);
    expect(screen.queryByRole("separator")).not.toBeInTheDocument();
    const opener = screen.getByRole("button", { name: "Open panel" });
    expect(opener).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(opener);
    expect(screen.getByRole("separator", { name: "Resize inspector" })).toHaveAttribute("aria-valuenow", "280");
  });

  it("moves focus from wide panel controls to the corresponding opener across responsive changes", async () => {
    render(<AppFrame {...fixture()} />);
    const resize = (matches: boolean) => act(() => { wide.matches = matches; for (const listener of wide.listeners) listener(); });
    screen.getByRole("separator", { name: "Resize inspector" }).focus();
    resize(false);
    await waitFor(() => expect(screen.getByRole("button", { name: "Open panel" })).toHaveFocus());
    resize(true);
    await waitFor(() => expect(screen.getByRole("button", { name: "Close panel" })).toHaveFocus());
    resize(false);
    await waitFor(() => expect(screen.getByRole("button", { name: "Open panel" })).toHaveFocus());
    resize(true);
    screen.getByRole("button", { name: "Inspector action" }).focus();
    resize(false);
    await waitFor(() => expect(screen.getByRole("button", { name: "Open panel" })).toHaveFocus());
    resize(true);
    const host = screen.getByRole("button", { name: "Host opener" }); host.focus();
    resize(false);
    expect(host).toHaveFocus();
  });

  it.each(["Close panel", "Inspector action"])("preserves focus when widening an open narrow panel from %s", async focusedControl => {
    wide.matches = false;
    render(<AppFrame {...fixture()} />);
    const opener = screen.getByRole("button", { name: "Open panel" });
    const main = screen.getByRole("main");
    let openerPresentAtHandoff = false;
    main.addEventListener("focus", () => { openerPresentAtHandoff = opener.isConnected; }, { once: true });
    await userEvent.click(opener);
    const dialog = await screen.findByRole("dialog", { name: "Inspector" });
    const focused = within(dialog).getByRole("button", { name: focusedControl });
    focused.focus();
    expect(focused).toHaveFocus();
    expect(screen.getByRole("banner", { hidden: true }).closest("[data-application-frame]")).not.toContainElement(focused);

    act(() => { wide.matches = true; for (const listener of wide.listeners) listener(); });

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Inspector" })).not.toBeInTheDocument());
    const desktopControl = screen.getByRole("button", { name: "Close panel" });
    await waitFor(() => expect([main, desktopControl]).toContain(document.activeElement));
    expect(openerPresentAtHandoff).toBe(true);
    expect(document.body).not.toHaveFocus();
  });

  it("preserves drawer focus when widening after a nested dialog closes", async () => {
    wide.matches = false;
    const props = fixture();
    props.rightPanel!.children = <>
      <Dialog trigger={<Button>Open nested dialog</Button>}>
        {({ close }) => <><Dialog.Heading>Nested settings</Dialog.Heading><Button onPress={close}>Close nested dialog</Button></>}
      </Dialog>
      <button>Remaining inspector action</button>
    </>;
    render(<AppFrame {...props} />);
    const opener = screen.getByRole("button", { name: "Open panel" });
    const main = screen.getByRole("main");
    let openerPresentAtHandoff = false;
    main.addEventListener("focus", () => { openerPresentAtHandoff = opener.isConnected; }, { once: true });
    await userEvent.click(opener);
    await userEvent.click(await screen.findByRole("button", { name: "Open nested dialog" }));
    expect(await screen.findByRole("dialog", { name: "Nested settings" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Close nested dialog" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Nested settings" })).not.toBeInTheDocument());
    const action = screen.getByRole("button", { name: "Remaining inspector action" });
    action.focus();
    expect(action).toHaveFocus();

    act(() => { wide.matches = true; for (const listener of wide.listeners) listener(); });

    await waitFor(() => expect(main).toHaveFocus());
    expect(openerPresentAtHandoff).toBe(true);
    expect(screen.queryByRole("dialog", { name: "Inspector" })).not.toBeInTheDocument();
    expect(document.body).not.toHaveFocus();
  });

  it("focuses main from the composed skip link without replacing a host hash route", async () => {
    window.history.replaceState(null, "", "#/projects/42");
    try {
      render(<AppFrame {...fixture()} />);
      await userEvent.click(screen.getByRole("link", { name: "Skip to content" }));
      expect(screen.getByRole("main")).toHaveFocus();
      expect(window.location.hash).toBe("#/projects/42");
    } finally { window.history.replaceState(null, "", window.location.pathname); }
  });

  it("supports absent panels and custom three-state theme copy with a host default", async () => {
    const props = fixture(); delete props.rightPanel;
    props.theme = { storageKey: "custom-theme", defaultPreference: "dark", preferenceLabels: { system: "Automatic", light: "Day", dark: "Night" }, toggleLabel: (current, next, labels) => labels[current] + " to " + labels[next], preferenceAnnouncement: next => "Chosen " + next };
    render(<AppFrame {...props} />);
    expect(screen.queryByRole("separator")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open panel" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Night to Automatic" }));
    expect(screen.getByText("Chosen system")).toBeInTheDocument();
    expect(localStorage.getItem("custom-theme")).toBe("system");
  });
});
