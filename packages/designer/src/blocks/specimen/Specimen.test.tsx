import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { Specimen, type SpecimenProps } from "./Specimen.js";
import { SpecimenPanel, type SpecimenPanelItem, type SpecimenPanelProps } from "./SpecimenPanel.js";
import type { SpecimenPart, SpecimenStatusRowsPart, SpecimenMeterPart } from "./parts.js";

const LABEL = "An order record showing its delivery fields, two checks with their states and the stock level against its floor.";

const FIELDS: SpecimenPart = {
  id: "fields",
  type: "fields",
  label: "Order",
  columns: 4,
  items: [
    { id: "ref", label: "Reference", value: "ORD-1042" },
    { id: "qty", label: "Quantity", value: "240 units" },
    { id: "due", label: "Due", value: "12 Mar" },
    { id: "site", label: "Site", value: "North yard" },
  ],
};

const STATUS_ROWS: SpecimenPart = {
  id: "checks",
  type: "status-rows",
  label: "Checks",
  items: [
    { id: "count", label: "Stock count", detail: "2 of 3 aisles", status: { tone: "warning", label: "In progress" } },
    { id: "label", label: "Labels printed", status: { tone: "success", label: "Done" } },
  ],
};

const METER: SpecimenPart = {
  id: "stock",
  type: "meter",
  label: "Stock level",
  value: 38,
  scaleMax: 100,
  limit: 25,
  direction: "min",
  tone: "success",
  valueText: "38 units",
  limitText: "floor 25",
  status: { tone: "success", label: "Above floor" },
  note: "13 units of headroom",
};

const TABLE: SpecimenPart = {
  id: "returns",
  type: "table",
  label: "Monthly returns",
  caption: "Returns received by store and month",
  columns: [
    { id: "store", label: "Store" },
    { id: "jan", label: "Jan" },
    { id: "feb", label: "Feb" },
  ],
  rows: [
    { id: "east", cells: [{ text: "East" }, { status: { tone: "success", label: "Received" } }, { status: { tone: "warning", label: "Due" } }] },
    { id: "west", cells: [{ text: "West" }, { status: { tone: "success", label: "Received" } }, { text: "4" }] },
  ],
};

const SCHEDULE: SpecimenPart = {
  id: "deliveries",
  type: "schedule",
  label: "Deliveries",
  items: [
    { id: "d1", date: "3 Mar", label: "First drop", amount: "120 units", status: { tone: "success", label: "Delivered" } },
    { id: "d2", date: "12 Mar", label: "Second drop", amount: "120 units", status: { tone: "neutral", label: "Scheduled" } },
  ],
};

const SHARES: SpecimenPart = {
  id: "split",
  type: "shares",
  label: "Allocation",
  items: [
    { id: "a", name: "North yard", share: 60, shareText: "60%" },
    { id: "b", name: "South yard", share: 40, shareText: "40%", status: { tone: "info", label: "Pending" } },
  ],
};

const FILES: SpecimenPart = {
  id: "files",
  type: "files",
  label: "Documents",
  items: [
    { id: "f1", format: "PDF", name: "Delivery note", source: "Shared drive" },
    { id: "f2", format: "XLS", name: "Stock sheet", source: "Email" },
  ],
};

const PANEL: SpecimenPanelItem = {
  id: "order",
  title: "Order 1042",
  meta: "Placed 1 Mar",
  status: { tone: "info", label: "Open" },
  parts: [FIELDS, STATUS_ROWS, METER],
  footer: { assignee: { initials: "AL", name: "Alex Lane", note: "owner" }, note: "Nothing is sent until someone reviews it." },
};

const PANEL_B: SpecimenPanelItem = { id: "b", title: "Returns", parts: [TABLE] };
const PANEL_C: SpecimenPanelItem = { id: "c", title: "Deliveries", parts: [SCHEDULE, SHARES, FILES] };

function renderSpecimen(props: Partial<SpecimenProps> = {}) {
  return render(<Specimen label={LABEL} panels={[PANEL]} {...props} />);
}

const FOCUSABLE = "a, button, input, select, textarea, summary, [tabindex], [contenteditable]";
const SCROLL = /(^|\s)([a-z-]+:)*overflow(-[xy])?-(auto|scroll)(\s|$)/;
/** Any grid wider than two columns without a breakpoint prefix would crowd a 390px column. */
const WIDE_BASE_GRID = /(^|\s)grid-cols-([3-9]|1[0-2])(\s|$)/;

