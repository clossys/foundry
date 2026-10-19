import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { GroupedTable, type GroupedTableProps } from "./GroupedTable.js";

type Row = { id: string; label: string };
const props: GroupedTableProps<Row> = {
  caption: "Quarterly results",
  rowHeader: { id: "name", header: "Team", cell: row => row.label },
  groups: [
    { id: "current", header: "Current", columns: [
      { id: "count", header: "Count", cell: () => 0 },
      { id: "action", header: "Action", cell: () => <a href="#details">Details</a> },
    ] },
    { id: "prior", header: "Prior", columns: [{ id: "count", header: "Count", cell: () => 12 }] },
  ],
  rows: [{ id: "a", label: "Alpha" }, { id: "b", label: "Beta" }],
  rowKey: row => row.id,
  emptyMessage: "No results yet",
};

describe("GroupedTable", () => {
  it("renders unequal native column groups and explicit row, group and leaf associations", () => {
    render(<GroupedTable {...props} />);
    const table = screen.getByRole("table", { name: props.caption });
    expect([...table.querySelectorAll("colgroup")].map(group => group.span)).toEqual([1, 2, 1]);
    expect(within(table).getByRole("columnheader", { name: "Team" })).toHaveAttribute("rowspan", "2");
    const current = within(table).getByRole("columnheader", { name: "Current" });
    expect(current).toHaveAttribute("scope", "colgroup");
    expect(current).toHaveAttribute("colspan", "2");
    const prior = within(table).getByRole("columnheader", { name: "Prior" });
    expect(prior).toHaveAttribute("colspan", "1");
    const leaves = [...table.querySelectorAll("thead tr:last-child th")];
    leaves.forEach((leaf, index) => {
      expect(leaf).toHaveAttribute("scope", "col");
      expect(leaf).toHaveAttribute("headers", index < 2 ? current.id : prior.id);
    });
    for (const row of table.querySelectorAll("tbody tr")) {
      const rowHeader = row.querySelector("th")!;
      expect(rowHeader).toHaveAttribute("scope", "row");
      [...row.querySelectorAll("td")].forEach((cell, index) => {
        const ids = cell.getAttribute("headers")!.split(" ");
        expect(ids).toEqual([rowHeader.id, index < 2 ? current.id : prior.id, leaves[index].id]);
        ids.forEach(id => expect(document.getElementById(id)?.closest("table")).toBe(table));
      });
    }
    expect(within(table).getAllByRole("cell", { name: "0" })).toHaveLength(2);
  });

  it("isolates generated IDs across instances with identical authored IDs", () => {
    const { container } = render(<><GroupedTable {...props} /><GroupedTable {...props} /></>);
    const ids = [...container.querySelectorAll("[id]")].map(node => node.id);
    expect(new Set(ids).size).toBe(ids.length);
    container.querySelectorAll("[headers]").forEach(node => node.getAttribute("headers")!.split(" ").forEach(id => {
      expect(document.getElementById(id)?.closest("table")).toBe(node.closest("table"));
    }));
  });

  it("names the focusable overflow region and preserves keyboard access to authored links", async () => {
    const user = userEvent.setup();
    render(<GroupedTable {...props} />);
    await user.tab();
    expect(screen.getByRole("region", { name: props.caption })).toHaveFocus();
    await user.tab();
    expect(screen.getAllByRole("link", { name: "Details" })[0]).toHaveFocus();
  });

  it("spans the entire table for its authored empty message", () => {
    render(<GroupedTable {...props} rows={[]} />);
    expect(screen.getByRole("cell", { name: props.emptyMessage })).toHaveAttribute("colspan", "4");
    expect(screen.queryByRole("rowheader")).not.toBeInTheDocument();
  });

  it.each([
    { caption: " " }, { emptyMessage: " " }, { groups: [] },
    { rowHeader: { ...props.rowHeader, id: "" } },
    { groups: [{ ...props.groups[0], columns: [] }] },
    { groups: [props.groups[0], props.groups[0]] },
    { groups: [{ ...props.groups[0], columns: [props.groups[0].columns[0], props.groups[0].columns[0]] }] },
    { rows: [props.rows[0], props.rows[0]] },
  ])("refuses malformed input %j", override => {
    expect(() => render(<GroupedTable {...props} {...override} />)).toThrow(/GroupedTable/);
  });
});
