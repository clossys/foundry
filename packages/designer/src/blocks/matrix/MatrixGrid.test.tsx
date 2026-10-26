import { createHash } from "node:crypto";
import { useId, type ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { Matrix, type MatrixProps } from "../Matrix.js";

type Grid = Extract<MatrixProps, { arrangement: "grid" }>;
type Cell = Grid["rows"][number]["cells"][string];
const grid = (count = 3): Grid => ({
  arrangement: "grid", "aria-label": "Authored comparison",
  columns: Array.from({ length: count }, (_, index) => ({ id: `column-${index}`, label: `Column ${index + 1}` })),
  rows: ["Current record", "Previous record"].map((label, row) => ({
    id: `row-${row}`, label, ...(row === 0 ? { description: "Supporting context." } : {}),
    cells: Object.fromEntries(Array.from({ length: count }, (_, column) => [`column-${column}`,
      column === 1 ? { type: "figure", value: row === 0 ? "2,481" : 0, delta: row === 0 ? "+12%" : "-3%", trend: row === 0 ? "up" : "down" }
        : column === 2 ? { type: "status", tone: row === 0 ? "success" : "warning", label: row === 0 ? "Reviewed" : "Needs review" }
          : { type: "text", text: `Copy ${row + 1}-${column + 1}` },
    ])),
  })),
});
const html = (props: Grid) => renderToStaticMarkup(<Matrix {...props} />);
const attempt = (patch: Record<string, unknown>) => html({ ...grid(), ...patch } as Grid);
function withCell(props: Grid, rowIndex: number, column: string, cell: Cell): Grid {
  return { ...props, rows: props.rows.map((row, index) => index === rowIndex ? { ...row, cells: { ...row.cells, [column]: cell } } : row) };
}

describe("Matrix grid", () => {
  it("renders explicit roles and th scope", () => {
    const { container } = render(<Matrix {...grid()} />);
    const table = screen.getByRole("table", { name: "Authored comparison" });
    expect(table.tagName).toBe("TABLE");
    expect(table).toHaveAttribute("role", "table");
    expect(container.querySelectorAll("table")).toHaveLength(1);
    expect(within(table).getAllByRole("row")).toHaveLength(3);
    for (const row of table.querySelectorAll("tr")) expect(row).toHaveAttribute("role", "row");
    const columns = within(table).getAllByRole("columnheader");
    expect(columns.map(node => node.textContent)).toEqual(["Column 1", "Column 2", "Column 3"]);
    for (const header of columns) { expect(header.tagName).toBe("TH"); expect(header).toHaveAttribute("scope", "col"); }
    const rows = within(table).getAllByRole("rowheader");
    expect(rows).toHaveLength(2);
    for (const header of rows) { expect(header.tagName).toBe("TH"); expect(header).toHaveAttribute("scope", "row"); }
    expect(within(table).getAllByRole("cell")).toHaveLength(6);
    for (const cell of table.querySelectorAll("tbody td")) expect(cell).toHaveAttribute("role", "cell");
  });

  it.each([2, 3, 4, 5, 6])("picks the table breakpoint by column count (%i)", count => {
    const { container } = render(<Matrix {...grid(count)} />);
    const table = screen.getByRole("table");
    const breakpoint = count <= 4 ? "tablet" : "tablet-lg";
    const other = count <= 4 ? "tablet-lg" : "tablet";
    expect(table).toHaveClass("block", `${breakpoint}:table`);
    expect(table).not.toHaveClass(`${other}:table`);
    expect(container.querySelector("thead")).toHaveClass("sr-only", `${breakpoint}:not-sr-only`, `${breakpoint}:table-header-group`);
    expect(container.querySelector("tbody tr")).toHaveClass("flex", `${breakpoint}:table-row`);
    expect(container.querySelector("tbody td")).toHaveClass(`${breakpoint}:table-cell`);
  });

  it("hides card labels and voices empty cells", () => {
    const props = { ...withCell(grid(), 1, "column-2", { type: "empty" }), emptyLabel: "No authored value" };
    const { container } = render(<Matrix {...props} />);
    for (const cell of container.querySelectorAll("tbody td")) {
      const label = cell.firstElementChild!;
      expect(label.tagName).toBe("SPAN");
      expect(label).toHaveAttribute("aria-hidden", "true");
      expect(label).toHaveClass("tablet:hidden");
    }
    expect(screen.getByText("No authored value")).toHaveClass("sr-only");
    expect(screen.getByRole("cell", { name: "No authored value" })).toContainElement(screen.getByText("No authored value"));
    expect(screen.getByRole("cell", { name: "Copy 1-1" })).toHaveTextContent("Column 1Copy 1-1");
  });

  it("keeps interactive column labels exposed in headers and inert in card mirrors", () => {
    const props = grid();
    props.columns = props.columns.map((column, index) => index === 0 ? {
      ...column,
      label: <span><a href="#authored-column-details">Authored details</a><button type="button">Authored action</button><span tabIndex={0}>Authored keyboard note</span></span>,
    } : column);
    const { container } = render(<Matrix {...props} />);
    const header = screen.getByRole("columnheader", { name: /Authored details/ });
    expect(within(header).getByRole("link", { name: "Authored details" })).toHaveAttribute("href", "#authored-column-details");
    expect(within(header).getByRole("button", { name: "Authored action" })).toHaveAttribute("type", "button");
    expect(header.closest("[inert]")).toBeNull();
    for (const cell of container.querySelectorAll("tbody td")) {
      expect(cell.firstElementChild).toHaveAttribute("aria-hidden", "true");
      expect(cell.firstElementChild).toHaveAttribute("inert");
    }
    const serverDocument = new DOMParser().parseFromString(html(props), "text/html");
    const mirrors = serverDocument.querySelectorAll("tbody td > span[aria-hidden='true']");
    expect(mirrors).toHaveLength(6);
    for (const mirror of mirrors) expect(mirror.hasAttribute("inert")).toBe(true);
    expect(serverDocument.querySelectorAll("thead a")).toHaveLength(1);
    expect(serverDocument.querySelectorAll("tbody a")).toHaveLength(2);
  });

  it("featured column shows a Badge, needs featuredLabel", () => {
    const props = { ...grid(), featured: { column: "column-1" }, featuredLabel: "Selected measure" };
    render(<Matrix {...props} />);
    const header = screen.getByRole("columnheader", { name: "Column 2 Selected measure" });
    const badge = within(header).getByText("Selected measure");
    expect(badge).toHaveClass("rounded-pill", "text-caption");
    expect(header).toHaveClass("border-t-accent");
    expect(header.style.borderBlockStartWidth).toBe("var(--ui-border-hairline, 1px)");
    expect(() => html({ ...props, featuredLabel: undefined })).toThrow(/featuredLabel/);
  });

  it("features one row header without reordering either axis", () => {
    const { container } = render(<Matrix {...grid()} featured={{ row: "row-1" }} featuredLabel="Selected row" headingLevel={5} />);
    const selected = screen.getByRole("rowheader", { name: /Previous record/ });
    expect(within(selected).getByText("Selected row")).toHaveClass("rounded-pill");
    expect(selected).toHaveClass("border-s-accent");
    expect(selected.style.borderInlineStartWidth).toBe("var(--ui-border-hairline, 1px)");
    expect([...container.querySelectorAll("tbody th h5")].map(node => node.textContent)).toEqual(["Current record", "Previous record"]);
    expect(screen.getAllByRole("columnheader").map(node => node.textContent)).toEqual(["Column 1", "Column 2", "Column 3"]);
  });

  it("throws on mixed cell types in a column", () => {
    expect(() => html(withCell(grid(), 1, "column-1", { type: "text", text: "Different kind" }))).toThrow(/column.*type|type.*column/);
    expect(() => html({ ...withCell(grid(), 1, "column-1", { type: "empty" }), emptyLabel: "No value" })).not.toThrow();
  });

  it("renders text, end-aligned tabular figures and visibly labelled StatusMarks", () => {
    render(<Matrix {...grid()} />);
    expect(screen.getByText("Copy 1-1")).toHaveClass("text-body-s");
    expect(screen.getByText("2,481")).toHaveClass("tabular-nums");
    expect(screen.getByText("2,481").closest("td")).toHaveClass("text-end");
    expect(screen.getByText("+12%")).toHaveClass("text-status-success-text");
    expect(screen.getByText("-3%")).toHaveClass("text-status-danger-text");
    expect(screen.getByText("Reviewed").closest("[data-tone]")).toHaveAttribute("data-tone", "success");
    expect(screen.getByText("Needs review").closest("[data-tone]")?.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByText("0", { exact: true })).toBeInTheDocument();
  });

  it.each(["base", "sunken", "inverse"] as const)("uses grounded tokens and checked status/delta backings (%s)", ground => {
    render(<Matrix {...grid()} ground={ground} featured={{ column: "column-1" }} featuredLabel="Selected" />);
    expect(screen.getByRole("columnheader", { name: /Column 2/ })).toHaveClass(ground === "inverse" ? "border-t-accent-on-inverse" : "border-t-accent");
    const delta = screen.getByText("+12%");
    const status = screen.getByText("Reviewed").closest("[data-tone]");
    if (ground === "inverse") { expect(delta).toHaveClass("bg-surface-raised"); expect(status).toHaveClass("bg-surface-raised"); }
    else { expect(delta).not.toHaveClass("bg-surface-raised"); expect(status).not.toHaveClass("bg-surface-raised"); }
  });

  it("forwards authored labels, ids, styles and direction to the table", () => {
    const props = grid(); delete props["aria-label"];
    render(<><h2 id="comparison-title">Authored title</h2><Matrix {...props} aria-labelledby="comparison-title" id="authored-grid" dir="rtl" className="authored-grid" style={{ inlineSize: "100%" }} /></>);
    const table = screen.getByRole("table", { name: "Authored title" });
    expect(table).toHaveAttribute("id", "authored-grid");
    expect(table).toHaveAttribute("dir", "rtl");
    expect(table).toHaveClass("authored-grid");
    expect(table).toHaveStyle({ inlineSize: "100%" });
    expect(table).not.toHaveAttribute("arrangement");
    expect(screen.getByText("Supporting context.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Current record", level: 3 })).toBeInTheDocument();
  });

  it.each([0, 1, 7])("refuses unsupported column count %i", count => expect(() => html(grid(count))).toThrow(/columns/));
  it.each([0, 1, 9])("refuses unsupported row count %i", count => {
    const props = grid();
    expect(() => html({ ...props, rows: Array.from({ length: count }, (_, i) => ({ ...props.rows[0]!, id: `row-${i}` })) })).toThrow(/rows/);
  });
  it("accepts all supported row counts", () => {
    const props = grid(6);
    for (let count = 2; count <= 8; count++) expect(() => html({ ...props, rows: Array.from({ length: count }, (_, i) => ({ ...props.rows[0]!, id: `row-${i}` })) })).not.toThrow();
  });
  it.each(["columns", "rows"])("refuses sparse %s", axis => expect(() => attempt({ [axis]: Array(2) })).toThrow(/dense/));
  it.each(["", "two words", "column-0"])("refuses malformed or duplicate column id %j", id => {
    const props = grid(); expect(() => html({ ...props, columns: [props.columns[0]!, { id, label: "Second" }] })).toThrow(/id/);
  });
  it.each(["", "two words", "row-0"])("refuses malformed or duplicate row id %j", id => {
    const props = grid(); expect(() => html({ ...props, rows: [props.rows[0]!, { ...props.rows[1]!, id }] })).toThrow(/id/);
  });
  it("requires exactly the column keys as own properties in every row", () => {
    const props = grid();
    for (const cells of [{ "column-0": { type: "text", text: "One" } }, { ...props.rows[0]!.cells, extra: { type: "text", text: "Extra" } }, Object.create(props.rows[0]!.cells)]) {
      expect(() => html({ ...props, rows: [{ ...props.rows[0]!, cells }, props.rows[1]!] })).toThrow(/cells.*column|column.*cells/);
    }
  });
  it.each([undefined, null, false, " ", []])("refuses blank authored labels %j", label => {
    const props = grid();
    expect(() => html({ ...props, columns: [{ ...props.columns[0]!, label }, ...props.columns.slice(1)] })).toThrow(/label/);
    expect(() => html({ ...props, rows: [{ ...props.rows[0]!, label }, props.rows[1]!] })).toThrow(/label/);
  });
  it("accepts authored zero labels and values", () => {
    const props = withCell(grid(), 0, "column-0", { type: "text", text: 0 });
    expect(() => html({ ...props, columns: props.columns.map(col => ({ ...col, label: 0 })), rows: props.rows.map(row => ({ ...row, label: 0 })) })).not.toThrow();
  });
  it.each([{}, { row: "unknown" }, { column: "unknown" }, { row: "row-0", column: "column-0" }])("refuses invalid featured target %j", featured => expect(() => attempt({ featured, featuredLabel: "Selected" })).toThrow(/featured/));
  it.each([undefined, null, false, " ", []])("requires meaningful featuredLabel when featured %j", featuredLabel => expect(() => attempt({ featured: { row: "row-0" }, featuredLabel })).toThrow(/featuredLabel/));
  it("refuses featuredLabel without a featured target", () => expect(() => attempt({ featuredLabel: "Selected" })).toThrow(/featuredLabel/));
  it("requires emptyLabel iff an empty cell exists", () => {
    expect(() => html(withCell(grid(), 0, "column-0", { type: "empty" }))).toThrow(/emptyLabel/);
    expect(() => attempt({ emptyLabel: "No value" })).toThrow(/emptyLabel/);
    expect(() => html({ ...withCell(grid(), 0, "column-0", { type: "empty" }), emptyLabel: " " })).toThrow(/emptyLabel/);
  });
  it.each([null, {}, { type: "other" }, { type: "text", text: " " }, { type: "figure", value: " " }, { type: "figure", value: 1, trend: "up" }, { type: "figure", value: 1, delta: "+1", trend: "other" }, { type: "status", tone: "other", label: "State" }, { type: "status", tone: "success", label: " " }])("refuses malformed cell %j", cell => expect(() => html(withCell(grid(), 0, "column-0", cell as Cell))).toThrow(/cell|figure|status/));
  it("refuses unknown ground, heading level and arrangement", () => {
    expect(() => attempt({ ground: "other" })).toThrow(/ground/);
    expect(() => attempt({ headingLevel: 1 })).toThrow(/heading/);
    expect(() => attempt({ arrangement: "other" })).toThrow(/arrangement/);
  });
});