describe("Specimen", () => {
  it("is one figure named by its required label", () => {
    renderSpecimen();
    const figure = screen.getByRole("figure", { name: LABEL });
    expect(figure).toHaveAttribute("data-arrangement", "single");
    expect(figure).toHaveClass("w-full", "min-w-0");
  });

  it("requires an accessible name", () => {
    expect(() => render(<Specimen label="" panels={[PANEL]} />)).toThrow(TypeError);
    expect(() => render(<Specimen label="   " panels={[PANEL]} />)).toThrow(/label is required/);
    // Deliberately invalid runtime input; the required-label type is checked separately.
    expect(() => render(<Specimen panels={[PANEL]} />)).toThrow(TypeError);
  });

  it("holds exactly one panel when single, two or three otherwise", () => {
    expect(() => renderSpecimen({ panels: [PANEL, PANEL_B] })).toThrow(RangeError);
    expect(() => renderSpecimen({ arrangement: "row", panels: [PANEL] })).toThrow(/2 to 3 panels/);
    expect(() =>
      renderSpecimen({ arrangement: "stack", panels: [PANEL, PANEL_B, PANEL_C, { ...PANEL, id: "d" }] }),
    ).toThrow(RangeError);
  });

  it("lays a row out one column at 390px, two from tablet, three from desktop", () => {
    const { container } = renderSpecimen({ arrangement: "row", panels: [PANEL, PANEL_B, PANEL_C] });
    const grid = container.querySelector("figure > div");
    expect(grid).toHaveClass("grid", "grid-cols-1", "tablet:grid-cols-2", "desktop:grid-cols-3");
    const panels = container.querySelectorAll("[data-specimen-panel]");
    expect(panels).toHaveLength(3);
    expect(panels[2]).toHaveClass("tablet:col-span-2", "desktop:col-span-1");
  });

  it("stacks panels down one column", () => {
    const { container } = renderSpecimen({ arrangement: "stack", panels: [PANEL, PANEL_B] });
    expect(container.querySelector("figure > div")).toHaveClass("flex", "flex-col", "gap-lg");
  });

  it("joins flow panels with a hairline connector and shows the caption once", () => {
    const { container } = renderSpecimen({ arrangement: "flow", connector: "Checked against the order", panels: [PANEL, PANEL_B, PANEL_C] });
    const connectors = container.querySelectorAll("[data-specimen-connector]");
    expect(connectors).toHaveLength(2);
    expect(screen.getAllByText("Checked against the order")).toHaveLength(1);
    const rule = connectors[0]?.querySelector("span");
    expect(rule).toHaveAttribute("aria-hidden", "true");
    expect(rule).toHaveClass("border-s", "border-line-strong");
  });

  it("allows a connector only with flow", () => {
    expect(() => renderSpecimen({ arrangement: "stack", connector: "Then", panels: [PANEL, PANEL_B] })).toThrow(/only with the flow/);
  });

  it("has no focusable descendants, no scrolling region and no wide base grid in any arrangement", () => {
    const all: SpecimenProps["arrangement"][] = ["single", "row", "stack", "flow"];
    for (const arrangement of all) {
      const panels = arrangement === "single" ? [PANEL] : [PANEL, PANEL_B, PANEL_C];
      const { container, unmount } = render(
        <Specimen label={LABEL} arrangement={arrangement} panels={panels} connector={arrangement === "flow" ? "Then" : undefined} />,
      );
      expect(container.querySelectorAll(FOCUSABLE)).toHaveLength(0);
      // `getAttribute`, not `className`: a status mark is an SVG, whose
      // `className` is an object rather than a string.
      for (const el of container.querySelectorAll("[class]")) {
        expect(el.getAttribute("class")).not.toMatch(SCROLL);
        expect(el.getAttribute("class")).not.toMatch(WIDE_BASE_GRID);
      }
      unmount();
    }
  });

  it("resets its own user-agent margins and padding, so it needs no consumer CSS reset", () => {
    // Every part type, a flow connector caption, a panel header and footer.
    const { container } = render(
      <Specimen label={LABEL} arrangement="flow" connector="Then" panels={[PANEL, PANEL_B, PANEL_C]} />,
    );
    const figure = container.querySelector("figure") as HTMLElement;
    expect(figure).toHaveClass("m-0");
    const resets: Array<[string, string[]]> = [
      ["p", ["m-0"]],
      ["dl", ["m-0"]],
      ["dd", ["m-0"]],
      ["ul", ["m-0", "p-0"]],
      ["ol", ["m-0"]],
      ["th", ["p-0"]],
      ["td", ["p-0"]],
    ];
    for (const [selector, classes] of resets) {
      const elements = container.querySelectorAll(selector);
      expect(elements.length, selector).toBeGreaterThan(0);
      for (const el of elements) expect(el, selector).toHaveClass(...classes);
    }
    // The schedule rail keeps its own inline-start padding; its rows are flex boxes, so no list marker renders.
    expect(container.querySelector("ol")).toHaveClass("ps-lg");
    for (const li of container.querySelectorAll("li")) expect(li).toHaveClass("flex");
  });
});

