// @vitest-environment jsdom
import React, { useEffect, useState } from "react";
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Button, Dialog } from "@clossys/designer/atoms";
import { Panel } from "@clossys/designer/blocks";
import { ThemeToggle, useTheme } from "@clossys/designer/theme";
import { AppFrame } from "./AppFrame.js";
import type { AppFrameProps } from "./app-frame-types.js";

let wide: boolean;
let listeners: Set<() => void>;
beforeEach(() => {
  wide = true;
  listeners = new Set();
  localStorage.clear();
  // The literal root command has no package JSX configuration.
  vi.stubGlobal("React", React);
  vi.stubGlobal("matchMedia", vi.fn((media: string) => ({
    media, get matches() { return media === "(min-width: 768px)" && wide; },
    addEventListener: (_: string, listener: () => void) => { if (media === "(min-width: 768px)") listeners.add(listener); },
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
function resize(matches: boolean) { act(() => { wide = matches; for (const listener of listeners) listener(); }); }
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
    await user.click(screen.getByRole("button", { name: "Collapse navigation" }));
    expect(screen.getByRole("button", { name: "Expand navigation" })).toHaveFocus();
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

  it("theme: the header slot updates a child Block through the native provider without remount", async () => {
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
