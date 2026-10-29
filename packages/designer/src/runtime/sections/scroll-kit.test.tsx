import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RuntimeRenderInput } from "../../catalog-core/runtime-ports.js";
import { copyPortsFor } from "./__fixtures__/copy-ports.js";
import { renderSectionHeader } from "./section-header.js";
import { renderBandSection } from "./band.js";
import { renderDataTable } from "./data-table.js";
import { renderTableOfContents } from "./table-of-contents.js";

function input(leaf: string, values: Record<string, unknown>, config: string | null = null): RuntimeRenderInput<ReactNode> {
  return { sectionHost: copyPortsFor(leaf), fill: { leaf, config, slots: Object.keys(values), members: ["ground.sunken"] }, selection: { leaf, members: [], config }, cell: { state: "default" }, content: Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { value }])), slots: {}, profile: {} } as unknown as RuntimeRenderInput<ReactNode>;
}
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe("scroll section kit", () => {
  it("renders the section-header sample with a bounded heading level and stats", () => {
    const html = renderToStaticMarkup(renderSectionHeader(input("sections.section-header", { heading: "Components", stats: [{ id: "count", label: "59 records" }, { id: "status", label: "Draft", tone: "info" }] }, "level-3")));
    expect(html).toContain("<h3");
    expect(renderToStaticMarkup(renderSectionHeader(input("sections.section-header", { heading: "Default" }, "default")))).toContain("<h2");
    expect(html).toContain("59 records");
    expect(html).toContain("Draft");
    expect(() => renderSectionHeader(input("sections.section-header", { heading: "Invalid" }, "level-1"))).toThrow(/level/);
  });
  it("keeps the nested band and table heading hierarchy", () => {
    const table = renderDataTable(input("sections.data-table", { header: { heading: "Inputs", level: 4, count: "11" }, columns: [{ id: "name", label: "Name" }], rows: [{ id: "one", name: "Field" }] }));
    const band = input("sections.band", {}); Object.assign(band, { slots: { header: [renderSectionHeader(input("sections.section-header", { heading: "Controls" }, "level-3"))], body: [table] } });
    Object.assign(band, { selection: { ...band.selection, members: ["ground.sunken"] } });
    const html = renderToStaticMarkup(renderBandSection(band));
    expect(html.indexOf("<h3")).toBeLessThan(html.indexOf("<h4"));
    expect(html).toContain("Field");
  });
  it("collapses at ten rows then pages at 100 and sends selection through the host", () => {
    const pin = vi.fn();
    const format = vi.fn(({ page }: { page: number }) => page === 1 ? "Writer first range" : "Writer second range");
    const value = input("sections.data-table", { header: { heading: "Inputs", level: 4 }, columns: [{ id: "name", label: "Name", kind: "text" }], rows: Array.from({ length: 205 }, (_, n) => ({ id: String(n), name: `Row ${n}` })), selection: [], pagination: { showAll: "Show all (205)", label: "Rows", previous: "Previous", next: "Next", summary: "Page" } });
    Object.assign(value, { sectionHost: { ...copyPortsFor("sections.data-table"), onSelectionChange: pin, paginationSummary: format } });
    render(renderDataTable(value));
    expect(screen.queryByText("Row 10")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show all (205)" }));
    expect(screen.getByText("Row 99")).toBeTruthy();
    expect(screen.getByText("Writer first range")).toBeTruthy();
    expect(format).toHaveBeenLastCalledWith({ start: 1, end: 100, total: 205, page: 1, pageCount: 3 });
    expect(screen.queryByText("Row 100")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("Row 100")).toBeTruthy();
    expect(screen.getByText("Writer second range")).toBeTruthy();
    expect(format).toHaveBeenLastCalledWith({ start: 101, end: 200, total: 205, page: 2, pageCount: 3 });
    fireEvent.click(screen.getByText("Row 100").closest("tr")!);
    expect(pin).toHaveBeenCalledWith(["100"]);
  });
  it("renders a preview only through the supplied runtime port", () => {
    const value = input("sections.data-table", { columns: [{ id: "preview", label: "Preview", kind: "preview" }, { id: "name", label: "Name", kind: "text" }], rows: [{ id: "components.button", preview: "components.button", name: "Button", href: "/agents/designer/components/button" }] });
    Object.assign(value, { sectionHost: { ...copyPortsFor("sections.data-table"), renderPreview: (id: string) => createElement("span", null, `Preview ${id}`) } });
    const html = renderToStaticMarkup(renderDataTable(value));
    expect(html).toContain("Preview components.button");
    expect(html).toContain('href="/agents/designer/components/button"');
  });
  it("accepts a three-level outline and controlled active id", () => {
    const html = renderToStaticMarkup(renderTableOfContents(input("sections.table-of-contents", { label: "Explore", headings: [{ id: "components", label: "Components", level: 2 }, { id: "components--controls", label: "Controls", level: 3 }, { id: "components--controls--inputs", label: "Inputs", level: 4 }], "active-id": "components--controls--inputs" })));
    expect(html).toContain('href="#components--controls--inputs"');
    expect(html).toContain('aria-current="location"');
  });
});

it("uses disclosures for three levels and marks the observed active heading", async () => {
  let callback: IntersectionObserverCallback = () => {};
  vi.stubGlobal("IntersectionObserver", vi.fn(function (cb: IntersectionObserverCallback) { callback = cb; return { observe: vi.fn(), disconnect: vi.fn() }; }));
  const active = vi.fn(), navigate = vi.fn();
  const value = input("sections.table-of-contents", { label: "Explore", headings: [{ id: "l0", label: "Components", level: 2 }, { id: "l1", label: "Controls", level: 3 }, { id: "l2", label: "Inputs", level: 4 }] });
  Object.assign(value, { sectionHost: { trackCurrent: true, onActiveChange: active, navigate } });
  render(<><h2 id="l0">Components</h2><h3 id="l1">Controls</h3><h4 id="l2">Inputs</h4>{renderTableOfContents(value)}</>);
  const { act } = await import("@testing-library/react");
  await act(async () => callback([{ target: document.getElementById("l2")!, isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver));
  expect(screen.getByRole("link", { name: "Inputs" }).getAttribute("aria-current")).toBe("location");
  expect(active).toHaveBeenCalledWith("l2");
  await userEvent.click(screen.getByRole("link", { name: "Inputs" })); expect(navigate).toHaveBeenCalledWith("l2");
  const disclosure = screen.getByRole("button", { name: "Controls" });
  await userEvent.click(disclosure); expect(disclosure.getAttribute("aria-expanded")).toBe("false");
  disclosure.focus(); await userEvent.keyboard(" "); expect(disclosure.getAttribute("aria-expanded")).toBe("true");
  vi.unstubAllGlobals();
});

it("keeps two action controls and places further commands inside the existing Menu", async () => {
  const value = input("sections.section-header", { heading: "Components", actions: [{ id: "pin", label: "Pin" }, { id: "more", label: "More", items: [{ id: "copy", label: "Copy" }, { id: "open", label: "Open" }, { id: "inspect", label: "Inspect" }] }] });
  render(renderSectionHeader(value));
  await userEvent.click(screen.getByRole("button", { name: "More" }));
  expect(screen.getAllByRole("menuitem")).toHaveLength(3);
  expect(() => renderSectionHeader(input("sections.section-header", { heading: "Invalid", actions: [{ label: "One" }, { label: "Two" }, { label: "Three" }] }))).toThrow(/at most 2/);
});
