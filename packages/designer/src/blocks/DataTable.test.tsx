import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Key, SortDescriptor } from "react-aria-components";
import { DataTable, type DataTableColumn } from "./DataTable.js";
import type { DataTableViewModelV1 } from "./data-table/view-model.js";

interface PromptRow {
  id: string;
  name: string;
  runs: number;
}

const ROWS: PromptRow[] = [
  { id: "1", name: "Ada", runs: 12 },
  { id: "2", name: "Grace", runs: 4 },
  { id: "3", name: "Alan", runs: 9 },
];

const COLUMNS: DataTableColumn<PromptRow>[] = [
  { id: "name", header: "Name", cell: (row) => row.name, isRowHeader: true, allowsSorting: true },
  { id: "runs", header: "Runs", cell: (row) => row.runs, allowsSorting: true },
];

describe("DataTable", () => {
  it("accepts a v1 saved view and always emits the v2 envelope", async () => {
    const user = userEvent.setup();
    const changed = vi.fn();
    const model: DataTableViewModelV1 = {
      version: 1, table: { version: 1, columns: [{ id: "name", kind: "text" }, { id: "runs", kind: "number" }], collation: { locale: "en" }, filters: [{ column: "runs", kind: "number", op: "range", min: 0 }] },
      mode: "flat", density: "comfortable", sort: [], visibleColumns: ["name", "runs"],
    };
    render(<DataTable aria-label="Prompts" columns={COLUMNS} rows={ROWS} rowKey={row => row.id} model={model} onModelChange={changed} />);
    await user.click(screen.getByRole("button", { name: /Density/ }));
    await user.click(screen.getByRole("option", { name: "Compact" }));
    expect(changed).toHaveBeenCalledTimes(1);
    expect(changed.mock.lastCall![0]).toEqual({ ...model, version: 2, density: "compact" });
    expect(model.version).toBe(1);
  });
  it.each([
    { name: "populated default", rows: ROWS, isLoading: false, selectionMode: "none" as const, rowCount: 4 },
    { name: "empty default", rows: [], isLoading: false, selectionMode: "none" as const, rowCount: 2 },
    { name: "loading default", rows: ROWS, isLoading: true, selectionMode: "none" as const, rowCount: 6 },
    { name: "controlled selection", rows: ROWS, isLoading: false, selectionMode: "multiple" as const, rowCount: 4 },
  ])("omits the unstyled framework body class with $name", ({ rows, isLoading, selectionMode, rowCount }) => {
    render(
      <DataTable
        aria-label="Prompts"
        columns={COLUMNS}
        rows={rows}
        rowKey={(row) => row.id}
        isLoading={isLoading}
        selectionMode={selectionMode}
        {...(selectionMode === "multiple" ? { selectedKeys: new Set(["1"]), onSelectionChange: vi.fn() } : {})}
      />,
    );
    const grid = screen.getByRole("grid", { name: "Prompts" });
    const body = grid.querySelector("tbody");
    expect(body).not.toBeNull();
    expect(body).not.toHaveClass("react-aria-TableBody");
    expect(within(grid).getAllByRole("row")).toHaveLength(rowCount);
    if (selectionMode === "multiple") {
      expect(within(grid).getByRole("checkbox", { name: /Select row.*Ada/ })).toBeChecked();
    } else {
      expect(within(grid).queryByRole("checkbox")).not.toBeInTheDocument();
    }
    if (isLoading) expect(within(grid).queryByText("Ada")).not.toBeInTheDocument();
    else if (rows.length === 0) expect(within(grid).getByRole("heading", { name: "No results" })).toBeInTheDocument();
    else expect(within(grid).getByText("Ada")).toBeInTheDocument();
  });

  it("renders a grid with a columnheader per column and a row per data row", () => {
    render(<DataTable aria-label="Prompts" columns={COLUMNS} rows={ROWS} rowKey={(row) => row.id} />);
    expect(screen.getByRole("grid", { name: "Prompts" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Name" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Runs" })).toBeInTheDocument();
    const adaRow = screen.getByRole("row", { name: /Ada/ });
    expect(within(adaRow).getByText("Ada")).toBeInTheDocument();
    expect(within(adaRow).getByText("12")).toBeInTheDocument();
  });

  it("calls onSortChange with the toggled sort descriptor when a sortable column header is activated", async () => {
    const onSortChange = vi.fn();
    const user = userEvent.setup();
    render(
      <DataTable
        aria-label="Prompts"
        columns={COLUMNS}
        rows={ROWS}
        rowKey={(row) => row.id}
        sortDescriptor={{ column: "name", direction: "ascending" }}
        onSortChange={onSortChange}
      />,
    );

    await user.click(screen.getByRole("columnheader", { name: "Name" }));
    expect(onSortChange).toHaveBeenCalledWith({ column: "name", direction: "descending" });

    await user.click(screen.getByRole("columnheader", { name: "Runs" }));
    expect(onSortChange).toHaveBeenCalledWith({ column: "runs", direction: "ascending" });
  });

  it("never re-sorts rows itself: the row order is whatever `rows` is, regardless of sortDescriptor", () => {
    render(
      <DataTable
        aria-label="Prompts"
        columns={COLUMNS}
        rows={ROWS}
        rowKey={(row) => row.id}
        sortDescriptor={{ column: "name", direction: "ascending" }}
      />,
    );
    const rowNames = screen.getAllByRole("row").slice(1).map((row) => within(row).getByText(/^(Ada|Grace|Alan)$/).textContent);
    expect(rowNames).toEqual(["Ada", "Grace", "Alan"]); // same order as ROWS, not alphabetized
  });

  it("select-all reaches the indeterminate state on a partial selection", async () => {
    function Controlled() {
      const [selected, setSelected] = useState<"all" | Set<Key>>(new Set());
      return (
        <DataTable
          aria-label="Prompts"
          columns={COLUMNS}
          rows={ROWS}
          rowKey={(row) => row.id}
          selectionMode="multiple"
          selectedKeys={selected}
          onSelectionChange={setSelected}
        />
      );
    }
    const user = userEvent.setup();
    render(<Controlled />);

    const selectAll = screen.getByRole("checkbox", { name: "Select all rows" });
    expect((selectAll as HTMLInputElement).indeterminate).toBe(false);

    await user.click(screen.getByRole("checkbox", { name: /Select row.*Ada/ }));
    expect((selectAll as HTMLInputElement).indeterminate).toBe(true);
    expect(selectAll).not.toBeChecked();

    await user.click(screen.getByRole("checkbox", { name: /Select row.*Grace/ }));
    await user.click(screen.getByRole("checkbox", { name: /Select row.*Alan/ }));
    expect((selectAll as HTMLInputElement).indeterminate).toBe(false);
    expect(selectAll).toBeChecked();
  });

  it("renders no selection column at all when selectionMode is \"none\" (the default)", () => {
    render(<DataTable aria-label="Prompts" columns={COLUMNS} rows={ROWS} rowKey={(row) => row.id} />);
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("renders the empty-state region (reusing the EmptyState block) when rows is empty", () => {
    render(
      <DataTable
        aria-label="Prompts"
        columns={COLUMNS}
        rows={[]}
        rowKey={(row) => row.id}
        emptyStateTitle="No prompts yet"
        emptyStateDescription="Create your first one."
      />,
    );
    expect(screen.getByRole("heading", { name: "No prompts yet" })).toBeInTheDocument();
    expect(screen.getByText("Create your first one.")).toBeInTheDocument();
    // 1 header row + react-aria-components' own row wrapping the empty-state content — no data rows.
    expect(screen.queryAllByRole("row")).toHaveLength(2);
  });

  it("defaults the empty-state title to \"No results\"", () => {
    render(<DataTable aria-label="Prompts" columns={COLUMNS} rows={[]} rowKey={(row) => row.id} />);
    expect(screen.getByRole("heading", { name: "No results" })).toBeInTheDocument();
  });

  it("renders skeleton placeholder rows instead of data rows while isLoading, not the empty state", () => {
    render(
      <DataTable
        aria-label="Prompts"
        columns={COLUMNS}
        rows={[]}
        rowKey={(row) => row.id}
        isLoading
        loadingRowCount={3}
      />,
    );
    expect(screen.queryByRole("heading", { name: "No results" })).not.toBeInTheDocument();
    // 1 header row + 3 skeleton rows.
    expect(screen.getAllByRole("row")).toHaveLength(4);
  });

  it("renders the toolbar and footer slots", () => {
    render(
      <DataTable
        aria-label="Prompts"
        columns={COLUMNS}
        rows={ROWS}
        rowKey={(row) => row.id}
        toolbar={<span>Toolbar content</span>}
        footer={<span>Footer content</span>}
      />,
    );
    expect(screen.getByText("Toolbar content")).toBeInTheDocument();
    expect(screen.getByText("Footer content")).toBeInTheDocument();
  });

  it("omits the toolbar and footer regions entirely when neither is given", () => {
    const { container } = render(
      <DataTable aria-label="Prompts" columns={COLUMNS} rows={ROWS} rowKey={(row) => row.id} />,
    );
    // Root has exactly one child: the table's own scroll wrapper.
    expect(container.firstElementChild?.children).toHaveLength(1);
  });

  it("forwards className, and the consumer's conflicting class wins the merge", () => {
    const { container } = render(
      <DataTable
        aria-label="Prompts"
        columns={COLUMNS}
        rows={ROWS}
        rowKey={(row) => row.id}
        className="gap-lg"
      />,
    );
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain("gap-lg");
    expect(root.className).not.toContain("gap-md");
  });

  it("forwards a consumer style prop onto the root", () => {
    const { container } = render(
      <DataTable
        aria-label="Prompts"
        columns={COLUMNS}
        rows={ROWS}
        rowKey={(row) => row.id}
        style={{ marginTop: "8px" }}
      />,
    );
    const root = container.firstElementChild as HTMLElement;
    expect(root.style.marginTop).toBe("8px");
  });
});
