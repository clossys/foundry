import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { SortDescriptor } from "react-aria-components";
import { parseDate } from "@internationalized/date";
import { Checkbox } from "./preview-runtime/components/checkbox/checkbox.js";
import { DateField } from "./DateField.js";
import { TextField } from "./preview-runtime/components/text-field/text-field.js";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./preview-runtime/components/table/table.js";

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
      <TableHeader>
        <TableHead id="name" isRowHeader allowsSorting>
          Name
        </TableHead>
        <TableHead id="runs" allowsSorting>
          Runs
        </TableHead>
      </TableHeader>
      <TableBody>
        {ROWS.map((row) => (
          <TableRow key={row.id} id={row.id}>
            <TableCell>{row.name}</TableCell>
            <TableCell>{row.runs}</TableCell>
          </TableRow>
        ))}
      </TableBody>
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
      <TableHeader>
        <TableHead>
          <Checkbox slot="selection" aria-label="Select all rows">{null}</Checkbox>
        </TableHead>
        <TableHead isRowHeader>Name</TableHead>
      </TableHeader>
      <TableBody>
        {ROWS.map((row) => (
          <TableRow key={row.id} id={row.id}>
            <TableCell>
              <Checkbox slot="selection" aria-label="Select row">{null}</Checkbox>
            </TableCell>
            <TableCell>{row.name}</TableCell>
          </TableRow>
        ))}
      </TableBody>
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

  it("keeps a plain-text cell's text value, so typing a row's first letter jumps to that row", async () => {
    const user = userEvent.setup();
    render(
      <Table aria-label="People">
        <TableHeader>
          <TableHead id="name" isRowHeader>
            Name
          </TableHead>
        </TableHeader>
        <TableBody>
          {["Ada", "Grace", "Mary"].map((name) => (
            <TableRow key={name} id={name}>
              <TableCell>{name}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>,
    );
    screen.getByRole("grid", { name: "People" }).focus();
    expect(document.activeElement).toBe(screen.getByRole("row", { name: "Ada" }));
    // Type-to-jump matches each row's text value, so every row is reached by its own first letter: none is empty.
    for (const [key, name] of [["g", "Grace"], ["m", "Mary"], ["a", "Ada"]] as const) {
      await user.keyboard(key);
      expect(document.activeElement, name).toBe(screen.getByRole("row", { name }));
      // Let the typeahead buffer reset before the next letter starts a fresh search.
      await act(() => new Promise((resolve) => setTimeout(resolve, 1100)));
    }
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
        <TableHeader>
          <TableHead isRowHeader>Name</TableHead>
        </TableHeader>
        <TableBody>
          <TableRow id="1">
            <TableCell>Ada</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    );
    const table = screen.getByRole("grid", { name: "Prompts" });
    expect(table.className).toContain("bg-status-danger");
  });

  it("forwards a consumer style prop onto the table, and the consumer's conflicting property wins the merge", () => {
    render(
      <Table aria-label="Prompts" style={{ borderCollapse: "separate", padding: "4px" }}>
        <TableHeader>
          <TableHead isRowHeader>Name</TableHead>
        </TableHeader>
        <TableBody>
          <TableRow id="1">
            <TableCell>Ada</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    );
    const table = screen.getByRole("grid", { name: "Prompts" });
    expect(table.style.borderCollapse).toBe("separate");
    expect(table.style.padding).toBe("4px");
  });
});

/** Two rows whose second column holds a text-entry control: a DateField, then a plain text input. */
function EditableTable() {
  return (
    <Table aria-label="Schedule">
      <TableHeader>
        <TableHead id="name" isRowHeader>Name</TableHead>
        <TableHead id="due">Due</TableHead>
      </TableHeader>
      <TableBody>
        <TableRow id="a">
          <TableCell>Ada</TableCell>
          <TableCell><DateField label="Due" defaultValue={parseDate("2026-10-27")} /></TableCell>
        </TableRow>
        <TableRow id="b">
          <TableCell>Grace</TableCell>
          <TableCell><TextField label="Note" defaultValue="later" /></TableCell>
        </TableRow>
        <TableRow id="c">
          <TableCell>Alan</TableCell>
          <TableCell>9</TableCell>
        </TableRow>
      </TableBody>
    </Table>
  );
}

describe("Table text entry inside a cell", () => {
  it("a DateField segment in a cell keeps ArrowUp/ArrowDown: the value changes and focus stays in its row", async () => {
    const user = userEvent.setup();
    render(<EditableTable />);
    const field = screen.getByRole("group", { name: "Due" });
    const day = within(field).getAllByRole("spinbutton").find(segment => /day/i.test(segment.getAttribute("aria-label") ?? ""))!;
    expect(day).toHaveAttribute("aria-valuenow", "27");
    await user.click(day);
    expect(day).toHaveFocus();
    await user.keyboard("{ArrowUp}");
    expect(day).toHaveAttribute("aria-valuenow", "28");
    expect(day).toHaveFocus();
    await user.keyboard("{ArrowDown}{ArrowDown}");
    expect(day).toHaveAttribute("aria-valuenow", "26");
    expect(day).toHaveFocus();
  });

  // R2F-33d1: the text field is the stock shadcn@aria input in the stock table; the stock grid keeps ArrowUp/ArrowDown
  // for row navigation, so the input takes text and the cell takes the arrows.
  it("a stock text input in a cell takes typing; the cell around it keeps the grid's row navigation", async () => {
    const user = userEvent.setup();
    render(<EditableTable />);
    const note = screen.getByRole("textbox", { name: "Note" });
    await user.click(note);
    await user.keyboard("{End} soon");
    expect(note).toHaveValue("later soon");
    // Focus on the cell itself, outside the input: arrows move between rows.
    const cell = note.closest<HTMLElement>("[role=gridcell]")!;
    act(() => cell.focus());
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement?.textContent).toBe("9");
    await user.keyboard("{ArrowUp}");
    expect(screen.getByRole("row", { name: /Grace/ })).toContainElement(document.activeElement as HTMLElement);
  });
});

describe("Table column resizing", () => {
  // R2F-31/R2F-39: the stock table anatomy has no column resizer (owner-approved drop of the three resizer tests).
  it("a table outside a resizable container keeps its non-resizing markup", () => {
    render(<BasicTable />);
    expect(screen.queryByRole("slider")).toBeNull();
  });
});

describe("Table selection and header anatomy", () => {
  it("renders each column header as the stock table-head part, a real th", () => {
    render(<BasicTable />);
    const header = screen.getByRole("columnheader", { name: "Name" });
    expect(header.tagName).toBe("TH");
    expect(header).toHaveAttribute("data-slot", "table-head");
  });

  it("marks only the selected row selected, the state its tint is painted from", () => {
    render(<SelectableTable selectedKeys={[ROWS[0]!.id]} onSelectionChange={() => {}} />);
    const selected = screen.getAllByRole("row").filter((row) => row.getAttribute("aria-selected") === "true");
    expect(selected).toHaveLength(1);
    expect(selected[0]).toHaveAccessibleName(/Ada/);
    expect(selected[0]).toHaveAttribute("data-selected", "true");
  });
});
