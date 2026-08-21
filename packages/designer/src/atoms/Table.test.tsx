import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Key, SortDescriptor } from "react-aria-components";
import { Table } from "./Table.js";

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

function BasicTable({
  sortDescriptor,
  onSortChange,
}: {
  sortDescriptor?: SortDescriptor;
  onSortChange?: (descriptor: SortDescriptor) => void;
} = {}) {
  return (
    <Table aria-label="Prompts" sortDescriptor={sortDescriptor} onSortChange={onSortChange}>
      <Table.Header>
        <Table.Column id="name" isRowHeader allowsSorting>
          Name
        </Table.Column>
        <Table.Column id="runs" allowsSorting>
          Runs
        </Table.Column>
      </Table.Header>
      <Table.Body>
        {ROWS.map((row) => (
          <Table.Row key={row.id} id={row.id}>
            <Table.Cell>{row.name}</Table.Cell>
            <Table.Cell>{row.runs}</Table.Cell>
          </Table.Row>
        ))}
      </Table.Body>
    </Table>
  );
}

function SelectableTable({
  selectedKeys,
  onSelectionChange,
}: {
  selectedKeys: "all" | Iterable<Key>;
  onSelectionChange: (keys: "all" | Set<Key>) => void;
}) {
  return (
    <Table
      aria-label="Prompts"
      selectionMode="multiple"
      selectedKeys={selectedKeys}
      onSelectionChange={onSelectionChange as (keys: unknown) => void}
    >
      <Table.Header>
        <Table.Column>
          <Table.SelectAllCheckbox />
        </Table.Column>
        <Table.Column isRowHeader>Name</Table.Column>
      </Table.Header>
      <Table.Body>
        {ROWS.map((row) => (
          <Table.Row key={row.id} id={row.id}>
            <Table.Cell>
              <Table.SelectionCheckbox />
            </Table.Cell>
            <Table.Cell>{row.name}</Table.Cell>
          </Table.Row>
        ))}
      </Table.Body>
    </Table>
  );
}

describe("Table", () => {
  it("renders real table semantics: a table, a columnheader per column, a row per data row, a cell per row/column pair", () => {
    render(<BasicTable />);
    const table = screen.getByRole("grid", { name: "Prompts" });
    expect(table).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Name" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Runs" })).toBeInTheDocument();
    expect(screen.getAllByRole("row")).toHaveLength(4); // 1 header row + 3 data rows
    const adaRow = screen.getByRole("row", { name: /Ada/ });
    expect(within(adaRow).getByText("Ada")).toBeInTheDocument();
    expect(within(adaRow).getByText("12")).toBeInTheDocument();
  });

  it("marks a sortable column with aria-sort, and reports the toggled direction via onSortChange", async () => {
    const onSortChange = vi.fn();
    const user = userEvent.setup();
    render(<BasicTable sortDescriptor={{ column: "name", direction: "ascending" }} onSortChange={onSortChange} />);

    const nameColumn = screen.getByRole("columnheader", { name: "Name" });
    expect(nameColumn).toHaveAttribute("aria-sort", "ascending");
    const runsColumn = screen.getByRole("columnheader", { name: "Runs" });
    expect(runsColumn).toHaveAttribute("aria-sort", "none");

    // Clicking the already-ascending column reports descending next.
    await user.click(nameColumn);
    expect(onSortChange).toHaveBeenCalledWith({ column: "name", direction: "descending" });

    // Clicking a different column reports ascending on that new column.
    await user.click(runsColumn);
    expect(onSortChange).toHaveBeenCalledWith({ column: "runs", direction: "ascending" });
  });

  it("navigates between rows and cells with the arrow keys", async () => {
    const user = userEvent.setup();
    render(<BasicTable />);
    const table = screen.getByRole("grid", { name: "Prompts" });
    table.focus();
    // Focusing the grid itself lands on the first ROW (react-aria-components'
    // default `keyboardNavigationBehavior: 'arrow'` row-first focus target),
    // not a cell — ArrowRight is what steps focus into that row's cells.
    expect(document.activeElement).toBe(screen.getByRole("row", { name: /Ada/ }));

    await user.keyboard("{ArrowRight}");
    expect(document.activeElement?.textContent).toBe("Ada");
    await user.keyboard("{ArrowRight}");
    expect(document.activeElement?.textContent).toBe("12");
    // Arrow-down from a cell moves to the SAME column in the next row.
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement?.textContent).toBe("4");
  });

  it("select-all reaches the indeterminate state with a partial selection, and full selection clears it", async () => {
    function Controlled() {
      const [selected, setSelected] = useState<"all" | Set<Key>>(new Set());
      return <SelectableTable selectedKeys={selected} onSelectionChange={setSelected} />;
    }
    const user = userEvent.setup();
    render(<Controlled />);

    const selectAll = screen.getByRole("checkbox", { name: "Select all rows" });
    expect(selectAll).not.toBeChecked();
    expect((selectAll as HTMLInputElement).indeterminate).toBe(false);

    // react-aria-components additionally wires each row checkbox's
    // aria-labelledby to that row's own row-header cell, so the fully
    // computed accessible name is "Select row Ada" (this component's own
    // "Select row" default `aria-label`, plus the row's own name) rather
    // than the bare `aria-label` string alone — a substring match is the
    // right tool here, not an exact one.
    await user.click(screen.getByRole("checkbox", { name: /Select row.*Ada/ }));
    expect((selectAll as HTMLInputElement).indeterminate).toBe(true);
    expect(selectAll).not.toBeChecked();

    await user.click(screen.getByRole("checkbox", { name: /Select row.*Grace/ }));
    await user.click(screen.getByRole("checkbox", { name: /Select row.*Alan/ }));
    expect((selectAll as HTMLInputElement).indeterminate).toBe(false);
    expect(selectAll).toBeChecked();
  });

  it("select-all toggles every row's checkbox at once", async () => {
    function Controlled() {
      const [selected, setSelected] = useState<"all" | Set<Key>>(new Set());
      return <SelectableTable selectedKeys={selected} onSelectionChange={setSelected} />;
    }
    const user = userEvent.setup();
    render(<Controlled />);

    await user.click(screen.getByRole("checkbox", { name: "Select all rows" }));
    expect(screen.getByRole("checkbox", { name: /Select row.*Ada/ })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /Select row.*Grace/ })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /Select row.*Alan/ })).toBeChecked();
  });

  it("forwards className onto the table, and the consumer's conflicting class wins the merge", () => {
    render(
      <Table aria-label="Prompts" className="bg-status-danger">
        <Table.Header>
          <Table.Column isRowHeader>Name</Table.Column>
        </Table.Header>
        <Table.Body>
          <Table.Row id="1">
            <Table.Cell>Ada</Table.Cell>
          </Table.Row>
        </Table.Body>
      </Table>,
    );
    const table = screen.getByRole("grid", { name: "Prompts" });
    expect(table.className).toContain("bg-status-danger");
  });

  it("forwards a consumer style prop onto the table, and the consumer's conflicting property wins the merge", () => {
    render(
      <Table aria-label="Prompts" style={{ borderCollapse: "separate", padding: "4px" }}>
        <Table.Header>
          <Table.Column isRowHeader>Name</Table.Column>
        </Table.Header>
        <Table.Body>
          <Table.Row id="1">
            <Table.Cell>Ada</Table.Cell>
          </Table.Row>
        </Table.Body>
      </Table>,
    );
    const table = screen.getByRole("grid", { name: "Prompts" });
    expect(table.style.borderCollapse).toBe("separate");
    expect(table.style.padding).toBe("4px");
  });
});
