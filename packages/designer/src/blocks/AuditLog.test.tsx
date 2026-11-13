import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { AuditLog } from "./AuditLog.js";
import { auditLogSample } from "./audit-log/sample.js";

describe("AuditLog", () => {
  it("AL1: renders the entries as a named grid with time, actor, action and target columns", () => {
    render(<AuditLog {...auditLogSample} />);
    const grid = screen.getByRole("grid", { name: "Audit log" });
    expect(within(grid).getAllByRole("columnheader").map(cell => cell.textContent)).toEqual(["Time", "Actor", "Action", "Target"]);
    const rows = within(grid).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(3);
    expect(rows[1]).toHaveTextContent("Sam Ortiz");
    expect(rows[1]).toHaveTextContent("Changed role");
    expect(rows[0]!.querySelector("time")).toHaveAttribute("datetime", "2026-03-12T09:24:00Z");
  });

  it("AL2: places the filter region and the export action above the grid", () => {
    render(<AuditLog {...auditLogSample} filter={<input aria-label="Search entries" />} exportAction={<button type="button">Export CSV</button>} />);
    const toolbar = document.querySelector("[data-audit-log-toolbar]") as HTMLElement;
    expect(within(toolbar).getByRole("textbox", { name: "Search entries" })).toBeVisible();
    expect(within(toolbar).getByRole("button", { name: "Export CSV" })).toBeVisible();
    expect(toolbar.compareDocumentPosition(screen.getByRole("grid")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("AL3: renders the authored empty state when there are no entries", () => {
    render(<AuditLog {...auditLogSample} entries={[]} />);
    expect(screen.getByText("No audit entries")).toBeVisible();
    expect(screen.queryByText("Sam Ortiz")).toBeNull();
  });
});
