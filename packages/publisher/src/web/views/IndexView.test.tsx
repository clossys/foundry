// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Button } from "@clossys/designer/atoms";
import { PageHeader } from "@clossys/designer/blocks/server";
import { IndexView, type IndexViewProps } from "./IndexView.js";
import * as web from "../index.js";
import * as client from "../client.js";
import * as server from "../server.js";

afterEach(cleanup);
type Row = { id: string; name: string; state: string };
const rows: readonly Row[] = [{ id: "one", name: "First record", state: "Available" }, { id: "two", name: "Second record", state: "Planned" }];
const base: IndexViewProps<Row> = {
  title: "Records", subtitle: "Browse the current records.", rows,
  collectionLabel: "Record collection", rowKey: row => row.id,
  columns: [{ id: "name", header: "Name", isRowHeader: true, cell: row => row.name }, { id: "state", header: "State", cell: row => row.state }],
  empty: { title: "No records", description: "Create a record to begin." },
};

describe("IndexView", () => {
  it("exports client Views with parity and preserves an import-safe truthful React-server split", () => {
    expect(web.IndexView).toBe(IndexView);
    expect(client.IndexView).toBe(IndexView);
    expect(typeof server.IndexView).toBe("function");
    expect(renderToStaticMarkup(<server.IndexView {...base} />)).toContain(base.subtitle);
    const script = `
      import * as web from "@clossys/publisher/web";
      const results = ["IndexView", "DetailsView"].map(name => {
        if (typeof web[name] !== "function") throw new Error("Missing View export");
        try { web[name]({}); } catch (error) {
          if (error.reason !== "wrong-channel" || !error.message.includes("client")) throw error;
          return name;
        }
        throw new Error("Interactive View rendered under react-server");
      });
      console.log(JSON.stringify(results));
    `;
    expect(JSON.parse(execFileSync(process.execPath, ["--conditions=react-server", "--input-type=module", "-e", script], { encoding: "utf8" }))).toEqual(["IndexView", "DetailsView"]);
  });
  it("uses PageHeader for its title and subtitle, renders one h1 during SSR and owns no frame chrome", () => {
    const html = renderToStaticMarkup(<IndexView {...base} />);
    const host = document.createElement("div"); host.innerHTML = html;
    expect(html).toContain(renderToStaticMarkup(<PageHeader title={base.title} description={base.subtitle} />));
    expect(host.querySelectorAll("h1")).toHaveLength(1);
    expect(host.querySelector("main, footer, [role=banner], [role=contentinfo], [data-application-frame], [data-frame-root]")).toBeNull();
    render(<main aria-label="Application content"><IndexView {...base} /></main>);
    expect(screen.getAllByRole("main")).toHaveLength(1);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });

  it("arranges the header, Toolbar Block, default DataTable Block and Pagination Block in order", async () => {
    const onPageChange = vi.fn();
    const { container } = render(<IndexView {...base} toolbar={{ "aria-label": "Record filters", leading: <Button>New record</Button> }} pagination={{ page: 1, pageCount: 2, onPageChange }} />);
    const header = screen.getByRole("heading", { level: 1 });
    const toolbar = screen.getByRole("toolbar", { name: "Record filters" });
    const table = screen.getByRole("grid", { name: "Record collection" });
    const pagination = screen.getByRole("navigation", { name: "Pagination" });
    expect(header.compareDocumentPosition(toolbar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(toolbar.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(table.compareDocumentPosition(pagination) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(table).getByText("First record")).toBeInTheDocument();
    expect(container.querySelectorAll("table")).toHaveLength(1);
    await userEvent.setup().click(within(pagination).getByRole("button", { name: "Next page" }));
    expect(onPageChange).toHaveBeenCalledExactlyOnceWith(2);
    expect(within(pagination).getByRole("button", { name: "1" })).toHaveAttribute("aria-current", "page");
  });

  it("renders a typed primary collection Block slot rather than another table", () => {
    const { container } = render(<IndexView {...base} collection={{ kind: "panel", props: { children: "Collection content", footer: "Collection summary" } }} />);
    expect(container.querySelector('[data-panel-region="content"]')).toHaveTextContent("Collection content");
    expect(container.querySelector('[data-panel-region="footer"]')).toHaveTextContent("Collection summary");
    expect(screen.queryByRole("grid")).toBeNull();
  });

  it("renders its explicit EmptyState Block when there are no rows, retaining filters and recovery action", () => {
    render(<IndexView {...base} rows={[]} toolbar={{ "aria-label": "Record filters", leading: <Button>Clear filters</Button> }} empty={{ ...base.empty, action: <Button>Create record</Button> }} collection={{ kind: "panel", props: { children: "Hidden collection" } }} />);
    expect(screen.getByRole("toolbar", { name: "Record filters" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "No records", level: 2 })).toBeInTheDocument();
    expect(screen.getByText("Create a record to begin.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create record" })).toBeInTheDocument();
    expect(screen.queryByText("Hidden collection")).toBeNull();
    expect(screen.queryByRole("grid")).toBeNull();
  });

  it("reports the sanctioned route when a row-header link is activated by pointer or keyboard", async () => {
    const onNavigate = vi.fn();
    render(<IndexView {...base} rowRoute={{ href: row => `/records/${row.id}`, onNavigate }} />);
    const link = screen.getByRole("link", { name: "First record" });
    expect(link).toHaveAttribute("href", "/records/one");
    const user = userEvent.setup();
    await user.click(link);
    expect(onNavigate).toHaveBeenLastCalledWith("/records/one", rows[0]);
    onNavigate.mockClear(); link.focus(); await user.keyboard("{Enter}");
    expect(onNavigate).toHaveBeenCalledExactlyOnceWith("/records/one", rows[0]);
    onNavigate.mockClear(); await user.click(screen.getByText("Available"));
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("prevents native Enter navigation when the route callback handles keyboard activation", () => {
    const onNavigate = vi.fn();
    render(<IndexView {...base} rowRoute={{ href: row => `#record-${row.id}`, onNavigate }} />);
    const link = screen.getByRole("link", { name: "First record" }); link.focus();
    const keydown = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    fireEvent(link, keydown);
    expect(keydown.defaultPrevented).toBe(true);
    fireEvent.keyUp(link, { key: "Enter" });
    expect(onNavigate).toHaveBeenCalledExactlyOnceWith("#record-one", rows[0]);
  });

  it.each(["ctrlKey", "metaKey", "shiftKey", "altKey"] as const)("retains native modified row-link activation with %s", modifier => {
    const onNavigate = vi.fn();
    render(<IndexView {...base} rowRoute={{ href: row => `#record-${row.id}`, onNavigate }} />);
    const link = screen.getByRole("link", { name: "First record" });
    const click = new MouseEvent("click", { button: 0, bubbles: true, cancelable: true, [modifier]: true });
    fireEvent(link, click);
    expect(click.defaultPrevented).toBe(false);
    expect(onNavigate).not.toHaveBeenCalled();
    const keydown = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true, [modifier]: true });
    fireEvent(link, keydown);
    expect(keydown.defaultPrevented).toBe(false);
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("keeps Space as a native link key rather than activating the row route", () => {
    const onNavigate = vi.fn();
    render(<IndexView {...base} rowRoute={{ href: row => `#record-${row.id}`, onNavigate }} />);
    const link = screen.getByRole("link", { name: "First record" }); link.focus();
    const keydown = new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true });
    fireEvent(link, keydown);
    expect(keydown.defaultPrevented).toBe(false);
    fireEvent.keyUp(link, { key: " " });
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("keeps DataTable sort and selection controlled while reporting their own callbacks", async () => {
    const onSelectionChange = vi.fn(); const onSortChange = vi.fn();
    render(<IndexView {...base} columns={[{ ...base.columns[0]!, allowsSorting: true }, base.columns[1]!]} table={{ selectionMode: "multiple", selectedKeys: new Set(), onSelectionChange, sortDescriptor: { column: "name", direction: "ascending" }, onSortChange }} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("checkbox", { name: /Select row.*First record/ }));
    expect(onSelectionChange).toHaveBeenCalled();
    expect(screen.getByRole("checkbox", { name: /Select row.*First record/ })).not.toBeChecked();
    await user.click(screen.getByRole("columnheader", { name: /Name/ }));
    expect(onSortChange).toHaveBeenCalledWith({ column: "name", direction: "descending" });
  });

  it("refuses unsafe row routes, ambiguous route columns, raw collection markup and frame-owned roots", () => {
    for (const href of ["javascript:alert(1)", "//example.test/record", "/records/one\nnext"]) {
      expect(() => renderToStaticMarkup(<IndexView {...base} rowRoute={{ href: () => href, onNavigate: vi.fn() }} />)).toThrow(/route/i);
    }
    expect(() => renderToStaticMarkup(<IndexView {...base} columns={base.columns.map(column => ({ ...column, isRowHeader: false }))} rowRoute={{ href: () => "/records/one", onNavigate: vi.fn() }} />)).toThrow(/row.header/i);
    expect(() => renderToStaticMarkup(<IndexView {...base} collection={<div>Raw collection</div> as never} />)).toThrow(/Block/i);
    for (const props of [{ role: "main" }, { role: "navigation" }, { id: "publisher-main-content" }, { header: <header /> }, { nav: <nav /> }]) {
      expect(() => renderToStaticMarkup(<IndexView {...base} {...props as never} />)).toThrow(/frame|chrome/i);
    }
  });

  it("authors arrangement only and delegates content markup to shipped Blocks and atoms", () => {
    const source = readFileSync(join(import.meta.dirname, "IndexView.tsx"), "utf8");
    expect(source).not.toMatch(/<\s*(?:h[1-6]|p|table|thead|tbody|tr|td|th|button|nav|main|footer|header)\b/);
    expect(source).not.toMatch(/\b(?:AppFrame|SiteFrame|SiteHeader|SiteFooter)\s*[,}]/);
    for (const block of ["PageHeader", "Toolbar", "DataTable", "EmptyState", "Pagination"]) expect(source).toMatch(new RegExp(`<${block}\\b`));
  });
});
