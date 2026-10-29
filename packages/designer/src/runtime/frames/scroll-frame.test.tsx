// @vitest-environment jsdom
import { useState, type ReactNode } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { RuntimeFrameHost, RuntimeJson, RuntimeRenderInput } from "../../catalog-core/runtime-ports.js";
import { appShellRenderer } from "./app-shell.js";
import { renderSectionHeader } from "../sections/section-header.js";
import { renderDataTable } from "../sections/data-table.js";
import { renderBandSection } from "../sections/band.js";
import { appHeaderRenderer } from "./app-header.js";
import { specimenDataset } from "../../studio/specimen-dataset.js";
import { ShellCopyProvider } from "../../components/Banner.copy-context.js";
import { shellCopyFixtureResolver } from "../../frames/__fixtures__/shell-copy.js";

beforeEach(() => {
  Object.defineProperty(window, "innerWidth", { value: 1440, configurable: true });
  vi.stubGlobal("matchMedia", (media: string) => ({ media, matches: media.includes("min-width") || media === "all", addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function input(host: RuntimeFrameHost<ReactNode>, extra: Record<string, RuntimeJson> = {}) {
  const values = { ...appShellRenderer.sample(specimenDataset), ...extra };
  return { fill: { leaf: "frames.app-shell" }, selection: { leaf: "frames.app-shell", config: null, members: [] }, content: Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { value }])), slots: { main: [<p key="main">Ready content</p>], ...(extra["page-module"] ? { "page-module": [<p key="outline">Outline</p>] } : {}) }, cell: { state: "default" }, host } as unknown as RuntimeRenderInput<ReactNode>;
}
const copy = { progress: { label: "Loading page" }, state: { loading: { heading: "Loading page" }, error: { heading: "Failed" }, "not-found": { heading: "Missing" }, forbidden: { heading: "No access" } }, "page-module": { label: "Page outline" } };
function draw(value: RuntimeRenderInput<ReactNode>) { return <ShellCopyProvider resolver={shellCopyFixtureResolver}>{appShellRenderer.render(value)}</ShellCopyProvider>; }
it("owns progress/loading/error in main while persistent chrome stays mounted", () => {
  const host = { navigate() {}, state: { navigating: true, main: "loading" as const }, panels: { inspector: <textarea aria-label="Chat draft" defaultValue="Keep chat" /> } };
  const initial = input(host, { ...copy, inspector: { label: "Chat", handleLabel: "Resize chat", min: 200, max: 480, defaultValue: 300 } });
  const view = render(draw(initial));
  const root = view.container.querySelector("[data-application-frame]");
  expect(screen.getByRole("progressbar", { name: "Loading page" })).toBeTruthy();
  expect(screen.getByRole("status", { name: "Loading page" })).toBeTruthy();
  const rail = view.container.querySelector('[data-application-frame-region="navigation"]');
  view.rerender(draw(input({ ...host, state: { navigating: false, main: "error" } }, { ...copy, inspector: { label: "Chat", handleLabel: "Resize chat", min: 200, max: 480, defaultValue: 300 } })));
  expect(screen.getByRole("heading", { name: "Failed" })).toBeTruthy();
  expect(view.container.querySelector("[data-application-frame]")).toBe(root);
  expect(view.container.querySelector('[data-application-frame-region="navigation"]')).toBe(rail);
  expect(screen.queryByRole("progressbar")).toBeNull();
  expect(screen.getByLabelText("Chat draft")).toHaveProperty("value", "Keep chat");
});
it("updates publication regions without replacing the frame and toggles the page module", () => {
  const first = input({ navigate() {} }, { ...copy, header: { title: "Designer", trail: [{ id: "agents", label: "Agents", href: "/agents" }] } });
  const view = render(draw(first)); const root = view.container.querySelector("[data-application-frame]");
  expect(screen.getByRole("heading", { level: 1, name: "Designer" })).toBeTruthy();
  expect(view.container.querySelector('[data-application-frame-region="page-module"]')).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Page outline" }));
  expect(view.container.querySelector('[data-application-frame-region="page-module"]')).toBeNull();
  const second = input({ navigate() {} }, { ...copy, header: { title: "Writer", trail: [{ id: "agents", label: "Agents", href: "/agents" }] } });
  Object.assign(second, { slots: { main: [<p key="second">Second page</p>] } });
  view.rerender(draw(second));
  expect(view.container.querySelector("[data-application-frame]")).toBe(root);
  expect(screen.getByRole("heading", { level: 1, name: "Writer" })).toBeTruthy();
  expect(screen.getByText("Second page")).toBeTruthy();
});
it("notifies real command query changes for async grouped search", async () => {
  const query = vi.fn();
  render(draw(input({ navigate() {}, onCommandQueryChange: query })));
  await userEvent.click(screen.getByRole("button", { name: specimenDataset.frames.app.commands.triggerLabel }));
  await userEvent.type(screen.getByRole("combobox"), "token");
  expect(query).toHaveBeenLastCalledWith("token");
});
it("renders icon and toggle actions using the existing toggle component", () => {
  const changed = vi.fn();
  const sample = appHeaderRenderer.sample(specimenDataset);
  const values = { ...sample, actions: [{ id: "outline", label: "Outline", icon: "list", selected: true }] };
  const value = { fill: { leaf: "frames.app-header" }, selection: { leaf: "frames.app-header", members: [] }, content: Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { value }])), host: { navigate() {}, onCommand: changed, icons: { list: <span aria-hidden="true">Icon</span> } } } as unknown as RuntimeRenderInput<ReactNode>;
  render(appHeaderRenderer.render(value));
  const button = screen.getByRole("button", { name: "Outline" });
  expect(button.getAttribute("aria-pressed")).toBe("true");
  fireEvent.click(button); expect(changed).toHaveBeenCalledWith("outline");
});

