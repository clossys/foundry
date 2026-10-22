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
import { groupRows, parseDataTableViewModel, type DataTableViewModel } from "@clossys/designer/blocks";
import { IndexView, type IndexViewProps } from "./IndexView.js";
import * as web from "../index.js";
import * as client from "../client.js";
import * as server from "../server.js";

afterEach(cleanup);
type Row = { id: string; name: string; state: string };
const rows: readonly Row[] = [{ id: "one", name: "First record", state: "Available" }, { id: "two", name: "Second record", state: "Planned" }];
const base: IndexViewProps<Row> = {
  rows,
  collectionLabel: "Record collection", rowKey: row => row.id,
  columns: [{ id: "name", header: "Name", isRowHeader: true, cell: row => row.name }, { id: "state", header: "State", cell: row => row.state }],
  empty: { title: "No records", description: "Create a record to begin." },
};

describe("IndexView", () => {
  it("exports client Views with parity and preserves an import-safe truthful React-server split", () => {
    expect(web.IndexView).toBe(IndexView);
    expect(client.IndexView).toBe(IndexView);
    expect(typeof server.IndexView).toBe("function");
    expect(renderToStaticMarkup(<server.IndexView {...base} />)).toContain("First record");
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
  it("starts with collection content and renders no page header, title, breadcrumb or page actions", () => {
    const html = renderToStaticMarkup(<IndexView {...base} />);
    const host = document.createElement("div"); host.innerHTML = html;
    expect(host.querySelector("header, h1, nav")).toBeNull();
    expect(host.firstElementChild?.firstElementChild?.tagName).toBe("DIV");
    expect(host.firstElementChild?.firstElementChild?.querySelector("table")).not.toBeNull();
    expect(host.querySelector("main, footer, [role=banner], [role=contentinfo], [data-application-frame], [data-frame-root]")).toBeNull();
    render(<main aria-label="Application content"><IndexView {...base} /></main>);
    expect(screen.getAllByRole("main")).toHaveLength(1);
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
    expect(screen.getByRole("grid", { name: base.collectionLabel })).toBeInTheDocument();
  });

  it.each(["title", "subtitle", "actions"])("rejects the removed %s prop with AppFrame page guidance, even when undefined", key => {
    for (const value of [undefined, "Page information"]) {
      const legacy = { [key]: value };
      const invoke = () => renderToStaticMarkup(<IndexView {...base} {...legacy as never} />);
      expect(invoke).toThrow(TypeError);
      expect(invoke).toThrow(`IndexView: unknown prop "${key}"; page-level information belongs in AppFrame page.`);
    }
  });

  it.each([undefined, "", "   "])("requires an explicit nonempty collection label (%s)", collectionLabel => {
    expect(() => renderToStaticMarkup(<IndexView {...base} collectionLabel={collectionLabel as never} />)).toThrow(/collectionLabel/);
  });

  it("requires its explicit empty state and preserves loading content for zero rows", () => {
    expect(() => renderToStaticMarkup(<IndexView {...base} empty={undefined as never} />)).toThrow(/empty state/);
    render(<IndexView {...base} rows={[]} table={{ isLoading: true }} />);
    expect(screen.getByRole("grid", { name: base.collectionLabel })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "No records" })).toBeNull();
  });

  it("starts with the Toolbar Block before the default DataTable and Pagination Blocks", async () => {
    const onPageChange = vi.fn();
    const { container } = render(<IndexView {...base} toolbar={{ "aria-label": "Record filters", leading: <Button>New record</Button> }} pagination={{ page: 1, pageCount: 2, onPageChange }} />);
    const toolbar = screen.getByRole("toolbar", { name: "Record filters" });
    const table = screen.getByRole("grid", { name: "Record collection" });
    const pagination = screen.getByRole("navigation", { name: "Pagination" });
    expect(container.firstElementChild?.firstElementChild).toBe(toolbar);
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
    expect(source).not.toMatch(/\bPageHeader\b/);
    for (const block of ["Toolbar", "DataTable", "EmptyState", "Pagination"]) expect(source).toMatch(new RegExp(`<${block}\\b`));
  });
});