function Authored({ name }: { name: string }) { const id = useId(); return <span id={id}>{name}</span>; }

describe("Matrix unchanged sides", () => {
  it("matches 96 immutable base HTML records, including authored useId slots", () => {
    const records: { key: string; html: string }[] = [];
    for (const ground of ["base", "sunken", "inverse"] as const) for (const form of ["points", "visual"]) for (const explicit of [false, true]) for (const nested of [false, true]) for (const labels of [false, true]) for (const headingLevel of [3, 6] as const) {
      const node = (name: string): ReactNode => nested ? <Authored name={name} /> : name;
      const sides = ["first", "second"].map((id, i) => ({ id, ...(labels ? { label: node(`Label ${i}`) } : {}), heading: node(`Heading ${i}`), ...(i === 0 ? { description: node("Supporting copy") } : {}), ...(form === "points" ? { points: [node(`Point ${i}a`), node(`Point ${i}b`)] } : { visual: node(`Visual ${i}`) }) })) as Extract<MatrixProps, { arrangement?: "sides" }>["sides"];
      const props = { sides, ground, headingLevel, featured: "second", id: "authored-matrix", "aria-label": "Authored comparison", "data-reference": "comparison", className: "authored-comparison", style: { inlineSize: "100%" }, ...(explicit ? { arrangement: "sides" as const } : {}) };
      records.push({ key: `${ground}/${form}/${explicit}/${nested}/${labels}/${headingLevel}`, html: renderToStaticMarkup(<Matrix {...props} />) });
    }
    expect(records).toHaveLength(96);
    // Captured from valid legacy inputs before implementation; both new sides modes
    // must consume arrangement and match that raw HTML without ID normalization.
    expect(createHash("sha256").update(JSON.stringify(records)).digest("hex")).toBe("8120b98c4b9fecf4c87bf90943ffa74e6aeddc406a48f72f71aa4d1a5e169a41");
  });
});

it("S4-6 preserves the grid table root, authored attributes and row heading outline", () => {
  let clicks = 0;
  const { container } = render(<Matrix {...grid()} id="grid" dir="rtl" data-host="yes" className="authored-grid" style={{ marginTop: 7 }} onClick={() => clicks++} />);
  const root = container.firstElementChild as HTMLElement;
  expect(root.tagName).toBe("TABLE");
  expect(root).toHaveAttribute("id", "grid");
  expect(root).toHaveAttribute("dir", "rtl");
  expect(root).toHaveAttribute("data-host", "yes");
  expect(root).toHaveClass("authored-grid");
  expect(root.style.marginTop).toBe("7px");
  expect(root.querySelectorAll("[data-designer-section-frame]")).toHaveLength(0);
  expect(root.querySelectorAll("#grid")).toHaveLength(0);
  root.click(); expect(clicks).toBe(1);
});