it.each([["not-found", "Missing"], ["forbidden", "No access"]] as const)("keeps frame chrome for %s", (main, label) => {
  const view = render(draw(input({ navigate() {}, state: { navigating: false, main } }, copy)));
  expect(screen.getByRole("heading", { name: label })).toBeTruthy();
  expect(view.container.querySelector(`[data-error-kind="${main}"]`)).toBeTruthy();
  expect(view.container.querySelector('[data-application-frame-region="navigation"]')).toBeTruthy();
});

it("composes the page h1 above L0 h2, band h3 and table h4", () => {
  const section = (leaf: string, values: Record<string, unknown>, config: string | null = null) => ({ fill: { leaf, slots: Object.keys(values), members: ["ground.sunken"] }, selection: { leaf, config, members: [] }, content: Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { value }])), slots: {}, cell: { state: "default" } }) as unknown as RuntimeRenderInput<ReactNode>;
  const top = renderSectionHeader(section("sections.section-header", { heading: { text: "Components", id: "components" } }));
  const title = renderSectionHeader(section("sections.section-header", { heading: "Controls" }, "level-3"));
  const table = renderDataTable(section("sections.data-table", { header: { heading: "Inputs", level: 4, count: "1" }, columns: [{ id: "name", label: "Name" }], rows: [{ id: "field", name: "Field" }] }));
  const band = section("sections.band", {}); Object.assign(band, { selection: { ...band.selection, members: ["ground.sunken"] }, slots: { header: [title], body: [table] } });
  const value = input({ navigate() {} }, { header: { title: "Designer", trail: [{ id: "agents", label: "Agents" }] } });
  Object.assign(value, { slots: { main: [top, renderBandSection(band)] } });
  render(draw(value));
  expect(screen.getAllByRole("heading").map(node => node.tagName)).toEqual(["H1", "H2", "H3", "H4"]);
  expect(document.getElementById("components")?.querySelector("h2")).toBeTruthy();
});
