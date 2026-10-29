import { type ReactNode } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { IntlMessageFormat } from "intl-messageformat";
import type { RuntimeRenderInput } from "../../catalog-core/runtime-ports.js";
import { renderDataTable } from "./data-table.js";
import { copyPortsFor } from "./__fixtures__/copy-ports.js";

afterEach(cleanup);
function table(summary: unknown, formatCopyMessage: unknown) {
  const values = { header: { heading: "Writer records", level: 4 }, columns: [{ id: "name", label: "Name" }], rows: Array.from({ length: 205 }, (_, n) => ({ id: String(n), name: `Record ${n}` })), pagination: { showAll: "Show all", label: "Records", previous: "Previous", next: "Next" } };
  return { sectionHost: { ...copyPortsFor("sections.data-table"), paginationSummary: summary, formatCopyMessage }, fill: { leaf: "sections.data-table", config: null, slots: Object.keys(values), members: [] }, selection: { leaf: "sections.data-table", members: [], config: null }, cell: { state: "default" }, content: Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { value }])), slots: {}, profile: {} } as unknown as RuntimeRenderInput<ReactNode>;
}
it("renders the Writer ICU plural with live pagination args and a serializable message", () => {
  const summary = { key: "pagination.totalText", writerId: "st.9njpzn8mym", locale: "en", message: "Page {page} of {pages}: {total, plural, one {# record} other {# records}}; {start}–{end}; {label}", values: { label: "Writer", start: 999, page: 999, pages: 999, total: 1 } };
  const format = vi.fn((value: typeof summary) => String(new IntlMessageFormat(value.message, value.locale).format(value.values)));
  expect(JSON.parse(JSON.stringify(summary))).toEqual(summary);
  render(renderDataTable(table(summary, format)));
  fireEvent.click(screen.getByRole("button", { name: "Show all" }));
  expect(screen.getByText("Page 1 of 3: 205 records; 1–100; Writer")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  expect(screen.getByText("Page 2 of 3: 205 records; 101–200; Writer")).toBeTruthy();
  expect(format.mock.calls.at(-1)?.[0].values).toMatchObject({ page: 2, pages: 3, pageCount: 3, total: 205 });
  expect(summary.values).toMatchObject({ start: 999, page: 999, pages: 999, total: 1 });
});
it("refuses a callback summary and a missing generic Writer formatter", () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    render(renderDataTable(table(() => "authored callback", () => "text")));
    expect(() => fireEvent.click(screen.getByRole("button", { name: "Show all" }))).toThrow(/ICU message/);
    cleanup();
    render(renderDataTable(table({ key: "pagination.totalText", writerId: "st.9njpzn8mym", locale: "en", message: "{total}", values: {} }, undefined)));
    expect(() => fireEvent.click(screen.getByRole("button", { name: "Show all" }))).toThrow(/formatCopyMessage/);
  } finally { error.mockRestore(); }
});
