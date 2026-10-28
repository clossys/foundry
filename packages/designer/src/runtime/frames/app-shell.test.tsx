// @vitest-environment jsdom
/** frames.app-shell runtime renderer: JSON content + selected members + host port render the real AppFrame. */
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RuntimeFrameHost, RuntimeJson, RuntimeRenderInput } from "../../catalog-core/runtime-ports.js";
import { DS_ATTR } from "../../catalog-core/provenance-attrs.js";
import { specimenDataset } from "../../studio/specimen-dataset.js";
import { surfaceRuntimeRenderers } from "../index.js";
import { appShellProps, guardedNavigate } from "./app-shell.js";
import { ShellCopyProvider } from "../../components/Banner.copy-context.js";
import { shellCopyFixtureResolver } from "../../frames/__fixtures__/shell-copy.js";

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("matchMedia", (media: string) => ({ media, matches: media.includes("min-width") || media === "all", addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const originalEntry = surfaceRuntimeRenderers["frames.app-shell"]!;
const entry = { ...originalEntry, render: (input: RuntimeRenderInput<ReactNode>) => <ShellCopyProvider resolver={shellCopyFixtureResolver}>{originalEntry.render(input)}</ShellCopyProvider> };
const contentOf = (values: Readonly<Record<string, RuntimeJson>>) => Object.fromEntries(Object.entries(values).map(([slot, value]) => [slot, { reference: { kind: "region" as const, ref: `content:${slot}` }, value, hash: "sha256:0" as const }]));
function input(options: { members?: string[]; host?: RuntimeFrameHost<ReactNode>; content?: Readonly<Record<string, RuntimeJson>>; pageHeader?: RuntimeRenderInput<ReactNode>["pageHeader"] } = {}): RuntimeRenderInput<ReactNode> {
  return {
    path: "frame", fill: { leaf: "frames.app-shell" }, cell: { theme: "light", state: "default", width: 1280 }, profile: {},
    selection: { leaf: "frames.app-shell", fill: "foundry/frames.app-shell", config: null, members: options.members ?? [], content: {} },
    content: contentOf(options.content ?? entry.sample(specimenDataset)), slots: { main: [<p key="body">Route body</p>] },
    ...(options.host ? { host: options.host } : {}), ...(options.pageHeader ? { pageHeader: options.pageHeader } : {}),
  } as unknown as RuntimeRenderInput<ReactNode>;
}
const app = specimenDataset.frames.app, [overview, , reports] = app.navigation;
const shell = () => document.querySelector<HTMLElement>("[data-application-frame]")!;
const main = () => document.querySelector<HTMLElement>("main")!;

describe("frames.app-shell runtime renderer", () => {
  it("renders the real AppFrame from sample JSON content, stamped with its Frame provenance", () => {
    render(<>{entry.render(input())}</>);
    expect(shell()).toHaveAttribute(DS_ATTR.layer, "frames");
    expect(shell()).toHaveAttribute(DS_ATTR.leaf, "frames.app-shell");
    // Every chrome string is the shared dataset's frames.app record, never a literal of the renderer.
    expect(screen.getByRole("navigation", { name: app.navigationLabel })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: reports.label })).toHaveAttribute("href", reports.href);
    expect(screen.getByText(app.skipLabel)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: app.commands.triggerLabel })).toBeInTheDocument();
    expect(main()).toHaveTextContent("Route body");
  });

  it("swapping the selected layout and stage members visibly changes the rendered shell", () => {
    const { unmount } = render(<>{entry.render(input({ members: ["layout.standard", "stage.contained", "theme.light"] }))}</>);
    const standard = { layout: shell().dataset.applicationFrameLayout, stage: shell().dataset.applicationFrameStage, main: main().className, nav: document.querySelector('[data-application-frame-region="navigation"]')!.getAttribute("data-open"), html: document.body.innerHTML };
    unmount();
    render(<>{entry.render(input({ members: ["layout.immersive", "stage.full", "theme.light"] }))}</>);
    expect(standard).toMatchObject({ layout: "standard", stage: "contained", nav: "true" });
    expect(standard.main.split(" ")).toContain("frame-main-inset");
    expect(shell().dataset.applicationFrameLayout).toBe("immersive");
    expect(shell().dataset.applicationFrameStage).toBe("full");
    expect(main().className.split(" ")).not.toContain("frame-main-inset");
    expect(document.querySelector('[data-application-frame-region="navigation"]')).toHaveAttribute("data-open", "false");
    expect(document.body.innerHTML).not.toBe(standard.html);
  });

  it("routes every navigation through the host's pending-save guard", async () => {
    const navigate = vi.fn(), beforeNavigate = vi.fn(async (href: string) => href !== reports.href);
    render(<>{entry.render(input({ host: { navigate, beforeNavigate } }))}</>);
    fireEvent.click(screen.getByRole("link", { name: reports.label }));
    await waitFor(() => expect(beforeNavigate).toHaveBeenCalledWith(reports.href));
    expect(navigate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("link", { name: overview.label }));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith(overview.href));
    expect(guardedNavigate(undefined)).toBeUndefined();
  });

  it("binds actions, icons, panels, toasts and theme from the host port, never from JSON", () => {
    const onCommand = vi.fn(), onAccountAction = vi.fn(), onAccountPreference = vi.fn(), onPreferenceChange = vi.fn();
    const content = entry.sample(specimenDataset) as Record<string, Record<string, RuntimeJson>>;
    const sidebar = { ...content.sidebar!, tree: [{ id: "new", label: "New page", action: "page.new", icon: "plus" }], account: { signedOutLabel: "Sign in", sections: [{ id: "a", entries: [{ id: "sign-out", kind: "destructive", label: "Sign out" }] }, { id: "p", label: "Preferences", kind: "preferences", entries: [{ id: "compact", kind: "preference", label: "Compact", checked: true }] }] } };
    const props = appShellProps(input({ content: { ...content, sidebar, inspector: { label: "Details", handleLabel: "Resize details", min: 200, max: 480, defaultValue: 320 } }, host: { navigate: () => {}, onCommand, onAccountAction, onAccountPreference, icons: { plus: <i>plus</i> }, panels: { inspector: <p>Inspector body</p>, header: <span>Context</span> }, toasts: <div>toasts</div>, theme: { preference: "dark", onPreferenceChange }, themeControl: null } }));
    const node = props.navigation.tree[0] as { onAction: () => void; icon: ReactNode };
    node.onAction();
    expect(onCommand).toHaveBeenCalledWith("page.new");
    expect(node.icon).toEqual(<i>plus</i>);
    const [actions, preferences] = props.account.sections as unknown as [{ entries: [{ onAction: () => void }] }, { entries: [{ onCheckedChange: (checked: boolean) => void; checked: boolean }] }];
    actions.entries[0].onAction(); preferences.entries[0].onCheckedChange(false);
    expect(onAccountAction).toHaveBeenCalledWith("sign-out");
    expect(onAccountPreference).toHaveBeenCalledWith("compact", false);
    expect(preferences.entries[0].checked).toBe(true);
    expect(props.rightPanel).toMatchObject({ label: "Details", min: 200, max: 480, defaultValue: 320, children: <p>Inspector body</p> });
    expect(props.context).toEqual(<span>Context</span>);
    expect(props.toasts).toEqual(<div>toasts</div>);
    expect(props.theme).toMatchObject({ defaultPreference: "system", preference: "dark", onPreferenceChange });
    expect(props.themeControl).toBeNull();
    const filtered = appShellProps(input({ host: { navigate: () => {}, commandFilter: (item, query) => item.id === query, notices: [{ id: "saving", severity: "info", text: <span>Saving</span>, dismissible: false }] } }));
    expect(filtered.commands.filter!({ id: "settings", label: "Settings", href: "#settings" }, "settings")).toBe(true);
    expect(filtered.commands.filter!({ id: "settings", label: "Settings", href: "#settings" }, "Settings")).toBe(false);
    expect(filtered.notices).toEqual([{ id: "saving", severity: "info", text: <span>Saving</span>, dismissible: false, action: undefined }]);
    // Without the host panel the inspector region is not mounted, even when JSON describes it.
    expect(appShellProps(input({ content: { ...content, inspector: { label: "Details", handleLabel: "Resize", min: 1, max: 2, defaultValue: 1 } } })).rightPanel).toBeUndefined();
  });

  it("refuses content a fill cannot honour instead of inventing chrome", () => {
    const content = entry.sample(specimenDataset) as Record<string, Record<string, RuntimeJson>>;
    expect(() => appShellProps(input({ content: { command: content.command! } }))).toThrow(/sidebar content is required/);
    expect(() => appShellProps(input({ content: { ...content, sidebar: { ...content.sidebar!, tree: [{ id: "x", label: "X", href: "#x", action: "x" }] } } }))).toThrow(/exactly one of href or action/);
    expect(() => appShellProps(input({ content: { ...content, command: { ...content.command!, heading: " " } } }))).toThrow(/command.heading/);
  });

  it("takes the page header from the leased PageHeaderModule only", async () => {
    render(<>{entry.render(input({ pageHeader: { id: "route.home", data: { title: "Leased title" }, module: { package: "@clossys/designer/shell", export: "PageHeaderModule" } } as unknown as RuntimeRenderInput<ReactNode>["pageHeader"] }))}</>);
    await waitFor(() => expect(document.querySelector('[data-application-frame-region="header"]')).toHaveTextContent("Leased title"));
  });
});
