// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { APP_FRAME_WIDE_QUERY } from "./app-frame-layout.js";
import { AppFrame } from "./AppFrame.js";
import type { AppFrameProps } from "./app-frame-types.js";

// Sealed against the merged AppFrame before extracting PageBar. Snapshot complete,
// unnormalized markup, including generated IDs, class order, styles and ARIA.
let wide: boolean;
let forcedColors: boolean;
let reducedTransparency: boolean;
beforeEach(() => {
  localStorage.clear();
  wide = true;
  forcedColors = false;
  reducedTransparency = false;
  Object.defineProperty(window, "innerWidth", { configurable: true, get: () => wide ? 1280 : 320 });
  vi.stubGlobal("matchMedia", vi.fn((media: string) => ({
    media,
    get matches() {
      if (media === APP_FRAME_WIDE_QUERY) return wide;
      if (media === "(forced-colors: active)") return forcedColors;
      if (media === "(prefers-reduced-transparency: reduce)") return reducedTransparency;
      return media === "all";
    },
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
  })));
  vi.stubGlobal("CSS", { supports: vi.fn(() => true), escape: (value: string) => value });
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
});
afterEach(() => {
  cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals();
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.style.removeProperty("color-scheme");
});

function fixture(): AppFrameProps {
  return {
    brand: { markSrc: "/mark.svg", wordmark: "Workspace", label: "Workspace", href: "/" },
    navigation: { tree: [{ id: "projects", label: "Projects", href: "/projects" }], activeId: "projects", label: "Workspace navigation" },
    account: { signedOutLabel: "Signed out", sections: [] },
    commands: { heading: "Commands", triggerLabel: "Find commands", searchLabel: "Search commands", closeLabel: "Close commands", emptyMessage: "No commands", groups: [] },
    children: <p>Report content</p>,
  };
}
function sample(): AppFrameProps {
  return {
    ...fixture(),
    page: {
      title: "Quarterly report",
      breadcrumb: [
        { id: "projects", label: "Projects", href: "/projects" },
        { id: "reporting", label: "Reporting", href: "/projects/reporting", siblings: [{ id: "planning", label: "Planning", href: "/projects/planning" }] },
        { id: "quarterly", label: "Quarterly report", siblings: [{ id: "annual", label: "Annual report", href: "/projects/reporting/annual" }] },
      ],
      status: "Draft", description: "Revenue and usage for the last three months.", updatedAt: "Updated 2 hours ago",
      meta: "Reporting period: July to September", scope: "All projects",
      actions: [
        { id: "share", label: "Share", primary: true, onAction() {} },
        { id: "export", label: "Export", primary: true, href: "/projects/reporting/quarterly/export" },
        { id: "archive", label: "Archive", onAction() {} },
      ],
    },
    workspaces: [{ id: "operations", label: "Operations", href: "/operations" }, { id: "research", label: "Research", href: "/research" }],
  };
}
function serverBar(props: AppFrameProps): string {
  const container = document.createElement("div");
  container.innerHTML = renderToString(<AppFrame {...props} />);
  const bar = container.querySelector('[data-application-frame-region="bar"]');
  expect(bar).not.toBeNull();
  return bar!.outerHTML;
}
function bar(): HTMLElement {
  const element = document.querySelector<HTMLElement>('[data-application-frame-region="bar"]');
  expect(element).not.toBeNull();
  return element!;
}

describe("AppFrame PageBar composition", () => {
  it("forwards page metadata, information and original native action hrefs", async () => {
    render(<AppFrame {...sample()} />);
    expect(screen.getByRole("heading", { level: 1, name: "Quarterly report" })).toBeInTheDocument();
    expect(within(bar()).getByRole("link", { name: "Export" })).toHaveAttribute("href", "/projects/reporting/quarterly/export");
    await userEvent.click(screen.getByRole("button", { name: "Page information" }));
    expect(screen.getByText("Revenue and usage for the last three months.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Use .* width/ })).toBeNull();
  });
  it("forwards page-level title, centered navigation and actions without a header brand", () => {
    render(<AppFrame {...fixture()} header={{ title: "Overview", nav: { label: "Views", activeId: "board", items: [{ id: "board", label: "Board", href: "/board" }] }, actions: { render: () => <button>Publish</button> } }} />);
    expect(within(bar()).getByRole("heading", { level: 1, name: "Overview" })).toBeInTheDocument();
    expect(within(bar()).getByRole("link", { name: "Board" })).toHaveAttribute("aria-current", "page");
    expect(within(bar()).getByRole("button", { name: "Publish" })).toBeInTheDocument();
    expect(within(bar()).queryByRole("link", { name: "Workspace" })).toBeNull();
  });
});
