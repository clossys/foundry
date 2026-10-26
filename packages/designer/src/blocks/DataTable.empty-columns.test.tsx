import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { DataTable, type DataTableColumn } from "./DataTable.js";

interface StageRow { id: string; lane: string; frame?: string; deploy: readonly string[]; release: string }

const ROWS: StageRow[] = [
  { id: "web", lane: "Web", frame: "frames.app", deploy: [], release: "v1" },
  { id: "admin", lane: "Admin", deploy: [], release: "v2" },
];

const COLUMNS: DataTableColumn<StageRow>[] = [
  { id: "lane", header: "Lane", isRowHeader: true, cell: row => row.lane },
  { id: "frame", header: "Frame", cell: row => row.frame ?? null },
  { id: "deploy", header: "Deploy", cell: row => <>{row.deploy.map(item => <span key={item}>{item}</span>)}</> },
  { id: "release", header: "Release", format: "id", cell: row => row.release },
];

const headers = () => screen.getAllByRole("columnheader").map(header => header.textContent);

describe("DataTable empty columns and id cells", () => {
  it("hides a column whose every cell is empty, keeping a partly filled one and its header", () => {
    render(<DataTable aria-label="Stages" columns={COLUMNS} rows={ROWS} rowKey={row => row.id} hideEmptyColumns />);
    expect(headers()).toEqual(["Lane", "Frame", "Release"]);
    expect(screen.getAllByRole("row")).toHaveLength(3);
    expect(screen.getByRole("rowheader", { name: "Admin" })).toBeTruthy();
  });

  it("keeps every column when the prop is off", () => {
    render(<DataTable aria-label="Stages" columns={COLUMNS} rows={ROWS} rowKey={row => row.id} />);
    expect(headers()).toEqual(["Lane", "Frame", "Deploy", "Release"]);
  });

  it("keeps every column header while there are no rows to judge", () => {
    render(<DataTable aria-label="Stages" columns={COLUMNS} rows={[]} rowKey={row => row.id} hideEmptyColumns />);
    expect(headers()).toEqual(["Lane", "Frame", "Deploy", "Release"]);
  });

  it("renders id-format cells through the type-id binding", () => {
    render(<DataTable aria-label="Stages" columns={COLUMNS} rows={ROWS} rowKey={row => row.id} />);
    expect(screen.getByRole("gridcell", { name: "v1" }).className).toContain("type-id");
    expect(screen.getByRole("gridcell", { name: "frames.app" }).className).not.toContain("type-id");
  });
});
