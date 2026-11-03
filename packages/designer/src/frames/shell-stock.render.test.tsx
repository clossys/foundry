// @vitest-environment jsdom
/**
 * T14 focused render: the shell's account and command compositions, rendered under the explicit
 * ambient (marketing) selection that binds menu, button, command, dialog, popover and avatar to stock
 * shadcn@aria, must show their visible trigger and, once opened, their contents in stock anatomy.
 */
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccountMenu } from "../blocks/AccountMenu.js";
import { CommandMenu as ShellFixtureCommandMenu } from "../blocks/CommandMenu.js";
import { ConsumerComponentProvider } from "../runtime/component-leaf.client.js";
import { marketingComponentSelection } from "../studio/marketing-component-selection.js";
import { APP_FRAME_WIDE_QUERY } from "./app-frame-layout.js";
import { AppFrame as ShellFixtureAppFrame } from "./AppFrame.js";
import { withShellCopy } from "./__fixtures__/shell-copy.js";

const AppFrame = withShellCopy(ShellFixtureAppFrame, true);
const CommandMenu = withShellCopy(ShellFixtureCommandMenu);
const ambient = (children: ReactNode) => <ConsumerComponentProvider value={marketingComponentSelection()}>{children}</ConsumerComponentProvider>;

beforeEach(() => {
  localStorage.clear();
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1280 });
  vi.stubGlobal("matchMedia", vi.fn((media: string) => ({ media, matches: media === APP_FRAME_WIDE_QUERY || media === "all",
    addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {} })));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.documentElement.removeAttribute("data-theme"); });

describe("shell compositions on the ambient stock selection (T14)", () => {
  it("AccountMenu shows its avatar trigger and opens stock menu groups and items", async () => {
    render(ambient(<AccountMenu actor={{ name: "Jordan Vale", secondaryText: "jordan@example.test" }} sections={[
      { id: "account", label: "Account", entries: [
        { id: "profile", kind: "link", label: "Profile", href: "/profile" },
        { id: "sign-out", kind: "destructive", label: "Sign out", onAction: vi.fn() },
      ] },
    ]} />));
    const trigger = screen.getByRole("button", { name: "Jordan Vale" });
    expect(trigger).toBeVisible();
    expect(trigger.querySelector('[data-slot="avatar-fallback"]')).toHaveTextContent("JV");
    expect(screen.queryByRole("menu")).toBeNull();
    await userEvent.click(trigger);
    const menu = await screen.findByRole("menu", { name: "Jordan Vale" });
    expect(menu.querySelector('[data-slot="dropdown-menu-group"]')).not.toBeNull();
    expect(screen.getByRole("group", { name: /Account/ })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Profile" })).toHaveAttribute("data-slot", "dropdown-menu-item");
    expect(screen.getByRole("menuitem", { name: "Sign out" })).toHaveAttribute("data-variant", "destructive");
  });

  it("CommandMenu shows its stock search, groups and named rows, and closes from its visible button", async () => {
    function Host() {
      const [isOpen, setOpen] = useState(true);
      const [query, setQuery] = useState("");
      return <CommandMenu heading="Commands" searchLabel="Search commands" closeLabel="Close commands" emptyMessage="No matching commands"
        isOpen={isOpen} onOpenChange={setOpen} query={query} onQueryChange={setQuery}
        groups={[{ id: "manage", label: "Manage", items: [{ id: "alpha", label: "Alpha", description: "Open drafts", shortcutHint: "A", onAction: vi.fn() }] }]} />;
    }
    render(ambient(<Host />));
    expect(await screen.findByRole("dialog", { name: "Commands" })).toBeVisible();
    expect(screen.getByRole("searchbox", { name: "Search commands" })).toHaveAttribute("data-slot", "command-input");
    expect(screen.getByRole("group", { name: "Manage" })).toHaveAttribute("data-slot", "command-group");
    const row = screen.getByRole("menuitem", { name: "Alpha" });
    expect(row).toHaveAttribute("data-slot", "command-item");
    expect(row).toHaveTextContent("Open drafts");
    expect(row.querySelector('[data-slot="command-shortcut"]')).toHaveTextContent("A");
    const close = screen.getByRole("button", { name: "Close commands" });
    expect(close).toHaveAttribute("data-slot", "button");
    await userEvent.click(close);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("AppFrame shows its navigation, account and command triggers and opens both shell menus", async () => {
    render(ambient(<AppFrame
      brand={{ markSrc: "/mark.svg", wordmark: "Atlas", label: "Atlas workspace", href: "#home" }}
      navigation={{ tree: [{ id: "home", label: "Home", href: "#home" }], activeId: "home", label: "Workspace navigation" }}
      account={{ actor: { name: "Sam River", secondaryText: "Editor" }, signedOutLabel: "Signed out", sections: [{ id: "account", entries: [
        { kind: "link", id: "profile", label: "Profile", href: "#profile" }, { kind: "destructive", id: "out", label: "Sign out", onAction: vi.fn() },
      ] }] }}
      commands={{ heading: "Commands", searchLabel: "Search commands", closeLabel: "Close commands", emptyMessage: "No matching commands", triggerLabel: "Find a command",
        groups: [{ id: "actions", label: "Actions", items: [{ id: "create", label: "Create document", onAction: vi.fn() }] }] }}>
      <h1>Host content</h1>
    </AppFrame>));
    expect(screen.getByRole("link", { name: "Home" })).toBeVisible();
    const account = screen.getByRole("button", { name: "Sam River" });
    expect(account.querySelector('[data-slot="avatar-fallback"]')).toHaveTextContent("SR");
    await userEvent.click(account);
    expect(await screen.findByRole("menuitem", { name: "Profile" })).toHaveAttribute("data-slot", "dropdown-menu-item");
    expect(screen.getByRole("menuitem", { name: "Sign out" })).toHaveAttribute("data-variant", "destructive");
    await userEvent.keyboard("{Escape}");
    await userEvent.click(screen.getByRole("button", { name: "Find a command" }));
    expect(await screen.findByRole("searchbox", { name: "Search commands" })).toHaveAttribute("data-slot", "command-input");
    expect(screen.getByRole("menuitem", { name: "Create document" })).toHaveAttribute("data-slot", "command-item");
  });
});
