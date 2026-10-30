// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ShadcnAppShell } from "./AppShell.js";
import type { AppFrameProps } from "../app-frame-types.js";
import { shellCopyFixtureResolver } from "../__fixtures__/shell-copy.js";

beforeEach(() => {
  localStorage.clear();
  document.documentElement.style.setProperty("--breakpoint-mobile-lg", "768px");
  Object.defineProperty(window, "innerWidth", { value: 1280, configurable: true });
  vi.stubGlobal("matchMedia", vi.fn((media: string) => ({ media, matches: media === "(min-width: 768px)", addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); document.documentElement.style.removeProperty("--breakpoint-mobile-lg"); });

function fixture(): AppFrameProps {
  return {
    copyResolver: ref => shellCopyFixtureResolver(ref) ?? { ref, text: "Fixture navigation copy" },
    brand: { markSrc: "/mark.svg", navigationMark: { label: "Example Co." } },
    navigation: { label: "Workspace", activeId: "home", tree: [{ id: "home", label: "Home", href: "/home" }, { id: "work", label: "Work", children: [{ id: "draft", label: "Draft", onAction: vi.fn() }] }] },
    account: { actor: { name: "Example member" }, signedOutLabel: "Sign in", sections: [] },
    commands: { triggerLabel: "Find command", heading: "Commands", searchLabel: "Search", closeLabel: "Close commands", emptyMessage: "No matches", groups: [] },
    theme: { defaultPreference: "light" }, children: <p>Workspace content</p>,
  };
}

it("draws the real sidebar/inset anatomy with one main, named navigation and source provenance", () => {
  const { container } = render(<ShadcnAppShell {...fixture()} />);
  expect(container.querySelector('[data-ds-fill="shadcn@aria/frames.app-shell"]')).toBeInTheDocument();
  expect(container.querySelector('[data-slot="sidebar-inner"]')).toBeInTheDocument();
  expect(container.querySelector('[data-slot="sidebar-inset"]')).toBeInTheDocument();
  expect(screen.getAllByRole("main")).toHaveLength(1);
  expect(screen.getByRole("main")).toHaveAttribute("tabindex", "-1");
  expect(screen.getByRole("navigation", { name: "Workspace" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Home" })).toHaveAttribute("aria-current", "page");
  expect(screen.getByText("Workspace content")).toBeInTheDocument();
});

it("retains controlled sidebar state and the host action instead of aliasing Foundry AppFrame", () => {
  const props = fixture(), change = vi.fn(); props.navigation.collapsed = false; props.navigation.onCollapsedChange = change;
  const { container } = render(<ShadcnAppShell {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "Close navigation" }));
  expect(change).toHaveBeenCalledWith(true);
  expect(container.querySelector('[data-slot="sidebar"]')).toHaveAttribute("data-state", "expanded");
  fireEvent.click(screen.getByRole("button", { name: "Draft" }));
  expect(props.navigation.tree[1]!.children![0]!.onAction).toHaveBeenCalledOnce();
});

it("opens the real command dialog and keeps the consumer theme controlled", () => {
  const props = fixture(); props.theme = { preference: "dark", onPreferenceChange: vi.fn() };
  render(<ShadcnAppShell {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "Find command" }));
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  expect(screen.getByRole("combobox", { name: "Search" })).toBeInTheDocument();
  expect(document.documentElement).toHaveAttribute("data-theme", "dark");
});

it("keeps loading content in the main region while navigation stays mounted", () => {
  const props = fixture(); props.state = { main: "loading", navigating: true }; props.stateViews = { loading: <p>Loading view</p> }; props.progress = <p>Progress view</p>;
  render(<ShadcnAppShell {...props} />);
  expect(screen.getByText("Loading view")).toBeInTheDocument();
  expect(screen.queryByText("Workspace content")).not.toBeInTheDocument();
  expect(screen.getByRole("navigation", { name: "Workspace" })).toBeInTheDocument();
  expect(screen.getByText("Progress view")).toBeInTheDocument();
});

it("opens the selected narrow sheet and closes it after a navigation action", () => {
  Object.defineProperty(window, "innerWidth", { value: 375, configurable: true });
  vi.stubGlobal("matchMedia", vi.fn((media: string) => ({ media, matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })));
  const props = fixture(), drawer = vi.fn(); props.navigation.onDrawerOpenChange = drawer;
  render(<ShadcnAppShell {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "Open navigation" }));
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  expect(drawer).toHaveBeenCalledWith(true);
  fireEvent.click(screen.getByRole("button", { name: "Draft" }));
  expect(drawer).toHaveBeenLastCalledWith(false);
});

it("bridges the source surface's direct change port to the nested navigation control", () => {
  const props = fixture(), change = vi.fn(); props.navigation.collapsed = false;
  render(<ShadcnAppShell {...props} onSidebarCollapsedChange={change} />);
  fireEvent.click(screen.getByRole("button", { name: "Close navigation" }));
  expect(change).toHaveBeenCalledWith(true);
});
