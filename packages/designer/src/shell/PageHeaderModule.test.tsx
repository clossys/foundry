import { act, createContext, StrictMode, useContext, useState } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PageBar } from "../blocks/PageBar.js";
import { FrameSlotProvider, PageHeaderModule, SlotModule, useFramePageHeader } from "./FrameSlots.js";

const Source = createContext("missing");
let available = 1440;
const observers = new Set<() => void>();
beforeEach(() => {
  available = 1440;
  vi.stubGlobal("matchMedia", (media: string) => ({ media, matches: false, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal("ResizeObserver", class {
    callback: () => void;
    constructor(callback: ResizeObserverCallback) { this.callback = () => callback([], this as unknown as ResizeObserver); observers.add(this.callback); }
    observe() {} unobserve() {} disconnect() { observers.delete(this.callback); }
  });
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function(this: HTMLElement) { return this.hasAttribute("data-frame-header-overflow") ? available : 0; });
  vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockImplementation(function(this: HTMLElement) {
    if (this.tagName === "NAV") return 400;
    if (this.tagName === "H1") return 100;
    if (this.hasAttribute("data-frame-header-actions")) return this.querySelector('[data-compact="true"]') ? 44 : 200;
    return 0;
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); observers.clear(); });
function Host({ onNavigate }: { onNavigate?: (href: string) => void }) {
  const header = useFramePageHeader({ title: "Host fallback" });
  return <PageBar header={header} onNavigate={onNavigate} root={{ label: "Root" }} labels={{ breadcrumb: "Trail", collapsedBreadcrumb: "Earlier", pageInfo: "Info", pageActions: "Actions" }} />;
}
function Action({ compact, label }: { compact: boolean; label: string }) {
  const source = useContext(Source); const [count, setCount] = useState(0);
  return <button data-compact={compact} onClick={() => setCount(count + 1)}>{source}:{label}:{String(compact)}:{count}</button>;
}
function Owner({ title = "Workspace", version = "first" }: { title?: string; version?: string }) {
  return <Source.Provider value="camera"><PageHeaderModule id="page" header={{ title, nav: { label: "Views", activeId: "second", items: [{ id: "first", label: "First", href: "#first" }, { id: "second", label: "Second", href: "#second" }] }, actions: { render: ({ compact }) => <Action compact={compact} label={version} /> } }} /></Source.Provider>;
}
function measure(width: number) { act(() => { available = width; for (const callback of observers) callback(); }); }
it("keeps the real frame title/nav/menu and delivers compact actions in their original provider context", async () => {
  const navigate = vi.fn();
  render(<StrictMode><FrameSlotProvider><Host onNavigate={navigate} /><Owner /></FrameSlotProvider></StrictMode>);
  expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  expect(screen.getByRole("navigation", { name: "Views" })).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "camera:first:false:0" }));
  measure(660); expect(screen.getByRole("button", { name: "camera:first:true:1" })).toBeTruthy();
  measure(390);
  expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  await userEvent.click(screen.getByRole("button", { name: "Workspace / Second" }));
  expect(screen.getByRole("menuitem", { name: "Second" })).toHaveAttribute("aria-current", "page");
  await userEvent.click(screen.getByRole("menuitem", { name: "First" }));
  await waitFor(() => expect(navigate).toHaveBeenCalledExactlyOnceWith("#first"));
  measure(1440); expect(screen.getByRole("button", { name: "camera:first:false:1" })).toBeTruthy();
});
it("accepts inline data and latest action callbacks without registering effect loops, then restores the host on unmount", () => {
  function Fixture({ show = true, title = "Workspace", version = "first" }: { show?: boolean; title?: string; version?: string }) { return <FrameSlotProvider><Host />{show && <Owner title={title} version={version} />}</FrameSlotProvider>; }
  const view = render(<StrictMode><Fixture /></StrictMode>);
  for (let i = 0; i < 5; i++) view.rerender(<StrictMode><Fixture /></StrictMode>);
  view.rerender(<StrictMode><Fixture title="Updated" version="latest" /></StrictMode>);
  expect(screen.getByRole("heading", { level: 1, name: "Updated" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "camera:latest:false:0" })).toBeTruthy();
  view.rerender(<StrictMode><Fixture show={false} /></StrictMode>);
  expect(screen.getByRole("heading", { level: 1, name: "Host fallback" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: /camera:/ })).toBeNull();
});
it("rejects duplicate owners even with different ids and refuses raw mandatory-header replacements", () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  expect(() => render(<FrameSlotProvider><PageHeaderModule id="a" header={{ title: "A" }} /><PageHeaderModule id="b" header={{ title: "B" }} /></FrameSlotProvider>)).toThrow("already leased");
  expect(() => render(<FrameSlotProvider><Host /><SlotModule id="raw" slot="header-start" label="Raw"><h1>Replacement</h1></SlotModule></FrameSlotProvider>)).toThrow("PageHeaderModule");
  log.mockRestore();
});
it("diagnoses missing providers on client and server, while a pending host is normal", () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  expect(() => render(<Owner />)).toThrow("FrameSlotProvider");
  expect(() => renderToString(<Owner />)).toThrow("FrameSlotProvider");
  log.mockRestore();
  const view = render(<FrameSlotProvider><Owner /></FrameSlotProvider>);
  expect(view.container.querySelector("button")).toBeNull();
});
it("hydrates the fallback before registering its header and source-context actions without recoverable errors", async () => {
  const tree = <FrameSlotProvider><Host /><Owner /></FrameSlotProvider>;
  const host = document.createElement("div"); host.innerHTML = renderToString(tree); document.body.append(host);
  expect(within(host).getByRole("heading", { level: 1, name: "Host fallback" })).toBeTruthy();
  const recoverable = vi.fn(); let root: ReturnType<typeof hydrateRoot> | undefined;
  try {
    await act(async () => { root = hydrateRoot(host, tree, { onRecoverableError: recoverable }); });
    expect(recoverable).not.toHaveBeenCalled();
    expect(within(host).getByRole("heading", { level: 1, name: "Workspace" })).toBeTruthy();
    expect(within(host).getByRole("button", { name: "camera:first:false:0" })).toBeTruthy();
  } finally { await act(async () => root?.unmount()); host.remove(); }
});