describe("IndexView table view model", () => {
  const tableModel = { version: 1, collation: { locale: "en" }, columns: [{ id: "name", kind: "text" }, { id: "state", kind: "enum" }] } as const;
  const flat: DataTableViewModel = parseDataTableViewModel({ version: 2, table: tableModel, mode: "flat", density: "comfortable", sort: [], visibleColumns: ["name"] });
  const grouped: DataTableViewModel = parseDataTableViewModel({ version: 2, table: { ...tableModel, groupBy: [{ column: "state" }] }, mode: "grouped", density: "comfortable", sort: [], visibleColumns: ["name", "state"] });
  const availableKey = groupRows(rows as readonly Row[], grouped.table).find(group => group.path.join() === "Available")!.key;
  const sortable = { ...base, columns: [{ ...base.columns[0]!, allowsSorting: true }, base.columns[1]!] } satisfies IndexViewProps<Row>;
  const views = [["client", IndexView], ["server", server.IndexView]] as const;

  it.each(views)("renders the supplied model through the %s View", (_channel, View) => {
    const html = renderToStaticMarkup(<View {...base} table={{ model: flat, onModelChange: vi.fn() }} />);
    expect(html).toContain("View options");
    expect(html).toContain("First record");
    expect(html).not.toContain("Available");
    const groupedHtml = renderToStaticMarkup(<View {...base} table={{ model: grouped, onModelChange: vi.fn() }} />);
    expect(groupedHtml).toContain("Collapse group Available");
    expect(groupedHtml).toContain("Collapse group Planned");
  });

  it("reports a replacement model when a model header is sorted", async () => {
    const onModelChange = vi.fn();
    render(<IndexView {...sortable} table={{ model: flat, onModelChange }} />);
    await userEvent.setup().click(screen.getByRole("columnheader", { name: /Name/ }));
    expect(onModelChange).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ version: 2, sort: [{ column: "name", direction: "ascending" }] }));
  });

  it.each(views)("uses host messages for visible copy through the %s View", (_channel, View) => {
    const html = renderToStaticMarkup(<View {...base} table={{ model: grouped, onModelChange: vi.fn(), messages: { viewOptionsLabel: "Table settings", groupToggleMessage: (path, expanded) => `${expanded ? "Fold" : "Unfold"} ${path.join("/")}` } }} />);
    expect(html).toContain("Table settings");
    expect(html).not.toContain("View options");
    expect(html).toContain("Fold Available");
  });

  it.each(views)("controls group expansion through the %s View", (_channel, View) => {
    const html = renderToStaticMarkup(<View {...base} table={{ model: grouped, onModelChange: vi.fn(), expandedGroupKeys: new Set([availableKey]), onExpandedGroupKeysChange: vi.fn() }} />);
    expect(html).toContain("First record");
    expect(html).not.toContain("Second record");
    expect(html).toContain("Collapse group Available");
    expect(html).toContain("Expand group Planned");
  });

  it("reports the next expanded group keys from a group toggle", async () => {
    const onExpandedGroupKeysChange = vi.fn();
    render(<IndexView {...base} table={{ model: grouped, onModelChange: vi.fn(), expandedGroupKeys: new Set<string>(), onExpandedGroupKeysChange }} />);
    expect(screen.queryByText("First record")).toBeNull();
    await userEvent.setup().click(screen.getByRole("button", { name: "Expand group Available" }));
    expect(onExpandedGroupKeysChange).toHaveBeenCalledExactlyOnceWith(new Set([availableKey]));
  });

  it("keeps the row-header link wrapper working with a flat or grouped model", async () => {
    const onNavigate = vi.fn();
    const user = userEvent.setup();
    const rowRoute = { href: (row: Row) => `/records/${row.id}`, onNavigate };
    const { unmount } = render(<IndexView {...sortable} rowRoute={rowRoute} table={{ model: flat, onModelChange: vi.fn() }} />);
    expect(screen.getByRole("link", { name: "First record" })).toHaveAttribute("href", "/records/one");
    await user.click(screen.getByRole("link", { name: "Second record" }));
    expect(onNavigate).toHaveBeenCalledExactlyOnceWith("/records/two", rows[1]);
    unmount(); onNavigate.mockClear();
    const onModelChange = vi.fn();
    render(<IndexView {...sortable} rowRoute={rowRoute} table={{ model: grouped, onModelChange }} />);
    expect(screen.getByRole("link", { name: "First record" })).toHaveAttribute("href", "/records/one");
    await user.click(screen.getByRole("link", { name: "First record" }));
    expect(onNavigate).toHaveBeenCalledExactlyOnceWith("/records/one", rows[0]);
    expect(onModelChange).not.toHaveBeenCalled();
    await user.click(screen.getByRole("columnheader", { name: /Name/ }));
    expect(onModelChange).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ sort: [{ column: "name", direction: "ascending" }] }));
    expect(screen.getByRole("link", { name: "First record" })).toBeInTheDocument();
  });
});
