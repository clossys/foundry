import { Fragment } from "react";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as blocks from "./index.js";
import type { PageBarProps, PageBarPage } from "./PageBar.js";
import { AppFrame } from "../frames/AppFrame.js";
import { APP_FRAME_WIDE_QUERY } from "../frames/app-frame-layout.js";
import type { AppFrameProps } from "../frames/app-frame-types.js";

const PageBar = (blocks as typeof blocks & { PageBar: (props: PageBarProps) => React.ReactNode }).PageBar;
const labels = { breadcrumb: "Report trail", collapsedBreadcrumb: "Earlier report levels", pageInfo: "Report information", pageActions: "Other report actions" };
const root = { label: "Workspace", href: "/" };
const workspaces = [{ id: "operations", label: "Operations", href: "/operations" }, { id: "research", label: "Research", href: "/research" }];
function page(): PageBarPage {
  return { title: "Quarterly report", breadcrumb: [
    { id: "projects", label: "Projects", href: "/projects" },
    { id: "reporting", label: "Reporting", href: "/projects/reporting", siblings: [{ id: "planning", label: "Planning", href: "/projects/planning" }] },
    { id: "quarterly", label: "Quarterly report", siblings: [{ id: "annual", label: "Annual report", href: "/projects/reporting/annual" }] },
  ], status: "Draft", description: "Revenue and usage for the last three months.", updatedAt: "Updated 2 hours ago", meta: "Reporting period: July to September", scope: "All projects",
  actions: [{ id: "share", label: "Share", primary: true, onAction: vi.fn() }, { id: "export", label: "Export", primary: true, href: "/projects/reporting/quarterly/export" }, { id: "archive", label: "Archive", onAction: vi.fn() }] };
}
let forced: boolean, reduced: boolean, supports: boolean;
let mediaListeners: Set<() => void>;
let resizeObservers: Map<Element, ResizeObserverCallback>;
beforeEach(() => {
  forced = reduced = false; supports = true;
  mediaListeners = new Set(); resizeObservers = new Map();
  localStorage.clear();
  vi.stubGlobal("matchMedia", (media: string) => ({ media, get matches() {
    return media === "(forced-colors: active)" ? forced : media === "(prefers-reduced-transparency: reduce)" ? reduced : media === "all" || media === APP_FRAME_WIDE_QUERY;
  }, addEventListener: (_: string, callback: () => void) => mediaListeners.add(callback), removeEventListener: (_: string, callback: () => void) => mediaListeners.delete(callback) }));
  vi.stubGlobal("CSS", { supports: () => supports, escape: (value: string) => value });
  vi.stubGlobal("ResizeObserver", class {
    constructor(private callback: ResizeObserverCallback) {}
    observe(target: Element) { resizeObservers.set(target, this.callback); }
    unobserve(target: Element) { resizeObservers.delete(target); }
    disconnect() { for (const [target, callback] of resizeObservers) if (callback === this.callback) resizeObservers.delete(target); }
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.documentElement.removeAttribute("data-theme"); document.documentElement.removeAttribute("dir"); });
function standalone(props: Partial<PageBarProps> = {}) {
  expect(PageBar).toBeTypeOf("function");
  return render(<PageBar root={root} labels={labels} {...props} />);
}
const bar = () => document.querySelector<HTMLElement>('[data-application-frame-region="bar"]')!;

describe("PageBar", () => {
  it("M1/M8: owns one current h1 and gives only the first primary request primary styling", async () => {
    const supplied = page(); standalone({ page: supplied, workspaces });
    expect(within(bar()).getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(within(bar()).getByRole("heading", { name: supplied.title })).toHaveAttribute("aria-current", "page");
    expect(bar().querySelectorAll('[data-application-frame-action="primary"]')).toHaveLength(1);
    expect(within(bar()).getByRole("button", { name: "Share" })).toHaveAttribute("data-application-frame-action", "primary");
    expect(within(bar()).getByRole("link", { name: "Export" })).toHaveAttribute("data-application-frame-action", "secondary");
    await userEvent.click(within(bar()).getByRole("button", { name: "Archive" }));
    expect(supplied.actions![2]!.onAction).toHaveBeenCalledOnce();
  });
  it("leads with accessible context before the host-rooted trail and renders no brand slot", async () => {
    // A retired brand value supplied by an untyped host is not rendered at the old leading position.
    const view = standalone({ brand: <a href="#brand">Workspace mark</a>, context: <button>Switch project</button>, page: { title: "Project report" } } as Partial<PageBarProps>);
    expect(within(bar()).queryByRole("link", { name: "Workspace mark" })).toBeNull();
    expect(bar().querySelector('a[href="#brand"]')).toBeNull();
    const context = within(bar()).getByRole("button", { name: "Switch project" });
    const trail = within(bar()).getByRole("navigation", { name: labels.breadcrumb });
    expect(context.parentElement).toBe(bar().firstElementChild);
    expect(context.parentElement?.nextElementSibling).toBe(trail);
    expect(within(bar()).getAllByRole("heading", { level: 1 })).toHaveLength(1);
    context.focus(); await userEvent.tab(); expect(within(trail).getByRole("link", { name: root.label })).toHaveFocus();
    view.rerender(<PageBar root={root} labels={labels} context={<button>Switch project</button>} />);
    expect(within(bar()).getByRole("button", { name: "Switch project" })).toBeInTheDocument();
    expect(within(bar()).queryByRole("heading")).not.toBeInTheDocument();
    expect(within(bar()).queryByRole("navigation")).not.toBeInTheDocument();
  });
  it("omits the trail root when no host root is supplied", () => {
    standalone({ root: undefined, page: { title: "Project report", breadcrumb: [{ id: "projects", label: "Projects", href: "/projects" }] } });
    const trail = within(bar()).getByRole("navigation", { name: labels.breadcrumb });
    expect(within(trail).queryByRole("link", { name: root.label })).toBeNull();
    expect(within(trail).getByRole("link", { name: "Projects" })).toHaveAttribute("href", "/projects");
  });
  it("M4: follows forced colors and reduced transparency on initial render and media changes", () => {
    standalone();
    expect(bar()).toHaveClass("bg-surface-glass");
    expect(bar().style.backdropFilter).toContain("blur(");
    act(() => { forced = true; for (const sync of mediaListeners) sync(); });
    expect(bar()).toHaveClass("bg-surface-raised"); expect(bar().style.backdropFilter).toBe("none");
    act(() => { forced = false; reduced = true; for (const sync of mediaListeners) sync(); });
    expect(bar()).toHaveClass("bg-surface-raised"); expect(bar().style.backdropFilter).toBe("none");
    act(() => { reduced = false; for (const sync of mediaListeners) sync(); });
    expect(bar()).toHaveClass("bg-surface-glass");
  });
  it("falls back without backdrop support and accepts prefixed support", () => {
    supports = false; const view = standalone();
    expect(bar()).toHaveClass("bg-surface-raised"); view.unmount();
    vi.stubGlobal("CSS", { supports: (property: string) => property === "-webkit-backdrop-filter" });
    standalone(); expect(bar()).toHaveClass("bg-surface-glass");
  });
  it("M5: omits the trail and information for no page, and information for title-only pages", () => {
    const view = standalone();
    expect(within(bar()).queryByRole("navigation")).not.toBeInTheDocument();
    expect(within(bar()).queryByRole("button", { name: labels.pageInfo })).not.toBeInTheDocument();
    view.rerender(<PageBar root={root} labels={labels} page={{ title: "Quarterly report" }} />);
    expect(within(bar()).queryByRole("button", { name: labels.pageInfo })).not.toBeInTheDocument();
  });
  it("M6: collapses ancestors and overflows every non-primary action in narrow layout", async () => {
    standalone({ page: page(), narrow: true });
    expect(within(bar()).queryByRole("link", { name: "Projects" })).not.toBeInTheDocument();
    expect(within(bar()).queryByRole("link", { name: "Export" })).not.toBeInTheDocument();
    expect(bar().querySelector('[data-application-frame-region="bar-actions"]')).toHaveStyle({ flexBasis: "100%" });
    await userEvent.click(within(bar()).getByRole("button", { name: labels.collapsedBreadcrumb }));
    expect(await screen.findByRole("menuitem", { name: "Projects" })).toHaveAttribute("href", "/projects");
    expect(screen.getByRole("menuitem", { name: "Planning" })).toHaveAttribute("href", "/projects/planning");
    await userEvent.keyboard("{Escape}");
    await userEvent.click(within(bar()).getByRole("button", { name: labels.pageActions }));
    expect(await screen.findByRole("menuitem", { name: "Export" })).toHaveAttribute("href", "/projects/reporting/quarterly/export");
    expect(screen.getByRole("menuitem", { name: "Archive" })).toBeInTheDocument();
  });
  it.each([[false, false], [true, false], [false, true], [true, true]])("M7: reserves start=%s and end=%s independently", (reserveStart, reserveEnd) => {
    standalone({ reserveStart, reserveEnd });
    const gap = "var(--spacing-sm, 8px)", reserved = "calc(var(--ui-layout-tap-target, 44px) + var(--spacing-sm, 8px))";
    expect(bar().style.paddingInlineStart).toBe(reserveStart ? reserved : gap);
    expect(bar().style.paddingInlineEnd).toBe(reserveEnd ? reserved : gap);
  });
  it("M9: opens a workspace menu and current-page siblings with real keyboard actions", async () => {
    standalone({ page: page(), workspaces });
    const user = userEvent.setup(); const workspace = within(bar()).getByRole("button", { name: root.label });
    act(() => workspace.focus()); await user.keyboard("{Enter}");
    expect(await screen.findByRole("menuitem", { name: "Operations" })).toHaveAttribute("href", "/operations");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(workspace).toHaveFocus());
    await user.click(within(bar()).getByRole("button", { name: "Quarterly report" }));
    expect(await screen.findByRole("menuitem", { name: "Annual report" })).toHaveAttribute("href", "/projects/reporting/annual");
  });
  it("M11: reports measured resize heights and anchors the information surface to bar width and direction", async () => {
    let measuredHeight = 72;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function () {
      return { x: 16, y: 16, top: 16, left: 16, bottom: 16 + measuredHeight, right: 656, width: 640, height: measuredHeight, toJSON() {} };
    });
    document.documentElement.dir = "rtl";
    const onHeightChange = vi.fn(); const view = standalone({ page: page(), onHeightChange });
    expect(onHeightChange).toHaveBeenLastCalledWith(72);
    act(() => { measuredHeight = 96; resizeObservers.get(bar())!([], {} as ResizeObserver); });
    expect(onHeightChange).toHaveBeenLastCalledWith(96);
    await userEvent.click(within(bar()).getByRole("button", { name: labels.pageInfo }));
    const dialog = screen.getByRole("dialog", { name: labels.pageInfo });
    const surface = dialog.closest<HTMLElement>('[data-placement]')!;
    expect(surface.style.inlineSize).toBe("640px"); expect(surface.style.direction).toBe("rtl");
    expect(dialog).toHaveTextContent("Reporting period: July to September");
    view.unmount(); expect(resizeObservers.size).toBe(0);
  });
});

// Cutter corpus: fixed inputs with handwritten acceptance, shared by both real renderers.
const currentCrumbs: readonly [string, string, boolean][] = [
  ["Quarterly report", "Quarterly report", true], ["Quarterly report", "Quarterly reporx", false],
  ["Quarterly report", "quarterly report", false], ["Quarterly report", " Quarterly report", false],
  ["Quarterly report", "Quarterly report ", false], ["Quarterly report", "Quarterly\u00a0report", false],
  ["Quarterly report", "Quarterly\u200d report", false], ["Quarterly report", "Qu\u0430rterly report", false],
  ["Quarterly report", "Ｑｕａｒｔｅｒｌｙ report", false], ["Q3 report", "Q3-report", false],
];
const informationValues: readonly [string, React.ReactNode, boolean][] = [["undefined", undefined, false], ["null", null, false], ["false", false, false], ["zero", 0, true], ["empty string", "", true], ["empty fragment", <Fragment />, true]];
function corpusRender(renderer: "PageBar" | "AppFrame", props: Partial<PageBarProps>) {
  if (renderer === "PageBar") return standalone({ ...props });
  const supplied: AppFrameProps = {
    brand: { markSrc: "/mark.svg" }, root,
    navigation: { tree: [{ id: "projects", label: "Projects", href: "/projects" }], activeId: "projects" },
    account: { signedOutLabel: "Signed out", sections: [] },
    commands: { heading: "Commands", triggerLabel: "Find commands", searchLabel: "Search commands", closeLabel: "Close commands", emptyMessage: "No commands", groups: [] },
    children: <p>Report content</p>, page: props.page, workspaces: props.workspaces,
    breadcrumbLabel: labels.breadcrumb, collapsedBreadcrumbLabel: labels.collapsedBreadcrumb, pageInfoLabel: labels.pageInfo,
    pageActionsLabel: labels.pageActions,
  };
  return render(<AppFrame {...supplied} />);
}
for (const renderer of ["PageBar", "AppFrame"] as const) describe(`${renderer} handwritten near-miss corpus`, () => {
  it.each(currentCrumbs)("M3: title %j / last crumb %j accepts=%s", (title, label, accepted) => {
    const supplied = page(); supplied.title = title;
    supplied.breadcrumb = [...supplied.breadcrumb!.slice(0, -1), { id: "quarterly", label, siblings: [{ id: "annual", label: "Annual report", href: "/projects/reporting/annual" }] }];
    corpusRender(renderer, { page: supplied });
    const heading = within(bar()).getByRole("heading", { level: 1, name: title });
    const currentItem = heading.closest("li")!;
    expect(within(currentItem).queryByRole("button", { name: label }) !== null).toBe(accepted);
    if (!accepted) expect(currentItem.previousElementSibling!.textContent).toBe(label);
  });
  for (const field of ["status", "description", "updatedAt", "meta", "scope"] as const) it.each(informationValues)(`information ${field}=%s present=%s`, (_name, value, present) => {
    corpusRender(renderer, { page: { title: "Quarterly report", [field]: value } });
    expect(within(bar()).queryByRole("button", { name: labels.pageInfo }) !== null).toBe(present);
  });
  it.each([0, 1, 2])("M9: workspace count %s", count => {
    corpusRender(renderer, { page: page(), workspaces: workspaces.slice(0, count) });
    expect(within(bar()).queryByRole("button", { name: root.label }) !== null).toBe(count > 0);
    if (count === 0) expect(within(within(bar()).getByRole("navigation")).getByRole("link", { name: root.label })).toHaveAttribute("href", root.href);
  });
});