describe("SpecimenPanel", () => {
  it("uses native Card anatomy with the panel's existing elevation and responsive layout", () => {
    const { container } = render(<SpecimenPanel parts={[FIELDS]} title="Order" />);
    const panel = container.querySelector<HTMLElement>("[data-specimen-panel]");
    expect(panel).toHaveAttribute("data-slot", "card");
    expect(panel).toHaveAttribute("data-size", "default");
    expect(panel).not.toHaveAttribute("data-variant");
    expect(panel).toHaveClass("cn-card", "@container", "p-0");
    expect(panel?.style.boxShadow).toBe("var(--ui-elevation-panel, var(--ui-elevation-floating, 0 8px 24px rgba(0, 0, 0, 0.10)))");
    const body = panel?.querySelector(":scope > [data-specimen-panel-body]");
    expect(body).toHaveAttribute("data-slot", "card-content");
    expect(body).toHaveClass("flex", "flex-col", "gap-lg", "p-lg", "@md:p-xl");
  });

  it("shows title, meta and state as text, with no heading element", () => {
    render(<SpecimenPanel {...PANEL} />);
    expect(screen.getByText("Order 1042")).toHaveClass("text-body-l", "font-medium");
    expect(screen.getByText("Placed 1 Mar")).toHaveClass("text-body-s", "text-ink-secondary");
    expect(screen.getByText("Open").closest("[data-tone]")).toHaveAttribute("data-tone", "info");
    expect(screen.queryByRole("heading")).toBeNull();
  });

  it("separates header, parts and footer with hairlines", () => {
    const { container } = render(<SpecimenPanel {...PANEL} />);
    const divided = container.querySelectorAll<HTMLElement>("[data-specimen-panel-body] > .border-t");
    expect(divided).toHaveLength(4); // three parts and the footer
    for (const el of divided) expect(el.style.borderBlockStartWidth).toBe("var(--ui-border-hairline, 1px)");
  });

  it("omits the first divider when there is no header", () => {
    const { container } = render(<SpecimenPanel parts={[FIELDS, FILES]} />);
    expect(container.querySelectorAll("[data-specimen-panel-body] > .border-t")).toHaveLength(1);
  });

  it("shows the assignee's name as text and hides the initials disc", () => {
    render(<SpecimenPanel {...PANEL} />);
    expect(screen.getByText("Alex Lane")).toHaveClass("text-ink-primary");
    const disc = screen.getByText("AL");
    expect(disc).toHaveAttribute("aria-hidden", "true");
    expect(disc).toHaveClass("size-2xl", "rounded-pill", "bg-accent-tint", "text-accent-text");
    expect(screen.getByText("Nothing is sent until someone reviews it.")).toHaveClass("text-ink-secondary");
  });

  it("holds 1 to 3 parts", () => {
    expect(() => render(<SpecimenPanel parts={[]} />)).toThrow(RangeError);
    expect(() => render(<SpecimenPanel parts={[FIELDS, METER, FILES, SHARES]} />)).toThrow(/1 to 3 parts/);
  });
});

