import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { Matrix, type MatrixProps } from "../Matrix.js";

type Grid = Extract<MatrixProps, { arrangement: "grid" }>;
const LABELS = ["No coverage", "Quarter coverage", "Half coverage", "Three-quarter coverage", "Full coverage"] as const;
const grid = (): Grid => ({
  arrangement: "grid", "aria-label": "Coverage comparison",
  columns: [{ id: "coverage", label: "Coverage" }, { id: "detail", label: "Detail" }],
  rows: LABELS.map((_, value) => ({ id: `row-${value}`, label: `Record ${value}`, cells: {
    coverage: { type: "mark", value }, detail: { type: "text", text: `Detail ${value}` },
  } })),
  markLabels: [...LABELS], keyLabel: "Coverage key",
} as unknown as Grid);
const html = (patch: Record<string, unknown> = {}) => renderToStaticMarkup(<Matrix {...{ ...grid(), ...patch } as Grid} />);
const marks = (table: HTMLElement) => [...table.querySelectorAll("tbody td:first-of-type svg")];

describe("Matrix Harvey marks", () => {
  it("renders five distinct geometries for values 0 to 4", () => {
    render(<Matrix {...grid()} />);
    const glyphs = marks(screen.getByRole("table"));
    expect(glyphs).toHaveLength(5);
    const geometry = glyphs.map(svg => [...svg.querySelectorAll("path, circle")].map(shape => [shape.tagName, ...[...shape.attributes].filter(attribute => ["d", "cx", "cy", "r"].includes(attribute.name)).map(attribute => `${attribute.name}=${attribute.value}`)].join(" ")).join("|"));
    expect(new Set(geometry).size).toBe(5);
    for (const svg of glyphs) {
      expect(svg).toHaveAttribute("aria-hidden", "true");
      expect(svg).toHaveAttribute("focusable", "false");
      expect(svg).toHaveClass("size-lg");
    }
    expect(glyphs.map(svg => svg.querySelectorAll("path").length)).toEqual([0, 1, 2, 3, 4]);
  });

  it("strokes the ring with the hairline variable", () => {
    render(<Matrix {...grid()} />);
    for (const svg of marks(screen.getByRole("table"))) {
      const ring = svg.querySelector("circle")!;
      expect(ring.style.strokeWidth).toBe("var(--ui-border-hairline, 1px)");
      expect(ring).toHaveClass("stroke-current", "text-ink-secondary");
      expect(ring).toHaveAttribute("fill", "none");
      for (const quarter of svg.querySelectorAll("path")) expect(quarter).toHaveClass("fill-current", "text-ink-primary");
    }
  });

  it("voices markLabels per value and throws without them", () => {
    render(<Matrix {...grid()} />);
    const table = screen.getByRole("table", { name: "Coverage comparison" });
    for (const label of LABELS) {
      const cell = within(table).getByRole("cell", { name: label });
      expect(within(cell).getByText(label)).toHaveClass("sr-only");
    }
    expect(() => html({ markLabels: undefined })).toThrow(/markLabels/);
    expect(table).not.toHaveAttribute("markLabels");
    expect(table).not.toHaveAttribute("keyLabel");
  });

  it("lists all five marks under the grid headed by keyLabel", () => {
    render(<Matrix {...grid()} />);
    const table = screen.getByRole("table");
    const heading = screen.getByRole("heading", { name: "Coverage key", level: 3 });
    const key = screen.getByRole("list");
    expect(table.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(heading.compareDocumentPosition(key) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(key.closest("table")).toBeNull();
    const entries = within(key).getAllByRole("listitem");
    expect(entries.map(entry => entry.textContent)).toEqual([...LABELS]);
    expect(entries.map(entry => entry.querySelectorAll("svg path").length)).toEqual([0, 1, 2, 3, 4]);
    for (const entry of entries) {
      expect(entry.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
      expect(entry.querySelector(".sr-only")).toBeNull();
    }
  });

  it.each([undefined, null, false, " ", []].map(keyLabel => ({ keyLabel })))("requires a meaningful keyLabel for marks ($keyLabel)", ({ keyLabel }) => {
    expect(() => html({ keyLabel })).toThrow(/keyLabel/);
  });

  it.each([[], Array(5), LABELS.slice(1), [...LABELS, "Extra"], [" ", ...LABELS.slice(1)], [null, ...LABELS.slice(1)]].map(markLabels => ({ markLabels })))("requires five dense meaningful markLabels ($markLabels)", ({ markLabels }) => {
    expect(() => html({ markLabels })).toThrow(/markLabels/);
  });

  it.each([-1, 5, 1.5, NaN, "1", undefined, null])("refuses unsupported mark value %j", value => {
    const props = grid();
    const rows = props.rows.map((row, index) => index === 0 ? { ...row, cells: { ...row.cells, coverage: { type: "mark", value } } } : row);
    expect(() => html({ rows })).toThrow(/mark.*value|value.*mark/);
  });

  it("keeps the non-empty cell type uniform in each mark column", () => {
    const props = grid();
    expect(() => html({ rows: props.rows.map((row, index) => index === 0 ? { ...row, cells: { ...row.cells, coverage: { type: "text", text: "Different kind" } } } : row) })).toThrow(/column.*type|type.*column/);
    expect(() => html({ emptyLabel: "Not measured", rows: props.rows.map((row, index) => index === 0 ? { ...row, cells: { ...row.cells, coverage: { type: "empty" } } } : row) })).not.toThrow();
  });

  it("omits the key and refuses mark copy when there are no mark cells", () => {
    const props = grid();
    const rows = props.rows.map(row => ({ ...row, cells: { ...row.cells, coverage: { type: "text" as const, text: "Measured" } } }));
    render(<Matrix {...{ ...props, rows, markLabels: undefined, keyLabel: undefined } as Grid} />);
    expect(screen.queryByRole("list")).toBeNull();
    expect(() => html({ rows })).toThrow(/markLabels|keyLabel/);
    expect(() => html({ rows, keyLabel: undefined })).toThrow(/markLabels/);
    expect(() => html({ rows, markLabels: undefined })).toThrow(/keyLabel/);
  });

  it.each(["base", "sunken", "inverse"] as const)("uses ground ink and preserves authored table attributes (%s)", ground => {
    render(<Matrix {...grid()} ground={ground} id="coverage-grid" dir="rtl" headingLevel={4} style={{ inlineSize: "100%" }} />);
    const table = screen.getByRole("table");
    expect(table).toHaveAttribute("id", "coverage-grid");
    expect(table).toHaveAttribute("dir", "rtl");
    expect(table).toHaveStyle({ inlineSize: "100%" });
    const key = screen.getByRole("heading", { name: "Coverage key", level: 4 }).parentElement!;
    expect(key).toHaveAttribute("dir", "rtl");
    for (const svg of marks(table)) {
      expect(svg.querySelector("circle")).toHaveClass(ground === "inverse" ? "text-ink-on-inverse-muted" : "text-ink-secondary");
      for (const quarter of svg.querySelectorAll("path")) expect(quarter).toHaveClass(ground === "inverse" ? "text-ink-on-inverse" : "text-ink-primary");
    }
  });

  it("accepts authored zero copy and renders server markup without English defaults", () => {
    const markup = html({ keyLabel: 0, markLabels: [0, 1, 2, 3, 4] });
    expect(markup).toContain('class="sr-only">0</span>');
    expect(markup).not.toMatch(/Coverage key|Quarter coverage|Full coverage/);
  });
});
