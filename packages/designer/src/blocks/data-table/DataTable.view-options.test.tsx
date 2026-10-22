import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DataTable, type DataTableColumn } from "../DataTable.js";
import type { DataTableMessages } from "./messages.js";
import { parseDataTableViewModel, type DataTableViewModel, type DataTableViewModelV1 } from "./view-model.js";
import * as tableEngine from "../table-model/index.js";
import * as presentation from "./presentation.js";
import type { TableModel } from "../table-model/index.js";

interface Row { id: string; name: string; team: string; region: string; stage: string; amount: number; tags: string[] }
const rows: Row[] = [
  { id: "a", name: "Alpha", team: "Blue", region: "North", stage: "Ready", amount: 10, tags: ["urgent"] },
  { id: "b", name: "Beta", team: "Blue", region: "North", stage: "Doing", amount: 20, tags: ["other"] },
  { id: "c", name: "Gamma", team: "Gold", region: "South", stage: "Ready", amount: 30, tags: ["urgent", "other"] },
];
const columns: DataTableColumn<Row>[] = [
  { id: "name", header: "Name", cell: row => row.name, isRowHeader: true },
  { id: "team", header: "Team", cell: row => row.team },
  { id: "region", header: "Region", cell: row => row.region },
  { id: "stage", header: "Stage", cell: row => row.stage },
  { id: "amount", header: "Amount", cell: row => row.amount },
  { id: "tags", header: "Tags", cell: row => row.tags.join(", ") },
];
const table: TableModel = {
  version: 1, collation: { locale: "en", sensitivity: "base", numeric: true },
  columns: [ { id: "name", kind: "text" }, { id: "team", kind: "enum" }, { id: "region", kind: "enum" }, { id: "stage", kind: "enum" }, { id: "amount", kind: "number" }, { id: "tags", kind: "tags" } ],
  measures: [{ id: "total", op: "sum", column: "amount" }],
};
function view(overrides: Partial<DataTableViewModel> = {}): DataTableViewModel {
  const legacy: DataTableViewModelV1 = { version: 1, table, mode: "flat", density: "comfortable", sort: [], visibleColumns: ["name", "team", "amount", "tags"] };
  return parseDataTableViewModel({ ...legacy, ...overrides });
}
function freeze<T>(value: T): T { if (value && typeof value === "object") { Object.freeze(value); Object.values(value).forEach(freeze); } return value; }
const rowKey = (row: Row) => row.id;
function Harness({ initial = view(), changed = (_next: DataTableViewModel) => {}, children, messages }: { initial?: DataTableViewModel; changed?: (next: DataTableViewModel) => void; children?: React.ReactNode; messages?: DataTableMessages }) {
  const [model, setModel] = useState(initial);
  const [expanded, setExpanded] = useState<ReadonlySet<string> | "all">("all");
  return <><DataTable aria-label="Records" columns={columns} rows={rows} rowKey={rowKey} model={model} messages={messages}
    onModelChange={next => { changed(next); setModel(next); }} expandedGroupKeys={expanded} onExpandedGroupKeysChange={setExpanded} />{children}</>;
}
function media(wide: boolean) {
  vi.stubGlobal("matchMedia", vi.fn((query: string) => ({ matches: wide, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn() })));
}
beforeEach(() => media(true));
afterEach(() => { vi.unstubAllGlobals(); document.documentElement.removeAttribute("data-theme"); });
async function open(user: ReturnType<typeof userEvent.setup>) { await user.click(screen.getByRole("button", { name: "View options" })); return screen.findByRole("dialog", { name: "View options" }); }
function names() { return screen.getAllByRole("rowheader").map(cell => cell.textContent).filter(name => ["Alpha", "Beta", "Gamma"].includes(name!)); }

