// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Banner, Button } from "@clossys/designer/atoms";
import { DetailsView, type DetailsViewProps, type DetailsViewSection } from "./DetailsView.js";
import * as web from "../index.js";
import * as client from "../client.js";
import * as server from "../server.js";

afterEach(cleanup);
const sections: readonly DetailsViewSection[] = [
  { id: "identity", title: "Identity", block: { kind: "detail", props: { fields: [{ label: "Identifier", value: "record-one" }] } } },
  { id: "activity", title: "Activity", block: { kind: "panel", props: { children: "Recent activity", footer: "Activity summary" } } },
];
const common = { title: "First record", subtitle: "Details of the selected record.", index: { href: "/records", label: "Records" }, empty: { title: "No sections", description: "Nothing is available in this section." } };
const tabs = [{ id: "overview", label: "Overview", sections }, { id: "history", label: "History", sections: [{ id: "changes", title: "Changes", block: { kind: "stat" as const, props: { label: "Recorded changes", value: "3" } } }] }, { id: "empty", label: "Attachments", sections: [] }];
const tabbed = (overrides: Partial<DetailsViewProps> = {}): DetailsViewProps => ({ ...common, tabs, tabsLabel: "Record sections", tab: "overview", onTabChange: vi.fn(), ...overrides } as DetailsViewProps);

