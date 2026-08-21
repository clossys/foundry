import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Key, SortDescriptor } from "react-aria-components";
import { DataTable, type DataTableColumn } from "./DataTable.js";

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