describe("Specimen parts", () => {
  it("renders fields as a description list, two columns until the panel itself is wide", () => {
    const { container } = render(<SpecimenPanel parts={[FIELDS]} />);
    const list = container.querySelector("dl");
    expect(list).toHaveClass("grid-cols-2", "@lg:grid-cols-4");
    expect(list?.className).not.toMatch(/tablet/);
    expect(within(list as HTMLElement).getByText("ORD-1042")).toHaveClass("tabular-nums");
    expect(container.querySelectorAll("dt")).toHaveLength(4);
    expect(screen.getByText("Order")).toHaveClass("text-body-s", "text-ink-secondary");
    expect(screen.getByText("Order").className).not.toMatch(/uppercase|text-caption/);
  });

  it("defaults fields to two columns and allows one", () => {
    const two = render(<SpecimenPanel parts={[{ ...FIELDS, columns: undefined } as SpecimenPart]} />);
    expect(two.container.querySelector("dl")).toHaveClass("grid-cols-2");
    expect(two.container.querySelector("dl")?.className).not.toMatch(/grid-cols-4/);
    two.unmount();
    const one = render(<SpecimenPanel parts={[{ ...FIELDS, columns: 1 } as SpecimenPart]} />);
    expect(one.container.querySelector("dl")).toHaveClass("grid-cols-1");
  });

  it("renders status rows as a list with states in words", () => {
    render(<SpecimenPanel parts={[STATUS_ROWS]} />);
    const items = within(screen.getByRole("list")).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[1]).toHaveClass("border-t", "pt-md");
    expect(screen.getByText("In progress")).toBeInTheDocument();
    expect(screen.getByText("2 of 3 aisles")).toHaveClass("tabular-nums");
  });

  it("renders a meter with its value, limit, state and note as text", () => {
    const { container } = render(<SpecimenPanel parts={[METER]} />);
    expect(screen.getByText("38 units")).toBeInTheDocument();
    expect(screen.getByText("floor 25")).toBeInTheDocument();
    expect(screen.getByText("Above floor")).toBeInTheDocument();
    expect(screen.getByText("13 units of headroom")).toHaveClass("text-body-s");
    expect(container.querySelector("[data-emphasis]")).toHaveAttribute("data-emphasis", "figure");
    expect(screen.getByText("38 units")).toHaveClass("text-h1", "@md:text-h0", "tabular-nums");
    expect(container.querySelector('[data-direction="min"]')).not.toBeNull();
  });

  it("renders a real table with a hidden caption, column and row headers", () => {
    const { container } = render(<SpecimenPanel parts={[TABLE]} />);
    const table = screen.getByRole("table", { name: "Returns received by store and month" });
    expect(container.querySelector("caption")).toHaveClass("sr-only");
    expect(within(table).getAllByRole("columnheader")).toHaveLength(3);
    expect(within(table).getAllByRole("rowheader").map((th) => th.textContent)).toEqual(["East", "West"]);
    expect(within(table).getAllByRole("cell")).toHaveLength(4);
  });

  it("reflows the table into stacked records until the panel reaches 28rem, whatever the viewport", () => {
    const { container } = render(<SpecimenPanel parts={[TABLE]} />);
    expect(container.querySelector("table")).toHaveClass("grid", "grid-cols-1", "@md:table");
    expect(container.querySelector("thead")).toHaveClass("sr-only", "@md:not-sr-only", "@md:table-header-group");
    expect(container.querySelector("tbody tr")).toHaveClass("flex", "flex-col", "@md:table-row");
    const cell = container.querySelector("td") as HTMLElement;
    expect(cell).toHaveClass("flex", "justify-between", "@md:table-cell");
    const label = cell.querySelector("span");
    expect(label).toHaveAttribute("aria-hidden", "true");
    expect(label).toHaveClass("@md:hidden");
    expect(container.querySelector("table")?.closest("[data-specimen-panel]")).toHaveClass("@container");
    expect(label).toHaveTextContent("Jan");
  });

  it("validates the table budget", () => {
    const wide = { ...TABLE, columns: [...(TABLE as { columns: object[] }).columns, { id: "x", label: "X" }, { id: "y", label: "Y" }] } as SpecimenPart;
    expect(() => render(<SpecimenPanel parts={[wide]} />)).toThrow(/columns must hold 1 to 4/);
    const row = (TABLE as { rows: { id: string }[] }).rows[0];
    const long = { ...TABLE, rows: Array.from({ length: 6 }, (_, i) => ({ ...row, id: "r" + i })) } as SpecimenPart;
    expect(() => render(<SpecimenPanel parts={[long]} />)).toThrow(/rows must hold 1 to 5/);
    const ragged = { ...TABLE, rows: [{ id: "r", cells: [{ text: "Only" }] }] } as SpecimenPart;
    expect(() => render(<SpecimenPanel parts={[ragged]} />)).toThrow(/one cell per column/);
  });

  it("renders a schedule as an ordered list on a hairline rail", () => {
    render(<SpecimenPanel parts={[SCHEDULE]} />);
    const list = screen.getByRole("list");
    expect(list.tagName).toBe("OL");
    expect(list).toHaveClass("border-s", "border-line-strong", "ps-lg");
    expect(list.style.borderInlineStartWidth).toBe("var(--ui-border-hairline, 1px)");
    expect(screen.getAllByText("120 units")[0]).toHaveClass("tabular-nums");
  });

  it("renders shares as percentage meters on a scale of 100", () => {
    const { container } = render(<SpecimenPanel parts={[SHARES]} />);
    expect(screen.getByText("60%")).toBeInTheDocument();
    const fills = container.querySelectorAll<HTMLElement>('[data-part="fill"]');
    expect(fills[0]?.style.inlineSize).toBe("60%");
    expect(screen.getByText("Pending")).toBeInTheDocument();
  });

  it("fills a plain share in the accent and a share with a status in that status's tone", () => {
    const { container } = render(<SpecimenPanel parts={[SHARES]} />);
    const meters = container.querySelectorAll<HTMLElement>("[data-tone][data-direction]");
    expect(meters[0]).toHaveAttribute("data-tone", "accent");
    expect(meters[1]).toHaveAttribute("data-tone", "info");
  });

  it("refuses a share outside 0 to 100", () => {
    const over = { ...SHARES, items: [{ id: "a", name: "A", share: 120, shareText: "120%" }] } as SpecimenPart;
    expect(() => render(<SpecimenPanel parts={[over]} />)).toThrow(/from 0 to 100/);
  });

  it("renders files with a mono format tag, name and source", () => {
    render(<SpecimenPanel parts={[FILES]} />);
    expect(screen.getByText("PDF")).toHaveClass("font-mono", "text-body-s", "uppercase", "border");
    expect(screen.getByText("Delivery note")).toHaveClass("text-body");
    expect(screen.getByText("Shared drive")).toHaveClass("text-ink-secondary");
  });

  it("holds at most six rows in a part", () => {
    const many = { ...FILES, items: Array.from({ length: 7 }, (_, i) => ({ id: "f" + i, format: "PDF", name: "File " + i })) } as SpecimenPart;
    expect(() => render(<SpecimenPanel parts={[many]} />)).toThrow(/must hold 1 to 6/);
    const none = { ...STATUS_ROWS, items: [] } as SpecimenPart;
    expect(() => render(<SpecimenPanel parts={[none]} />)).toThrow(RangeError);
  });

  it("keeps all small text off muted ink, which is only AA-large on the raised fill", () => {
    const { container } = render(<SpecimenPanel {...PANEL_C} />);
    for (const el of container.querySelectorAll("[class]")) expect(el.getAttribute("class")).not.toMatch(/text-ink-muted/);
  });
});

