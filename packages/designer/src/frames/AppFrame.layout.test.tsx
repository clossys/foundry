// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToString } from "react-dom/server";
import { hydrateRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PageHeaderModule, SlotModule } from "../shell/index.js";
import { TOKENS } from "../tokens/index.js";
import { AppFrame } from "./AppFrame.js";
import { APP_FRAME_NAVIGATION_SIZE, APP_FRAME_WIDE_QUERY } from "./app-frame-layout.js";
import type { AppFrameProps } from "./app-frame-types.js";

const nativeBounds = HTMLElement.prototype.getBoundingClientRect;
let viewport: number;
let reduced: boolean;
let forced: boolean;
let listeners: Set<() => void>;
beforeEach(() => {
  viewport = 1440; reduced = forced = false; listeners = new Set();
  localStorage.clear();
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function(this: HTMLElement) {
    return this.hasAttribute("data-application-frame") ? new DOMRect(0, 0, viewport, 900) : nativeBounds.call(this);
  });
  Object.defineProperty(window, "innerWidth", { configurable: true, get: () => viewport });
  vi.stubGlobal("CSS", { supports: () => true, escape: (value: string) => value });
  vi.stubGlobal("matchMedia", (media: string) => ({ media, get matches() {
    if (media === APP_FRAME_WIDE_QUERY) return viewport >= Number.parseFloat(TOKENS["--breakpoint-tablet-lg"]!.value);
    if (media === "(prefers-reduced-transparency: reduce)") return reduced;
    if (media === "(forced-colors: active)") return forced;
    return media === "all";
  }, addEventListener: (_: string, callback: () => void) => listeners.add(callback), removeEventListener: (_: string, callback: () => void) => listeners.delete(callback) }));
});
afterEach(() => {
  cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals();
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.style.removeProperty("color-scheme");
});
function fixture(): AppFrameProps {
  return {
    brand: { markSrc: "/mark.svg", wordmark: "Workspace", label: "Workspace home", href: "#home" },
    navigation: { tree: [{ id: "home", label: "Home", href: "#home" }], label: "Workspace navigation", navigationKey: "home" },
    account: { signedOutLabel: "Account", sections: [] },
    commands: { heading: "Commands", triggerLabel: "Find commands", searchLabel: "Search commands", closeLabel: "Close commands", emptyMessage: "No commands", groups: [] },
    mainId: "canvas", children: <div style={{ height: "100%", overflow: "auto" }} data-testid="view-scroll"><button>Canvas action</button></div>,
    context: <button>Switch project</button>,
    toasts: <section aria-label="Notifications"><p role="status">Saved</p></section>,
  };
}
function region(name: string) { return document.querySelector<HTMLElement>(`[data-application-frame-region="${name}"]`)!; }
function resize(width: number) {
  act(() => { viewport = width; for (const listener of listeners) listener(); window.dispatchEvent(new Event("resize")); });
}