describe("DataTable v2 filter preservation", () => {
  it("edits a legacy sibling without dropping or moving groups and new-operator leaves", async () => {
    const user = userEvent.setup();
    const changed = vi.fn();
    const group = { kind: "group", op: "or", items: [{ column: "stage", kind: "enum", op: "in", values: ["Ready", "Doing"] }] } as const;
    const legacy = { column: "name", kind: "text", op: "contains", value: "" } as const;
    const empty = { column: "team", kind: "enum", op: "notEmpty" } as const;
    const initial = view({ version: 2, table: { ...table, version: 2, filters: [group, legacy, empty] }, columnWidths: { name: 120 }, pinnedColumns: ["name"] });
    render(<Harness initial={freeze(initial)} changed={changed} />);
    const dialog = await open(user);
    expect(within(dialog).getByText("Filter: or (1)")).toBeInTheDocument();
    expect(within(dialog).getByText("Filter: Team notEmpty")).toBeInTheDocument();
    expect(within(dialog).getAllByRole("textbox")).toHaveLength(1);
    await user.type(within(dialog).getByRole("textbox", { name: "Name value" }), "A");
    const next = changed.mock.lastCall![0] as DataTableViewModel;
    expect(next.table.filters).toEqual([group, { ...legacy, value: "A" }, empty]);
    expect(next.columnWidths).toEqual(initial.columnWidths);
    expect(next.pinnedColumns).toEqual(initial.pinnedColumns);
    expect(next.table.version).toBe(2);
    await user.click(within(dialog).getByRole("button", { name: "Remove filter Team notEmpty" }));
    expect(changed.mock.lastCall![0].table.filters).toEqual([group, { ...legacy, value: "A" }]);
    await user.click(within(dialog).getByRole("button", { name: "Add filter Amount" }));
    expect(changed.mock.lastCall![0].table.filters).toEqual([group, { ...legacy, value: "A" }, { column: "amount", kind: "number", op: "range" }]);
    expect(changed.mock.lastCall![0].table.version).toBe(2);
  });
  it("keeps the pinned prefix valid when existing visibility and order controls are used", async () => {
    const user = userEvent.setup();
    const changed = vi.fn();
    const initial = view({ version: 2, pinnedColumns: ["name", "team"], columnWidths: { name: 120 } });
    render(<Harness initial={initial} changed={changed} />);
    const dialog = await open(user);
    expect(within(dialog).getByRole("checkbox", { name: "Show Name" })).toBeDisabled();
    expect(within(dialog).getByRole("checkbox", { name: "Show Team" })).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: "Move column Team earlier" })).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: "Move column Amount earlier" })).toBeDisabled();
    await user.click(within(dialog).getByRole("button", { name: "Move column Tags earlier" }));
    expect(changed.mock.lastCall![0].visibleColumns).toEqual(["name", "team", "tags", "amount"]);
    await user.click(within(dialog).getByRole("checkbox", { name: "Show Amount" }));
    const next = changed.mock.lastCall![0] as DataTableViewModel;
    expect(next.visibleColumns).toEqual(["name", "team", "tags"]);
    expect(next.pinnedColumns).toEqual(initial.pinnedColumns);
    expect(next.columnWidths).toEqual(initial.columnWidths);
    expect(parseDataTableViewModel(next)).toEqual(next);
  });
});