describe("SpecimenPanel inline anatomy markers", () => {
  it("puts markers first inside header title, every labelled part type including meter, and footer", () => {
    for (const part of [FIELDS, STATUS_ROWS, METER, TABLE, SCHEDULE, SHARES, FILES]) {
      const { container, unmount } = render(<SpecimenPanel title="Sample record" parts={[part]} footer={{ assignee: { initials: "AL", name: "Alex Lee" }, note: "Review exception" }} markers={{ header: 1, [part.id]: 2, footer: 3 }} />);
      const discs = [...container.querySelectorAll("[data-anatomy-marker]")];
      expect(discs).toHaveLength(3);
      for (const [index, disc] of discs.entries()) {
        expect(disc).toHaveAttribute("aria-hidden", "true");
        expect(disc).toHaveTextContent(String(index + 1));
        expect(disc.parentElement?.firstChild).toBe(disc);
        expect(disc.parentElement).toHaveClass("gap-sm");
      }
      expect(container.querySelector("[data-specimen-panel-header] p")?.firstChild).toBe(discs[0]);
      expect(container.querySelector("[data-specimen-panel-footer] > div")?.firstChild).toBe(discs[2]);
      unmount();
    }
  });
  it("puts a note-only footer marker first inline and never duplicates the footer marker", () => {
    const { container } = render(<SpecimenPanel parts={[FIELDS]} footer={{ note: "Review exception" }} markers={{ footer: 3 }} />);
    const disc = container.querySelector("[data-anatomy-marker]");
    expect(container.querySelectorAll("[data-anatomy-marker]")).toHaveLength(1);
    expect(container.querySelector("[data-specimen-panel-footer] > p")?.firstChild).toBe(disc);
    expect(disc?.parentElement).toHaveClass("flex", "items-center", "gap-sm");
  });
  it("preserves unmarked panel markup when no markers or an empty marker map is supplied", () => {
    const { container, rerender } = render(<SpecimenPanel title="Sample record" parts={[FIELDS, METER]} footer={{ note: "Review exception" }} />);
    const before = container.innerHTML;
    rerender(<SpecimenPanel title="Sample record" parts={[FIELDS, METER]} footer={{ note: "Review exception" }} markers={{}} />);
    expect(container.innerHTML).toBe(before);
    expect(container.querySelector("[data-anatomy-marker]")).toBeNull();
  });
  it("refuses targets without an actual label line", () => {
    for (const props of [
      { parts: [FIELDS], markers: { missing: 1 } },
      { parts: [FIELDS], markers: { header: 1 } },
      { parts: [{ ...FIELDS, label: undefined }], markers: { fields: 1 } },
      { parts: [FIELDS], footer: { note: false }, markers: { footer: 1 } },
    ]) expect(() => render(<SpecimenPanel {...props} />)).toThrow(RangeError);
    expect(() => render(<SpecimenPanel parts={[FIELDS]} markers={{ fields: 0 }} />)).toThrow(TypeError);
  });
});


