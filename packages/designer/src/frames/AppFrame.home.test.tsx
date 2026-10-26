// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppFrame } from "./AppFrame.js";
import { PageHeaderModule } from "../shell/FrameSlots.js";
import type { AppFrameProps } from "./app-frame-types.js";
beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("matchMedia", (media: string) => ({ media, matches: media.includes("min-width") || media === "all", addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function fixture(): AppFrameProps {
  return { brand: { markSrc: "/example-mark.svg", wordmark: "Example", label: "Example console", href: "/tools/designer" }, navigation: { tree: [{ id: "nav.designer", label: "Designer", href: "/tools/designer" }], label: "Tools" }, account: { signedOutLabel: "Signed out", sections: [] }, commands: { heading: "Commands", triggerLabel: "Commands", searchLabel: "Search", closeLabel: "Close", emptyMessage: "Empty", groups: [] }, children: <p>Content</p> };
}
describe("Frame-owned native brand home link", () => {
  it.each(["no-page", "fallback", "leased", "collapsed", "narrow"])("preserves the supplied home destination and accessible label with %s", mode => {
    if (mode === "narrow") vi.stubGlobal("matchMedia", (media: string) => ({ media, matches: media === "all", addEventListener() {}, removeEventListener() {} }));
    const props = fixture();
    if (mode === "fallback") props.header = { title: "Fallback" };
    if (mode === "collapsed") props.navigation.defaultCollapsed = true;
    render(<AppFrame {...props}>{mode === "leased" ? <PageHeaderModule id="example.current" header={{ title: "Leased page" }} /> : props.children}</AppFrame>);
    const link = screen.getByRole("link", { name: "Example console" });
    // This mirrors the retained consumer assertion with neutral public fixture values.
    expect(document.querySelector('[aria-label="Example console"]')?.getAttribute("href")).toBe("/tools/designer");
    expect(link).toHaveAttribute("href", props.brand.href);
    expect(screen.getAllByRole("link", { name: "Example console" })).toHaveLength(1);
    expect(link.closest('[data-application-frame-region="navigation"]')).toBeNull();
    expect(link.closest('[data-application-navigation-region="footer"]')).toBeNull();
    expect(within(screen.getByRole("banner")).queryByRole("link", { name: "Example console" })).toBeNull();
    expect(screen.getAllByRole("main")).toHaveLength(1);
    expect(document.querySelectorAll('img[src="/example-mark.svg"]').length).toBeLessThanOrEqual(1);
    if (mode === "leased") expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });
  it("delegates primary click and Enter through the existing asynchronous host navigation seam", async () => {
    const navigate = vi.fn().mockResolvedValue(undefined);
    render(<AppFrame {...fixture()} onNavigate={navigate} />);
    const link = screen.getByRole("link", { name: "Example console" });
    expect(fireEvent.click(link, { button: 0 })).toBe(false);
    await waitFor(() => expect(navigate).toHaveBeenCalledExactlyOnceWith("/tools/designer"));
    link.focus(); await userEvent.keyboard("{Enter}");
    await waitFor(() => expect(navigate).toHaveBeenCalledTimes(2));
  });
  it("retains native modified, secondary, download and nonself activations without calling the host", () => {
    const navigate = vi.fn(); render(<AppFrame {...fixture()} onNavigate={navigate} />);
    const link = screen.getByRole("link", { name: "Example console" });
    for (const event of [{ metaKey: true }, { ctrlKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }]) expect(fireEvent.click(link, { button: 0, ...event })).toBe(true);
    link.setAttribute("target", "_blank"); expect(fireEvent.click(link, { button: 0 })).toBe(true); link.removeAttribute("target");
    link.setAttribute("download", ""); expect(fireEvent.click(link, { button: 0 })).toBe(true);
    expect(navigate).not.toHaveBeenCalled();
  });
  it("keeps failed flush on this page and supplies no interactive destination when href is absent", async () => {
    const navigate = vi.fn().mockRejectedValue(new Error("SYNTHETIC failed host flush"));
    const view = render(<AppFrame {...fixture()} onNavigate={navigate} />);
    expect(fireEvent.click(screen.getByRole("link", { name: "Example console" }), { button: 0 })).toBe(false);
    await waitFor(() => expect(navigate).toHaveBeenCalledExactlyOnceWith("/tools/designer"));
    const props = fixture(); delete props.brand.href; view.rerender(<AppFrame {...props} />);
    expect(screen.queryByRole("link", { name: "Example console" })).toBeNull();
  });
});
