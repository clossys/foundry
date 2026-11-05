import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FrameSlotProvider } from "../shell/FrameSlots.js";
import { PageBar, type PageBarHeader } from "./PageBar.js";

let available = 1440;
const measurements = new Set<() => void>();
beforeEach(() => {
  available = 1440;
  vi.stubGlobal("matchMedia", (media: string) => ({ media, matches: false, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal("ResizeObserver", class {
    callback: () => void;
    constructor(callback: ResizeObserverCallback) {
      this.callback = () => callback([], this as unknown as ResizeObserver);
      measurements.add(this.callback);
    }
    observe() {} unobserve() {} disconnect() { measurements.delete(this.callback); }
  });
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function(this: HTMLElement) { return this.hasAttribute("data-frame-header-overflow") ? available : 0; });
  vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockImplementation(function(this: HTMLElement) {
    if (this.tagName === "NAV") return 400;
    if (this.tagName === "H1") return 100;
    if (this.hasAttribute("data-frame-header-actions")) return this.querySelector('[data-compact="true"]') ? 44 : 200;
    return 0;
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); measurements.clear(); });
const header: PageBarHeader = {
  title: "Workspace",
  nav: { label: "Workspace views", activeId: "second", items: [{ id: "first", label: "First", href: "#first" }, { id: "second", label: "Second", href: "#second" }] },
  actions: { render: ({ compact }) => <button data-compact={compact} aria-label="Open context">{compact ? "+" : "Open context"}</button> },
};
function Fixture({ onNavigate }: { onNavigate?: (href: string) => Promise<void> }) {
  return <FrameSlotProvider><PageBar root={{ label: "Root" }} labels={{ breadcrumb: "Trail", collapsedBreadcrumb: "Earlier", pageInfo: "Information", pageActions: "Actions" }} header={header} onNavigate={onNavigate} /></FrameSlotProvider>;
}
function measure(width: number) { act(() => { available = width; for (const callback of measurements) callback(); }); }
describe("page-level header slots", () => {
  it("ships both measured header column layouts in the portable compiled stylesheet", () => {
    const css = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../../styles/compiled.css"), "utf8");
    expect(css).toMatch(/\.frame-header-grid\s*\{\s*grid-template-columns: minmax\(0, 1fr\) auto minmax\(0, 1fr\);/);
    expect(css).toMatch(/\.frame-header-grid\[data-frame-header-overflow="navigation"\]\s*\{\s*grid-template-columns: minmax\(0, 1fr\) auto;/);
  });
  it("centers nav independently of the title/actions and marks the active native link", () => {
    render(<Fixture />);
    expect(screen.getByRole("heading", { level: 1, name: "Workspace" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Second" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Second" })).toHaveAttribute("data-selected", "true");
    expect(screen.getByRole("link", { name: "First" })).not.toHaveAttribute("data-selected");
    expect(screen.getByRole("link", { name: "First" })).not.toHaveAttribute("aria-current");
    expect(document.querySelector("[data-frame-header-overflow]")).toHaveClass("frame-header-grid");
    expect(screen.getByRole("button", { name: "Open context" })).toHaveAttribute("data-compact", "false");
  });
  it("measures actions first, then one title/tab menu, and restores the full header when capacity returns", async () => {
    render(<Fixture />);
    measure(660);
    expect(screen.getByRole("button", { name: "Open context" })).toHaveAttribute("data-compact", "true");
    expect(document.querySelector("[data-frame-header-overflow]")).toHaveAttribute("data-frame-header-overflow", "actions");
    measure(390);
    expect(document.querySelector("[data-frame-header-overflow]")).toHaveAttribute("data-frame-header-overflow", "navigation");
    const titleMenu = screen.getByRole("button", { name: "Workspace / Second" });
    expect(titleMenu.style.minBlockSize).toContain("--ui-layout-tap-target");
    await userEvent.click(titleMenu);
    expect(screen.getByRole("menuitem", { name: "First" })).toHaveAttribute("href", "#first");
    expect(screen.getByRole("menuitem", { name: "Second" })).toHaveAttribute("aria-current", "page");
    await userEvent.keyboard("{Escape}");
    measure(1440);
    expect(screen.getByRole("navigation", { name: "Workspace views" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open context" })).toHaveAttribute("data-compact", "false");
  });
  it("routes an ordinary header link through the host flush callback", async () => {
    const navigate = vi.fn().mockResolvedValue(undefined); render(<Fixture onNavigate={navigate} />);
    await userEvent.click(screen.getByRole("link", { name: "First" }));
    await waitFor(() => expect(navigate).toHaveBeenCalledExactlyOnceWith("#first"));
  });
  it("retains native menu hrefs and routes an ordinary collapsed-menu link through the host", async () => {
    const navigate = vi.fn().mockResolvedValue(undefined);
    render(<Fixture onNavigate={navigate} />);
    measure(390);
    await userEvent.click(screen.getByRole("button", { name: "Workspace / Second" }));
    const first = screen.getByRole("menuitem", { name: "First" });
    expect(first).toHaveAttribute("href", "#first");
    await userEvent.click(first);
    await waitFor(() => expect(navigate).toHaveBeenCalledExactlyOnceWith("#first"));
  });
});