describe("DetailsView", () => {
  it("exports client Views from ordinary web, client and server targets", () => {
    expect(web.DetailsView).toBe(DetailsView);
    expect(client.DetailsView).toBe(DetailsView);
    expect(typeof server.DetailsView).toBe("function");
    expect(renderToStaticMarkup(<server.DetailsView {...common} sections={sections} />)).toContain(common.subtitle);
  });
  it("uses PageHeader for title/subtitle and breadcrumb, with one h1 and no frame chrome during SSR", () => {
    const html = renderToStaticMarkup(<DetailsView {...common} sections={sections} />);
    const host = document.createElement("div"); host.innerHTML = html;
    expect(host.querySelectorAll("h1")).toHaveLength(1);
    const header = host.querySelector("header")!;
    expect(header.querySelector("h1")).toHaveTextContent(common.title);
    expect(header.querySelector("p")).toHaveTextContent(common.subtitle);
    expect(header.querySelector('nav a[href="/records"]')).toHaveTextContent("Records");
    expect(header.querySelector('[aria-current="page"]')).toHaveTextContent("First record");
    expect(host.querySelector("main, footer, [role=banner], [role=contentinfo], [data-application-frame], [data-frame-root]")).toBeNull();
    render(<main aria-label="Application content"><DetailsView {...common} sections={sections} /></main>);
    expect(screen.getAllByRole("main")).toHaveLength(1);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });

  it("defaults regions to main and groups the narrow aside after main regardless of authored region order", () => {
    const summary: DetailsViewSection = { id: "summary", title: "Summary", region: "aside", block: { kind: "stat", props: { label: "Open items", value: "7" } } };
    const { container } = render(<DetailsView {...common} sections={[summary, ...sections]} />);
    const identity = screen.getByRole("heading", { name: "Identity", level: 2 });
    const activity = screen.getByRole("heading", { name: "Activity", level: 2 });
    expect(identity.compareDocumentPosition(activity) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText("Identifier").tagName).toBe("DT");
    expect(screen.getByText("record-one").tagName).toBe("DD");
    expect(container.querySelector('[data-panel-region="content"]')).toHaveTextContent("Recent activity");
    const side = screen.getByRole("complementary");
    expect(within(side).getByText("Open items")).toBeInTheDocument();
    expect(within(side).getByText("7")).toBeInTheDocument();
    expect(side.querySelector('[data-details-section="identity"]')).toBeNull();
    expect(identity.compareDocumentPosition(side) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const body = side.parentElement!;
    expect(body.firstElementChild).not.toBe(side);
    expect(body).toHaveClass("grid-cols-1", "tablet:grid-cols-3");
    expect(body.firstElementChild).toHaveClass("tablet:col-span-2");
  });

  it("keeps sections with omitted regions in main and renders no empty aside", () => {
    const { container } = render(<DetailsView {...common} sections={sections} />);
    expect(screen.queryByRole("complementary")).toBeNull();
    expect([...container.querySelectorAll("[data-details-section]")].map(node => node.getAttribute("data-details-section"))).toEqual(["identity", "activity"]);
  });

  it("single layout ignores region placement while retaining all sections in original authored order", () => {
    const summary: DetailsViewSection = { id: "summary", title: "Summary", region: "aside", block: { kind: "stat", props: { label: "Open items", value: "7" } } };
    const { container } = render(<DetailsView {...common} layout="single" sections={[summary, ...sections]} />);
    expect(screen.queryByRole("complementary")).toBeNull();
    expect([...container.querySelectorAll("[data-details-section]")].map(node => node.getAttribute("data-details-section"))).toEqual(["summary", "identity", "activity"]);
    expect(screen.getByText("record-one")).toBeInTheDocument();
    expect(screen.getByText("Recent activity")).toBeInTheDocument();
    expect(screen.getByText("7")).toBeInTheDocument();
  });

  it("isolates loading, empty and error states to their sections while preserving the page and its other Blocks", () => {
    const loading: DetailsViewSection = { ...sections[0]!, state: { kind: "loading", label: "Loading identity" } };
    const empty: DetailsViewSection = { id: "attachments", title: "Attachments", region: "aside", block: { kind: "panel", props: { children: "Hidden attachments" } }, state: { kind: "empty", props: { title: "No attachments", description: "Add a file when available." } } };
    const error: DetailsViewSection = { id: "history", title: "History", region: "aside", block: { kind: "panel", props: { children: "Hidden history" } }, state: { kind: "error", props: { children: "History could not load." } } };
    const { container, rerender } = render(<DetailsView {...common} sections={[loading, sections[1]!, empty, error]} />);
    expect(screen.getByRole("heading", { name: common.title, level: 1 })).toBeInTheDocument();
    expect(screen.getByRole("status", { name: "Loading identity" })).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("heading", { name: "No attachments", level: 2 })).toBeInTheDocument();
    expect(screen.getByText("Add a file when available.")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("History could not load.");
    expect(screen.getByText("Recent activity")).toBeInTheDocument();
    expect(screen.queryByText("record-one")).toBeNull();
    expect(screen.queryByText("Hidden attachments")).toBeNull();
    expect(screen.queryByText("Hidden history")).toBeNull();
    expect(container.firstElementChild).not.toHaveAttribute("aria-busy");
    rerender(<DetailsView {...common} sections={sections} />);
    expect(screen.getByText("record-one")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("status", { name: "Loading identity" })).toBeNull();
  });

  it("places the optional banner between PageHeader and body and keeps actions in PageHeader", () => {
    render(<DetailsView {...common} sections={sections} actions={<Button>Edit record</Button>} banner={<Banner variant="warning">Archived record</Banner>} />);
    const heading = screen.getByRole("heading", { name: common.title, level: 1 });
    const banner = screen.getByRole("status");
    const firstSection = screen.getByRole("heading", { name: "Identity", level: 2 });
    expect(banner).toHaveTextContent("Archived record");
    expect(heading.compareDocumentPosition(banner) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(banner.compareDocumentPosition(firstSection) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole("button", { name: "Edit record" }).closest("header")).toContainElement(heading);
  });

  it("renders the shipped StatusList and RecordLedger Blocks through their typed entries", () => {
    const status: DetailsViewSection = { id: "status", title: "Readiness", block: { kind: "status-list", props: {
      labels: { available: "Available", partial: "Partial", planned: "Planned", dispositions: { "not-offered": "Not offered" } },
      legendLabel: "Readiness legend", items: [{ id: "access", label: "Record access", state: "available" }],
    } } };
    const ledger: DetailsViewSection = { id: "ledger", title: "Record ledger", block: { kind: "record-ledger", props: {
      form: "record", id: "details-ledger", head: { title: "Current record" }, caption: "Current record values.",
      groups: [{ id: "identity", label: "Identity", rows: [{ id: "identifier", label: "Identifier", detail: "record-one" }] }],
    } } };
    const { container } = render(<DetailsView {...common} sections={[status, ledger]} />);
    expect(screen.getByText("Record access")).toBeInTheDocument();
    expect(screen.getByLabelText("Readiness legend")).toBeInTheDocument();
    expect(container.querySelector("[data-record-ledger]")).toBeInTheDocument();
    expect(screen.getByText("Current record values.")).toBeInTheDocument();
  });

  it("keeps tab selection controlled on clicks and arrow keys until the host returns a new selection", async () => {
    const props = tabbed(); const { rerender } = render(<DetailsView {...props} />);
    const overview = screen.getByRole("tab", { name: "Overview" });
    const history = screen.getByRole("tab", { name: "History" });
    expect(overview).toHaveAttribute("aria-selected", "true");
    const user = userEvent.setup();
    await user.click(history);
    expect(props.onTabChange).toHaveBeenLastCalledWith("history");
    expect(overview).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByText("Recorded changes")).toBeNull();
    overview.focus(); await user.keyboard("{ArrowRight}");
    expect(history).toHaveFocus();
    expect(props.onTabChange).toHaveBeenLastCalledWith("history");
    expect(overview).toHaveAttribute("aria-selected", "true");
    rerender(<DetailsView {...tabbed({ tab: "history" })} />);
    expect(screen.getByRole("tab", { name: "History" })).toHaveAttribute("aria-selected", "true");
    const panel = screen.getByRole("tabpanel", { name: "History" });
    expect(within(panel).getByText("Recorded changes")).toBeInTheDocument();
    expect(screen.queryByText("record-one")).toBeNull();
    expect(history).toHaveAttribute("aria-controls", panel.id);
    expect(panel).toHaveAttribute("aria-labelledby", history.id);
  });

  it("keeps sections inside their own selected tab panel and shows EmptyState for a tab with no sections", () => {
    const { rerender } = render(<DetailsView {...tabbed()} />);
    const overview = screen.getByRole("tabpanel", { name: "Overview" });
    expect(within(overview).getByText("record-one")).toBeInTheDocument();
    expect(screen.getByText("record-one").closest('[role="tabpanel"]')).toBe(overview);
    expect(screen.queryByText("Recorded changes")).toBeNull();
    rerender(<DetailsView {...tabbed({ tab: "empty" })} />);
    const empty = screen.getByRole("tabpanel", { name: "Attachments" });
    expect(within(empty).getByRole("heading", { name: "No sections", level: 2 })).toBeInTheDocument();
    expect(within(empty).getByText(common.empty.description)).toBeInTheDocument();
    expect(screen.queryByText("record-one")).toBeNull();
    expect(screen.queryByText("Recorded changes")).toBeNull();
  });

  it("applies the same layout model independently to every host-controlled tab", () => {
    const perTab = [{ id: "overview", label: "Overview", sections: [sections[0]!, { ...sections[1]!, region: "aside" }] }, { id: "history", label: "History", sections: [{ ...sections[0]!, id: "past-identity", title: "Past identity", region: "aside" }] }];
    const { rerender } = render(<DetailsView {...common} tabs={perTab} tab="overview" onTabChange={vi.fn()} tabsLabel="Record sections" />);
    const overview = screen.getByRole("tabpanel", { name: "Overview" });
    expect(within(within(overview).getByRole("complementary")).getByText("Recent activity")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Past identity" })).toBeNull();
    rerender(<DetailsView {...common} tabs={perTab} tab="history" onTabChange={vi.fn()} tabsLabel="Record sections" layout="single" />);
    const history = screen.getByRole("tabpanel", { name: "History" });
    expect(within(history).queryByRole("complementary")).toBeNull();
    expect(within(history).getByRole("heading", { name: "Past identity", level: 2 })).toBeInTheDocument();
    expect(screen.queryByText("Recent activity")).toBeNull();
  });

  it("renders the explicit EmptyState when an untabbed Details view has no sections", () => {
    render(<DetailsView {...common} sections={[]} />);
    expect(screen.getByRole("heading", { name: "No sections", level: 2 })).toBeInTheDocument();
    expect(screen.queryByRole("tablist")).toBeNull();
  });

  it("refuses raw elements instead of Block entries, bad identities, missing controlled selection and unsafe index links", () => {
    for (const block of [<div>Raw detail</div>, { kind: "raw", props: { children: "Raw detail" } }, { kind: "PageHeader", props: { title: "Second title" } }]) {
      expect(() => renderToStaticMarkup(<DetailsView {...common} sections={[{ id: "bad", title: "Bad", block: block as never }]} />)).toThrow(/Block/i);
    }
    expect(() => renderToStaticMarkup(<DetailsView {...common} sections={[sections[0]!, sections[0]!]} />)).toThrow(/section.*id/i);
    expect(() => renderToStaticMarkup(<DetailsView {...tabbed({ tab: "missing" })} />)).toThrow(/tab/i);
    expect(() => renderToStaticMarkup(<DetailsView {...tabbed({ onTabChange: undefined })} />)).toThrow(/onTabChange/);
    expect(() => renderToStaticMarkup(<DetailsView {...common} index={{ href: "javascript:alert(1)", label: "Records" }} sections={sections} />)).toThrow(/index/i);
    for (const props of [{ role: "main" }, { id: "publisher-main-content" }, { header: <header /> }, { nav: <nav /> }, { leftPanel: <div /> }, { bottomPanel: <div /> }]) {
      expect(() => renderToStaticMarkup(<DetailsView {...common} sections={sections} {...props as never} />)).toThrow(/frame|chrome/i);
    }
    expect(() => renderToStaticMarkup(<DetailsView {...common} sections={sections} layout={"left" as never} />)).toThrow(/layout/i);
    expect(() => renderToStaticMarkup(<DetailsView {...common} sections={[{ ...sections[0]!, region: "bottom" as never }]} />)).toThrow(/region/i);
    expect(() => renderToStaticMarkup(<DetailsView {...common} sections={[{ ...sections[0]!, state: { kind: "ready" } as never }]} />)).toThrow(/state/i);
  });

  it("authors arrangement only and delegates section content and headings to Blocks", () => {
    const source = readFileSync(join(import.meta.dirname, "DetailsView.tsx"), "utf8");
    expect(source).not.toMatch(/<\s*(?:h[1-6]|p|table|button|nav|main|footer|header)\b/);
    expect(source).not.toMatch(/\b(?:AppFrame|SiteFrame|SiteHeader|SiteFooter)\s*[,}]/);
    for (const block of ["PageHeader", "SectionHeader", "DetailView", "Panel", "Stat", "StatusList", "RecordLedger", "EmptyState"]) expect(source).toMatch(new RegExp(`<${block}\\b`));
    expect(source).toMatch(/<Tabs\b/);
    expect(source).toMatch(/<Breadcrumb\b/);
    expect(source).toMatch(/<Skeleton\b/);
    expect(source).toMatch(/<Banner\b/);
  });
});