describe("DataTable model rendering", () => {
  it("filters and stably sorts copied data in flat mode", () => {
    const model = freeze(view({ table: { ...table, filters: [{ column: "tags", kind: "tags", op: "any", values: ["urgent"] }] }, sort: [{ column: "amount", direction: "descending" }] }));
    render(<Harness initial={model} />);
    expect(names()).toEqual(["Gamma", "Alpha"]);
    expect(screen.queryByText("Beta")).not.toBeInTheDocument();
    expect(rows.map(row => row.id)).toEqual(["a", "b", "c"]);
  });
  it.each([1, 2, 3])("renders %i grouping levels, group aggregates and controlled collapse/expand", async levels => {
    const user = userEvent.setup();
    const groupBy = ["region", "team", "stage"].slice(0, levels).map(column => ({ column }));
    render(<Harness initial={view({ mode: "grouped", table: { ...table, groupBy } })} />);
    expect(screen.getByRole("grid", { name: "Records" })).toBeInTheDocument();
    expect(screen.getAllByText("total: 30").length).toBeGreaterThanOrEqual(2);
    if (levels === 3) expect(screen.getByRole("button", { name: "Collapse group North / Blue / Ready" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Collapse group North" }));
    expect(screen.queryByText("Alpha")).not.toBeInTheDocument();
    expect(screen.getByText("Gamma")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Expand group North" }));
    expect(screen.getByText("Alpha")).toBeInTheDocument();
  });
  it("renders pivot row/column axes, multiple measures and recomputed totals", () => {
    render(<Harness initial={view({ mode: "pivot", table: { ...table, measures: [...table.measures!, { id: "average", op: "avg", column: "amount" }], pivot: { rows: [{ column: "region" }], columns: [{ column: "team" }] } } })} />);
    expect(screen.getByRole("columnheader", { name: "Blue · total" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Gold · average" })).toBeInTheDocument();
    const total = screen.getAllByRole("row").find(row => within(row).queryByRole("rowheader", { name: "Total" }))!;
    expect(within(total).getByText("60")).toBeInTheDocument();
    expect(within(total).getByText("20")).toBeInTheDocument();
    expect(screen.getByRole("rowheader", { name: "North" })).toBeInTheDocument();
    expect(screen.getByRole("rowheader", { name: "South" })).toBeInTheDocument();
  });
  it("keeps the same focused control while a model edit rerenders the grid", async () => {
    const user = userEvent.setup(); render(<Harness />); const dialog = await open(user);
    const control = within(dialog).getByRole("checkbox", { name: "Group by Team" });
    await user.click(control);
    expect(within(dialog).getByRole("checkbox", { name: "Group by Team" })).toBe(control);
    expect(control).toBeChecked(); expect(control).toHaveFocus();
  });
  it("preserves controlled leaf selection in grouped mode", async () => {
    const user = userEvent.setup(); const change = vi.fn();
    render(<DataTable aria-label="Records" columns={columns} rows={rows} rowKey={rowKey} model={view({ mode: "grouped", table: { ...table, groupBy: [{ column: "team" }] } })} onModelChange={() => {}}
      selectionMode="multiple" selectedKeys={new Set(["a"])} onSelectionChange={change} />);
    expect(screen.getByRole("checkbox", { name: /Select row.*Alpha/ })).toBeChecked();
    await user.click(screen.getByRole("checkbox", { name: /Select row.*Beta/ }));
    expect([...change.mock.lastCall![0]]).toEqual(["a", "b"]);
  });
});

describe("DataTable View options", () => {
  it("opens and closes by keyboard and restores focus to its stable trigger", async () => {
    const user = userEvent.setup(); render(<Harness />);
    const trigger = screen.getByRole("button", { name: "View options" }); trigger.focus();
    await user.keyboard("{Enter}"); expect(await screen.findByRole("dialog", { name: "View options" })).toBeInTheDocument();
    await user.keyboard("{Escape}"); await waitFor(() => expect(trigger).toHaveFocus());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
  it("round trips through open/close without editing or emitting a different model", async () => {
    const user = userEvent.setup(); const initial = freeze(view()); const before = JSON.stringify(initial); const changed = vi.fn();
    render(<Harness initial={initial} changed={changed} />); await open(user); await user.keyboard("{Escape}");
    expect(changed).not.toHaveBeenCalled(); expect(JSON.stringify(initial)).toBe(before);
  });
  it("changes group, sort, filter and column settings through one immutable payload", async () => {
    const user = userEvent.setup(); const changed = vi.fn(); const initial = freeze(view());
    render(<Harness initial={initial} changed={changed} />); const dialog = await open(user);
    for (const name of ["Group", "Sort", "Filter", "Columns"]) expect(within(dialog).getByRole("heading", { name, exact: true })).toBeInTheDocument();
    await user.click(within(dialog).getByRole("checkbox", { name: "Group by Team" }));
    expect(changed.mock.lastCall![0].table.groupBy).toEqual([{ column: "team" }]);
    await user.click(within(dialog).getByRole("button", { name: "Add sort Amount" }));
    expect(changed.mock.lastCall![0].sort).toEqual([{ column: "amount", direction: "ascending" }]);
    await user.click(within(dialog).getByRole("button", { name: "Add filter Tags" }));
    await user.click(within(dialog).getByRole("checkbox", { name: "Tags: urgent" }));
    expect(changed.mock.lastCall![0].table.filters).toEqual([{ column: "tags", kind: "tags", op: "any", values: ["urgent"] }]);
    await user.click(within(dialog).getByRole("checkbox", { name: "Show Amount" }));
    expect(changed.mock.lastCall![0].visibleColumns).not.toContain("amount");
    expect(initial.table.groupBy).toBeUndefined(); expect(initial.sort).toEqual([]); expect(initial.visibleColumns).toContain("amount");
    expect(changed.mock.lastCall![0]).not.toBe(initial); expect(changed.mock.lastCall![0].table).not.toBe(initial.table);
    await user.keyboard("{Escape}"); expect(screen.queryByRole("columnheader", { name: "Amount" })).not.toBeInTheDocument();
  });
  it("shows Pivot only when dimensions exist, and edits its row and column dimensions", async () => {
    const user = userEvent.setup(); const changed = vi.fn();
    const rendered = render(<Harness changed={changed} />); let dialog = await open(user);
    expect(within(dialog).queryByRole("heading", { name: "Pivot", exact: true })).not.toBeInTheDocument();
    await user.keyboard("{Escape}"); rendered.unmount();
    render(<Harness initial={view({ table: { ...table, pivot: { rows: [{ column: "region" }], columns: [{ column: "team" }] } } })} changed={changed} />);
    dialog = await open(user); expect(within(dialog).getByRole("heading", { name: "Pivot", exact: true })).toBeInTheDocument();
    await user.click(within(dialog).getByRole("checkbox", { name: "Pivot rows Stage" }));
    expect(changed.mock.lastCall![0].table.pivot.rows).toEqual([{ column: "region" }, { column: "stage" }]);
    await user.click(within(dialog).getByRole("checkbox", { name: "Pivot columns Team" }));
    expect(changed.mock.lastCall![0].table.pivot.columns).toEqual([]);
  });
  it("removes exactly the corresponding group, sort and filter rules through keyboard chips", async () => {
    const user = userEvent.setup(); const changed = vi.fn();
    render(<Harness initial={freeze(view({ sort: [{ column: "amount", direction: "descending" }], table: { ...table, groupBy: [{ column: "team" }], filters: [{ column: "tags", kind: "tags", op: "any", values: ["urgent"] }] } }))} changed={changed} />);
    screen.getByRole("button", { name: "Remove group Team" }).focus(); await user.keyboard(" ");
    expect(changed.mock.lastCall![0].table.groupBy).toEqual([]); expect(changed.mock.lastCall![0].table.filters).toHaveLength(1);
    screen.getByRole("button", { name: "Remove sort Amount" }).focus(); await user.keyboard("{Enter}");
    expect(changed.mock.lastCall![0].sort).toEqual([]);
    screen.getByRole("button", { name: /Remove filter Tags/ }).focus(); await user.keyboard(" ");
    expect(changed.mock.lastCall![0].table.filters).toEqual([]); expect(screen.getByText("Beta")).toBeInTheDocument();
  });
  it("uses the existing bottom sheet on small screens and restores focus on dismissal", async () => {
    media(false); const user = userEvent.setup(); render(<Harness />); const trigger = screen.getByRole("button", { name: "View options" });
    const dialog = await open(user); expect(dialog.querySelector('[data-drawer-placement="bottom"][data-drawer-wide="sheet"]')).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Close view options" })); await waitFor(() => expect(trigger).toHaveFocus());
  });
  it.each(["light", "dark"])("uses the same controls and token surfaces in %s theme", async theme => {
    document.documentElement.dataset.theme = theme; const user = userEvent.setup(); render(<Harness />); const dialog = await open(user);
    expect(within(dialog).getByRole("heading", { name: "Columns", exact: true })).toBeInTheDocument();
    expect(dialog.closest('[data-rac]')?.parentElement || dialog).toBeInTheDocument();
  });
});

describe("DataTable view edge cases", () => {
  it("keeps focused leaf cells mounted when the host replaces and sorts a model", () => {
    const props = { "aria-label": "Records", columns, rows, rowKey, onModelChange: () => {} };
    const rendered = render(<DataTable {...props} model={view()} />);
    const cell = screen.getByRole("rowheader", { name: "Alpha" }); cell.focus();
    rendered.rerender(<DataTable {...props} model={view({ sort: [{ column: "amount", direction: "descending" }] })} />);
    expect(names()).toEqual(["Gamma", "Beta", "Alpha"]);
    expect(screen.getByRole("rowheader", { name: "Alpha" })).toBe(cell); expect(cell).toHaveFocus();
  });
  it("edits each section with keyboard activation and keeps group/filter meanings separate", async () => {
    const user = userEvent.setup(); const changed = vi.fn(); render(<Harness changed={changed} />); const dialog = await open(user);
    within(dialog).getByRole("checkbox", { name: "Group by Team" }).focus(); await user.keyboard(" ");
    expect(changed.mock.lastCall![0].table.groupBy).toEqual([{ column: "team" }]);
    within(dialog).getByRole("button", { name: "Add sort Amount" }).focus(); await user.keyboard("{Enter}");
    within(dialog).getByRole("button", { name: "Add filter Tags" }).focus(); await user.keyboard("{Enter}");
    within(dialog).getByRole("checkbox", { name: "Tags: urgent" }).focus(); await user.keyboard(" ");
    within(dialog).getByRole("checkbox", { name: "Show Amount" }).focus(); await user.keyboard(" ");
    within(dialog).getByRole("checkbox", { name: "Pivot columns Stage" }).focus(); await user.keyboard(" ");
    const next = changed.mock.lastCall![0]; expect(next.sort).toEqual([{ column: "amount", direction: "ascending" }]);
    expect(next.table.filters[0].values).toEqual(["urgent"]); expect(next.visibleColumns).not.toContain("amount");
    expect(next.table.pivot.columns).toEqual([{ column: "stage" }]);
  });
  it("applies numeric bounds and disjunctive enum choices through engine filtering", async () => {
    const user = userEvent.setup(); const changed = vi.fn(); render(<Harness changed={changed} />); let dialog = await open(user);
    await user.click(within(dialog).getByRole("button", { name: "Add filter Amount" }));
    await user.type(within(dialog).getByRole("textbox", { name: "Minimum Amount" }), "25");
    await user.click(within(dialog).getByRole("button", { name: "Apply Amount range" }));
    expect(changed.mock.lastCall![0].table.filters).toEqual([{ column: "amount", kind: "number", op: "range", min: 25 }]);
    await user.keyboard("{Escape}"); expect(names()).toEqual(["Gamma"]);
    await user.click(screen.getByRole("button", { name: /Remove filter Amount/ })); dialog = await open(user);
    await user.click(within(dialog).getByRole("button", { name: "Add filter Team" }));
    await user.click(within(dialog).getByRole("checkbox", { name: "Team: Blue" }));
    expect(within(dialog).getByRole("checkbox", { name: "Team: Gold" })).toBeInTheDocument();
    await user.keyboard("{Escape}"); expect(names()).toEqual(["Alpha", "Beta"]);
  });
  it("refuses an inverted range without emitting an invalid model", async () => {
    const user = userEvent.setup(); const changed = vi.fn(); render(<Harness changed={changed} />); const dialog = await open(user);
    await user.click(within(dialog).getByRole("button", { name: "Add filter Amount" })); const calls = changed.mock.calls.length;
    await user.type(within(dialog).getByRole("textbox", { name: "Minimum Amount" }), "30");
    await user.type(within(dialog).getByRole("textbox", { name: "Maximum Amount" }), "10");
    await user.click(within(dialog).getByRole("button", { name: "Apply Amount range" }));
    expect(changed).toHaveBeenCalledTimes(calls);
    expect(within(dialog).getAllByText("Enter valid bounds with minimum no greater than maximum.").length).toBeGreaterThan(0);
  });
  it("changes density and keeps a visible accessible row header after hiding Name", async () => {
    const user = userEvent.setup(); const changed = vi.fn(); render(<Harness changed={changed} />);
    await user.click(screen.getByRole("button", { name: /Density/ })); await user.click(await screen.findByRole("option", { name: "Compact" }));
    expect(changed.mock.lastCall![0].density).toBe("compact"); expect(screen.getByRole("rowheader", { name: "Alpha" })).toHaveClass("py-xs");
    const dialog = await open(user); await user.click(within(dialog).getByRole("checkbox", { name: "Show Name" }));
    await user.click(within(dialog).getByRole("checkbox", { name: "Show Amount" })); await user.click(within(dialog).getByRole("checkbox", { name: "Show Tags" }));
    expect(within(dialog).getByRole("checkbox", { name: "Show Team" })).toBeDisabled();
    await user.keyboard("{Escape}"); expect(screen.getAllByRole("rowheader")[0]).toHaveTextContent("Blue");
  });
  it("retains empty/loading slots and recomputes filtered pivot totals", () => {
    const filtered = { ...table, filters: [{ column: "amount", kind: "number", op: "range", min: 100 }] } as const;
    const props = { "aria-label": "Records", columns, rows, rowKey, onModelChange: () => {} };
    const rendered = render(<DataTable {...props} model={view({ table: filtered })} emptyStateTitle="Nothing here" />);
    expect(screen.getByText("Nothing here")).toBeInTheDocument();
    rendered.rerender(<DataTable {...props} model={view({ table: filtered, mode: "pivot" })} isLoading loadingRowCount={2} />);
    expect(screen.getAllByRole("row")).toHaveLength(3);
    rendered.rerender(<DataTable {...props} model={view({ mode: "pivot", table: { ...table, filters: [{ column: "tags", kind: "tags", op: "any", values: ["urgent"] }], pivot: { rows: [{ column: "region" }], columns: [{ column: "team" }] } } })} />);
    const total = screen.getAllByRole("row").find(row => within(row).queryByRole("rowheader", { name: "Total" }))!;
    expect(within(total).getByText("40")).toBeInTheDocument(); expect(within(total).queryByText("60")).not.toBeInTheDocument();
  });
});

describe("DataTable host messages", () => {
  it("uses host labels and formatters without persisting messages in the view", async () => {
    const user = userEvent.setup(); const changed = vi.fn();
    render(<DataTable aria-label="Records" columns={columns} rows={rows} rowKey={rowKey} model={view()} onModelChange={changed}
      messages={{ viewOptionsLabel: "Settings", groupSectionLabel: "Grouping", groupByMessage: column => `Bucket ${column}` }} />);
    await user.click(screen.getByRole("button", { name: "Settings" })); const dialog = await screen.findByRole("dialog", { name: "Settings" });
    expect(within(dialog).getByRole("heading", { name: "Grouping", exact: true })).toBeInTheDocument();
    await user.click(within(dialog).getByRole("checkbox", { name: "Bucket Team" }));
    expect(changed.mock.lastCall![0].table.groupBy).toEqual([{ column: "team" }]);
    expect(Object.keys(changed.mock.lastCall![0]).sort()).toEqual(["density", "mode", "sort", "table", "version", "visibleColumns"]);
  });
  it("uses host chip, expansion and pivot copy", async () => {
    const user = userEvent.setup();
    const props = { "aria-label": "Records", columns, rows, rowKey, onModelChange: () => {} };
    const rendered = render(<DataTable {...props} model={view({ mode: "grouped", table: { ...table, groupBy: [{ column: "team" }] } })} onExpandedGroupKeysChange={() => {}}
      messages={{ groupChipMessage: column => `Bucket: ${column}`, removeGroupMessage: column => `Clear bucket ${column}`, groupToggleMessage: path => `Fold ${path.join(".")}` }} />);
    expect(screen.getByText("Bucket: Team")).toBeInTheDocument(); expect(screen.getByRole("button", { name: "Clear bucket Team" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Fold Blue" })).toBeInTheDocument();
    rendered.rerender(<DataTable {...props} model={view({ mode: "pivot", table: { ...table, pivot: { rows: [{ column: "region" }], columns: [{ column: "team" }] } } })}
      messages={{ pivotRowsHeaderLabel: "Regions", pivotAxisMessage: axis => axis.kind === "total" ? "All regions" : axis.path.join(" / "), pivotColumnMessage: (axis, id) => `${axis.path.join("/") || "All teams"}: ${id}` }} />);
    expect(screen.getByRole("columnheader", { name: "Regions" })).toBeInTheDocument(); expect(screen.getByRole("rowheader", { name: "All regions" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Blue: total" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Clear bucket Team" })).not.toBeInTheDocument();
  });
});

describe("DataTable host error and selection messages", () => {
  it("uses custom range labels and validation copy through the options hierarchy", async () => {
    const user = userEvent.setup(); const changed = vi.fn();
    render(<Harness changed={changed} messages={{ minimumMessage: column => `Below ${column}`, maximumMessage: column => `Above ${column}`, applyRangeMessage: column => `Set ${column} bounds`, invalidRangeLabel: "Check the bounds" }} />);
    const dialog = await open(user); await user.click(within(dialog).getByRole("button", { name: "Add filter Amount" }));
    const calls = changed.mock.calls.length;
    await user.type(within(dialog).getByRole("textbox", { name: "Below Amount" }), "30");
    await user.type(within(dialog).getByRole("textbox", { name: "Above Amount" }), "10");
    await user.click(within(dialog).getByRole("button", { name: "Set Amount bounds" }));
    expect(changed).toHaveBeenCalledTimes(calls); expect(within(dialog).getAllByText("Check the bounds")).toHaveLength(2);
  });
  it("uses host selection names in legacy and grouped views", () => {
    const props = { "aria-label": "Records", columns, rows, rowKey, selectionMode: "multiple" as const, selectedKeys: new Set(["a"]), onSelectionChange: () => {}, messages: { selectAllLabel: "Pick every record", selectRowLabel: "Pick record" } };
    const rendered = render(<DataTable {...props} />);
    expect(screen.getByRole("checkbox", { name: "Pick every record" })).toBePartiallyChecked();
    expect(screen.getByRole("checkbox", { name: "Pick record Alpha" })).toBeChecked();
    rendered.rerender(<DataTable {...props} model={view({ mode: "grouped", table: { ...table, groupBy: [{ column: "team" }] } })} onModelChange={() => {}} />);
    expect(screen.getByRole("checkbox", { name: "Pick every record" })).toBePartiallyChecked();
    expect(screen.getByRole("checkbox", { name: "Pick record Alpha" })).toBeChecked();
  });
});

it("remote rows retain host order and bypass local filter and sort", () => {
  const model = view({ table: { ...table, filters: [{ column: "name", kind: "text", op: "equals", value: "Alpha" }] }, sort: [{ column: "amount", direction: "descending" }] });
  const filter = vi.spyOn(tableEngine, "filterRows"); const sort = vi.spyOn(presentation, "sortViewRows");
  try {
    render(<DataTable aria-label="Records" columns={columns} rows={rows} rowKey={rowKey} model={model} onModelChange={() => {}} rowSource="remote" />);
    expect(names()).toEqual(["Alpha", "Beta", "Gamma"]);
    expect(filter).not.toHaveBeenCalled(); expect(sort).not.toHaveBeenCalled();
  } finally { filter.mockRestore(); sort.mockRestore(); }
});

it("without filterLabels retains ViewOptions filter section and chips", async () => {
  const user = userEvent.setup(); render(<Harness initial={view({ table: { ...table, filters: [{ column: "name", kind: "text", op: "contains", value: "A" }] } })} />);
  expect(screen.getByText(/Filter: Name contains.*A/)).toBeInTheDocument();
  const dialog = await open(user);
  expect(within(dialog).getByRole("heading", { name: "Filter", exact: true })).toBeInTheDocument();
});

it("uses host remote facets/count, hides only the delegated filters, and emits complete model changes", async () => {
  const { sampleLabels } = await import("../filter-builder/sample.js");
  const user = userEvent.setup(); const changed = vi.fn();
  const initial = view({ table: { ...table, filters: [{ column: "team", kind: "enum", op: "in", values: ["Blue"] }] }, sort: [{ column: "amount", direction: "descending" }] });
  render(<DataTable aria-label="Records" columns={columns} rows={rows} rowKey={rowKey} model={initial} onModelChange={changed} rowSource="remote" filterLabels={sampleLabels} facets={{ team: [{ value: "Violet", count: 97 }] }} resultCount={97} />);
  expect(names()).toEqual(["Alpha", "Beta", "Gamma"]);
  const chips = screen.getByRole("group", { name: "Filters" });
  await user.click(within(chips).getByRole("button", { name: "Team is any of Blue", exact: true }));
  const editor = await screen.findByRole("dialog");
  expect(within(editor).getByRole("checkbox", { name: "Violet" })).toBeInTheDocument();
  expect(within(editor).queryByRole("checkbox", { name: "Gold" })).not.toBeInTheDocument();
  await user.click(within(editor).getByRole("checkbox", { name: "Violet" }));
  expect(changed.mock.lastCall![0]).toEqual({ ...initial, table: { ...initial.table, filters: [{ column: "team", kind: "enum", op: "in", values: ["Blue", "Violet"] }] } });
  await user.keyboard("{Escape}");
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("97 projects"));
  const dialog = await open(user);
  expect(within(dialog).queryByRole("heading", { name: "Filter", exact: true })).not.toBeInTheDocument();
  expect(within(dialog).getByRole("heading", { name: "Sort", exact: true })).toBeInTheDocument();
  await user.keyboard("{Escape}"); expect(screen.queryByText(/Filter: Team/)).not.toBeInTheDocument();
});