describe("AppFrame reserved layout", () => {
  it("consumes a page header lease inside the real Frame and drops it when the lease ends", () => {
    const view = render(<AppFrame {...fixture()}><PageHeaderModule id="page" header={{ title: "Leased page", nav: { label: "Page views", activeId: "one", items: [{ id: "one", label: "Overview", href: "#overview" }] }, actions: { render: ({ compact }) => <button>Action {String(compact)}</button> } }} /></AppFrame>);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("heading", { name: "Leased page" })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Page views" })).toBeInTheDocument();
    expect(region("header")).toContainElement(screen.getByRole("button", { name: "Action false" }));
    // The frame takes no header prop: without a lease there is no page heading at all.
    view.rerender(<AppFrame {...fixture()} />);
    expect(screen.queryByRole("heading", { name: "Leased page" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Action false/ })).toBeNull();
  });
  it("reserves separate header, stage and dock rows inside the definite-height host", () => {
    render(<AppFrame {...fixture()} notices={[{ id: "saved", severity: "info", text: "Project saved" }]}><PageHeaderModule id="page" header={{ title: "Project canvas" }} /></AppFrame>);
    expect(document.querySelector("[data-application-frame]")).toHaveClass("h-full", "overflow-hidden");
    expect(region("stage")).toHaveClass("relative", "isolate", "flex-1", "overflow-hidden");
    expect(screen.getByRole("main")).toHaveClass("h-full", "overflow-auto");
    // cross-10: page content sits on the 16/24 spacing-scale inset (the named frame-main-inset); a bleeding canvas child drops it.
    expect(screen.getByRole("main")).toHaveClass("frame-main-inset", "frame-main-bleed");
    expect(readFileSync(resolve(import.meta.dirname, "../../styles/theme-keys.css"), "utf8")).toMatch(/@utility frame-main-inset \{\s*padding: var\(--spacing-lg, 16px\);\s*@media \(width >= 1024px\) \{ padding: var\(--spacing-xl, 24px\); \}\s*\}/);
    expect(region("header").parentElement).toBe(region("stage").parentElement);
    expect(region("stage").nextElementSibling).toBe(region("dock"));
    expect(region("dock")).toHaveClass("shrink-0");
    expect(screen.getByRole("heading", { level: 1, name: "Project canvas" })).toBeInTheDocument();
    expect(within(screen.getByRole("banner")).queryByRole("link", { name: "Workspace home" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Use .* width/ })).toBeNull();
  });
  it("keeps the View mounted while the sidebar pushes open and closed", async () => {
    render(<AppFrame {...fixture()} />);
    const view = screen.getByTestId("view-scroll");
    expect(region("navigation")).toHaveClass(...APP_FRAME_NAVIGATION_SIZE.docked.split(" "));
    await userEvent.click(screen.getByRole("button", { name: "Close navigation" }));
    expect(region("navigation").className).toMatch(/ frame-region-closed$/);
    expect(region("navigation")).toHaveAttribute("inert");
    expect(screen.getByTestId("view-scroll")).toBe(view);
    await userEvent.click(screen.getByRole("button", { name: "Open navigation" }));
    expect(region("navigation")).not.toHaveAttribute("inert");
    expect(screen.getByTestId("view-scroll")).toBe(view);
  });
  it("keeps module tabs and zoom in the dock, expands a host-bounded panel and resizes its height", async () => {
    render(<AppFrame {...fixture()} dock={{ label: "Page modules", handleLabel: "Resize modules", min: 100, max: 400, defaultValue: 200 }}>
      <SlotModule id="explorer" slot="dock-tab" label="Explorer"><button>Explorer item</button></SlotModule>
      <SlotModule id="map" slot="dock-tab" label="Map"><p>Map content</p></SlotModule>
      <SlotModule id="zoom" slot="dock-strip" label="Zoom"><button>Zoom in</button></SlotModule>
    </AppFrame>);
    expect(region("dock")).toContainElement(screen.getByRole("tab", { name: "Explorer" }));
    expect(region("dock")).toContainElement(screen.getByRole("button", { name: "Zoom in" }));
    expect(screen.queryByRole("button", { name: "Explorer item" })).toBeNull();
    // studio-12: tabs and the expand toggle share the small control height (28px box, 44px hit area).
    for (const tab of screen.getAllByRole("tab")) { expect(tab).toHaveClass("control-h-sm"); expect(tab.className).not.toContain("min-h-[var(--ui-layout-tap-target)]"); }
    const toggle = screen.getByRole("button", { name: "Expand page modules" });
    expect(toggle).toHaveClass("icon-control-sm", "rounded-control");
    expect(toggle).not.toHaveClass("icon-control-md");
    await userEvent.click(screen.getByRole("tab", { name: "Explorer" }));
    expect(region("dock")).toContainElement(screen.getByRole("button", { name: "Explorer item" }));
    const pane = screen.getByRole("region", { name: "Page modules" });
    expect(pane.style.blockSize).toBe("200px");
    const handle = screen.getByRole("separator", { name: "Resize modules" });
    handle.focus(); await userEvent.keyboard("{ArrowUp}");
    expect(pane.style.blockSize).not.toBe("200px");
    await userEvent.click(screen.getByRole("tab", { name: "Map" }));
    expect(screen.getByText("Map content")).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Collapse page modules" }));
    expect(screen.queryByRole("region", { name: "Page modules" })).toBeNull();
    expect(screen.getByRole("button", { name: "Zoom in" })).toBeVisible();
  });
  it("keeps severity-sorted notices in flow, refuses error dismissal and remembers a dismissal for this session", async () => {
    const props = { ...fixture(), notices: [
      { id: "old", severity: "info" as const, text: "Old information" },
      { id: "warning", severity: "warning" as const, text: "Warning message" },
      { id: "error", severity: "error" as const, text: "Error message" },
      { id: "new", severity: "success" as const, text: "New success" },
    ] };
    sessionStorage.clear(); const view = render(<AppFrame {...props} />);
    const messages = region("dock").querySelector("[data-frame-notices]")!;
    expect(messages.textContent).toBe("Error messageWarning messageNew success");
    expect(within(screen.getByText("Error message").closest('[role="alert"]')!).queryByRole("button")).toBeNull();
    await userEvent.click(within(screen.getByText("Warning message").closest('[role="status"]')!).getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByText("Warning message")).toBeNull();
    expect(screen.getByText("Old information")).toBeVisible();
    view.unmount(); render(<AppFrame {...props} />);
    expect(screen.queryByText("Warning message")).toBeNull();
    expect(screen.getByText("Error message")).toBeVisible();
  });
  it("keeps a non-dismissible pending notice in view with no dismiss control, even after an earlier dismissal of its id", () => {
    sessionStorage.setItem("frame-dismissed-notices", JSON.stringify(["pending"]));
    render(<AppFrame {...fixture()} notices={[{ id: "pending", severity: "info", text: "Route pending", dismissible: false }]} />);
    const notice = screen.getByText("Route pending").closest('[role="status"]')!;
    expect(notice).toBeVisible();
    expect(within(notice as HTMLElement).queryByRole("button", { name: "Dismiss" })).toBeNull();
    sessionStorage.clear();
  });
  // Below the sidebar-overlay breakpoint the dock is a bottom sheet instead (D8): FrameDock.sheet.test.tsx.
  it.each([1024, 1440])("reserves a measured resizable dock below the stage at width %s without a modal", async width => {
    viewport = width;
    let frameHeight = 600;
    const original = nativeBounds;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function(this: HTMLElement) {
      if (this.hasAttribute("data-application-frame")) return new DOMRect(0, 0, width, frameHeight);
      if (this.dataset.applicationFrameRegion === "header") return new DOMRect(0, 0, width, 64);
      if (this.hasAttribute("data-frame-notices")) return new DOMRect(0, 0, width, 48);
      if (this.hasAttribute("data-frame-dock-strip")) return new DOMRect(0, 0, width, 44);
      return original.call(this);
    });
    render(<AppFrame {...fixture()} notices={[{ id: "notice", severity: "info", text: "Page notice" }]}><SlotModule id="map" slot="dock-tab" label="Map"><button>Map action</button></SlotModule></AppFrame>);
    await userEvent.click(screen.getByRole("tab", { name: "Map" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    const panel = screen.getByRole("region", { name: "Page modules" });
    expect(region("dock")).toContainElement(panel);
    expect(region("stage").nextElementSibling).toBe(region("dock"));
    expect(region("stage")).toHaveClass("flex-1", "min-h-0");
    expect(region("dock")).toHaveClass("shrink-0");
    expect(panel.style.blockSize).toBe("240px");
    const handle = screen.getByRole("separator", { name: "Page modules" });
    handle.focus(); await userEvent.keyboard("{Home}"); expect(panel.style.blockSize).toBe("160px");
    await userEvent.keyboard("{End}"); expect(panel.style.blockSize).toBe("444px");
    frameHeight = 240; act(() => window.dispatchEvent(new Event("resize")));
    expect(panel.style.blockSize).toBe("84px");
    expect(handle).toHaveAttribute("aria-valuemin", "84"); expect(handle).toHaveAttribute("aria-valuemax", "84");
    frameHeight = 900; act(() => window.dispatchEvent(new Event("resize")));
    await userEvent.keyboard("{End}");
    expect(panel.style.blockSize).toBe("480px");
    expect(handle).toHaveAttribute("aria-valuemin", "160"); expect(handle).toHaveAttribute("aria-valuemax", "480");
    expect(screen.getByRole("button", { name: "Map action" })).toBeVisible();
  });
  it("hydrates one page header, stage and leased module registry without recoverable errors", async () => {
    const tree = <AppFrame {...fixture()}><PageHeaderModule id="page" header={{ title: "Project canvas" }} /><SlotModule id="zoom" slot="dock-strip" label="Zoom"><button>Zoom in</button></SlotModule></AppFrame>;
    const host = document.createElement("div"); host.innerHTML = renderToString(tree); document.body.append(host);
    const recoverable = vi.fn(); let root: ReturnType<typeof hydrateRoot> | undefined;
    try {
      await act(async () => { root = hydrateRoot(host, tree, { onRecoverableError: recoverable }); });
      expect(recoverable).not.toHaveBeenCalled();
      expect(within(host).getAllByRole("main")).toHaveLength(1);
      expect(within(host).getByRole("button", { name: "Zoom in" })).toBeInTheDocument();
    } finally { await act(async () => root?.unmount()); host.remove(); }
  });
});