describe("Specimen history, row caps and badges", () => {
  const rows: SpecimenStatusRowsPart = {
    id: "checks", type: "status-rows", label: "Checks",
    items: Array.from({ length: 6 }, (_, index) => ({
      id: `check-${index}`, label: `Check ${index + 1}`, detail: `Detail ${index + 1}`,
      status: { tone: "info" as const, label: `State ${index + 1}` },
    })),
  };

  it("retains every status row in the DOM and caps only later rows on mobile", () => {
    const { container, rerender } = render(<SpecimenPanel parts={[{ ...rows, mobileRows: 3 }]} />);
    const items = [...container.querySelectorAll("[data-specimen-part='status-rows'] li")];
    expect(items).toHaveLength(6);
    for (const [index, row] of items.entries()) {
      expect(within(row as HTMLElement).getByText(`Check ${index + 1}`)).toBeInTheDocument();
      expect(within(row as HTMLElement).getByText(`Detail ${index + 1}`)).toBeInTheDocument();
      expect(within(row as HTMLElement).getByText(`State ${index + 1}`)).toBeInTheDocument();
      if (index >= 3) expect(row).toHaveClass("max-tablet:hidden");
      else expect(row).not.toHaveClass("max-tablet:hidden");
      expect(row).not.toHaveClass("hidden");
    }
    rerender(<SpecimenPanel parts={[rows]} />);
    expect(container.querySelectorAll("[data-specimen-part='status-rows'] li")).toHaveLength(6);
    for (const row of container.querySelectorAll("li")) expect(row).not.toHaveClass("max-tablet:hidden");
  });

  it.each([0, 2, 4, null, "3"].map(mobileRows => ({ mobileRows })))("refuses unsupported mobile row cap %j", ({ mobileRows }) => {
    const part = { ...rows, mobileRows } as unknown as SpecimenStatusRowsPart;
    expect(() => render(<SpecimenPanel parts={[part]} />)).toThrow(/mobileRows/);
  });

  it("keeps the full row budget even when mobile rows are capped", () => {
    expect(() => render(<SpecimenPanel parts={[{ ...rows, mobileRows: 3, items: [] }]} />)).toThrow(/1 to 6/);
    expect(() => render(<SpecimenPanel parts={[{ ...rows, mobileRows: 3, items: [...rows.items, { ...rows.items[0]!, id: "seventh" }] }]} />)).toThrow(/1 to 6/);
  });

  it.each([
    { tone: undefined, fill: "bg-surface-sunken", ink: "text-ink-secondary" },
    { tone: "neutral", fill: "bg-surface-sunken", ink: "text-ink-secondary" },
    { tone: "success", fill: "bg-status-success-tint", ink: "text-status-success-text" },
    { tone: "warning", fill: "bg-status-warning-tint", ink: "text-status-warning-text" },
    { tone: "danger", fill: "bg-status-danger-tint", ink: "text-status-danger-text" },
    { tone: "info", fill: "bg-status-info-tint", ink: "text-status-info-text" },
  ] as const)("renders badge tone $tone alongside the existing title and status", ({ tone, fill, ink }) => {
    const { container } = render(<SpecimenPanel {...PANEL} badge={{ label: "Reviewed record", tone }} />);
    const badge = screen.getByText("Reviewed record");
    expect(badge).toBeVisible();
    expect(badge).toHaveClass("rounded-pill", fill, ink);
    if (tone !== undefined && tone !== "neutral") expect(badge.parentElement).toHaveClass("inline-flex", "rounded-pill", "bg-surface-base");
    else expect(badge.parentElement).not.toHaveClass("bg-surface-base");
    expect(badge.closest("[data-specimen-panel-header]")).not.toBeNull();
    expect(screen.getByText("Order 1042")).toBeInTheDocument();
    expect(screen.getByText("Open").closest("[data-tone]")).toHaveAttribute("data-tone", "info");
    expect(container.querySelector(FOCUSABLE)).toBeNull();
  });

  it("creates a badge-only header and its first divider and forwards panel badge through Specimen", () => {
    const { container, rerender } = render(<SpecimenPanel parts={[FIELDS]} badge={{ label: "Reviewed record" }} />);
    expect(container.querySelector("[data-specimen-panel-header]")).not.toBeNull();
    expect(container.querySelectorAll("[data-specimen-panel-body] > .border-t")).toHaveLength(1);
    rerender(<Specimen label={LABEL} panels={[{ id: "badge-only", parts: [FIELDS], badge: { label: "Reviewed record", tone: "success" } }]} />);
    expect(screen.getByText("Reviewed record")).toHaveClass("bg-status-success-tint");
    expect(container.querySelector("[data-specimen-panel]")).not.toHaveAttribute("id");
  });

  it.each([
    null, { label: "Badge", tone: "accent" }, { label: "Badge", tone: "constructor" },
    { label: "" }, { label: " " }, { label: false }, { label: <span key="empty" /> },
  ].map(badge => ({ badge })))("refuses malformed panel badges %j", ({ badge }) => {
    expect(() => render(<SpecimenPanel parts={[FIELDS]} badge={badge as unknown as SpecimenPanelProps["badge"]} />)).toThrow(/badge/i);
  });

  it("forwards history to the same figure Meter while retaining limit, note and state", () => {
    const history: SpecimenMeterPart = { ...METER, previous: 20, previousText: "Previously 20 units" };
    const { container } = render(<SpecimenPanel parts={[history]} />);
    expect(screen.getByText("Previously 20 units")).toBeVisible();
    expect(screen.getByText("Previously 20 units").closest("[aria-hidden='true']")).toBeNull();
    const meter = container.querySelector("[data-emphasis='figure']");
    expect(meter?.querySelector("[data-part='previous']")).not.toBeNull();
    expect(meter?.querySelector("[data-part='limit']")).not.toBeNull();
    expect(screen.getByText("38 units")).toHaveClass("text-h1", "@md:text-h0");
    expect(screen.getByText("floor 25")).toBeInTheDocument();
    expect(screen.getByText("Above floor")).toBeInTheDocument();
    expect(screen.getByText("13 units of headroom")).toBeInTheDocument();
  });

  it.each([
    { previous: 20 }, { previousText: "Previously 20 units" },
    { previous: -1, previousText: "Previous value" },
    { previous: Number.NaN, previousText: "Previous value" },
    { previous: 101, previousText: "Previous value" },
  ])("refuses invalid history through the Specimen adapter %j", props => {
    expect(() => render(<SpecimenPanel parts={[{ ...METER, ...props }]} />)).toThrow(/previous/i);
  });
});
