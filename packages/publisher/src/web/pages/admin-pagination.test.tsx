/** @vitest-environment jsdom */
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { surfaceRuntimeRenderers } from "@clossys/designer/frames";
import type { RuntimeRenderInput } from "@clossys/designer/catalog";
import type { ReactNode } from "react";
import { copyEnvelopes, pages } from "./__fixtures__/copy.mjs";
import { prepareAdminPageCopyEnvelopes } from "./admin-copy-source.js";
import { createAdminPageCopy } from "./admin-copy.js";
import { adminPageSectionHosts } from "./admin-copy-ports.js";

afterEach(cleanup);
function fixture() {
  const envelopes = JSON.parse(JSON.stringify(copyEnvelopes()));
  const record = envelopes[0].envelope.records.find(record => record.id === pages.aliases["strings.admin.pagination.range"]);
  // A test-only Writer draft, checked through its public schema and formatter.
  record.text = "{start}–{end} of {total, plural, one {# record} other {# records}}; {page}/{pages}";
  record.args = [{ name: "start", type: "number" }, { name: "end", type: "number" }, { name: "total", type: "plural" }, { name: "page", type: "number" }, { name: "pages", type: "number" }];
  const copy = createAdminPageCopy({ locale: "en", envelopes: prepareAdminPageCopyEnvelopes(envelopes) });
  return { copy, host: adminPageSectionHosts({ copy, title: { id: "strings.admin.page.writer" }, includeRecordDetail: false })["sections.data-table"] };
}
function table(copy: ReturnType<typeof fixture>["copy"], host: Record<string, unknown>): RuntimeRenderInput<ReactNode> {
  const values = { header: { heading: copy("strings.admin.page.writer"), level: 4 }, columns: [{ key: "name", label: copy("strings.admin.column.name") }],
    rows: Array.from({ length: 205 }, (_, index) => ({ id: String(index), name: copy("strings.admin.page.writer") })),
    pagination: { showAll: copy("strings.admin.action.showAll", { count: 205 }), label: copy("strings.admin.pagination.label"), previous: copy("strings.admin.pagination.previous"), next: copy("strings.admin.pagination.next") } };
  return { fill: { leaf: "sections.data-table", slots: Object.keys(values), members: [] }, selection: { leaf: "sections.data-table", members: [] }, cell: { state: "default" }, sectionHost: host, slots: {}, content: Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { value }])) } as unknown as RuntimeRenderInput<ReactNode>;
}
it("sends genuine Writer message data through the native live pagination and canonical plural formatter", () => {
  const { copy, host } = fixture();
  expect(typeof host.paginationSummary).toBe("object");
  expect(host.paginationSummary.message).toContain("{total, plural");
  expect(JSON.parse(JSON.stringify(host.paginationSummary))).toEqual(host.paginationSummary);
  const view = render(<>{surfaceRuntimeRenderers["sections.data-table"]!.render(table(copy, host))}</>);
  fireEvent.click(view.getByRole("button", { name: copy("strings.admin.action.showAll", { count: 205 }) }));
  expect(view.getByText("1–100 of 205 records; 1/3")).toBeTruthy();
  fireEvent.click(view.getByRole("button", { name: copy("strings.admin.pagination.next") }));
  expect(view.getByText("101–200 of 205 records; 2/3")).toBeTruthy();
  expect(copy.provenance().some(value => value.ref.values?.page === 2 && value.ref.values.total === 205)).toBe(true);
  for (const forged of [{ message: "Unbound replacement" }, { writerId: "st.unknown000" }, { locale: "ar" }, { key: "other" }])
    expect(() => host.formatCopyMessage({ ...host.paginationSummary, ...forged } as typeof host.paginationSummary)).toThrow(/identity/);
  expect(() => host.formatCopyMessage({ ...host.paginationSummary, values: { start: 1, end: 100, total: 205, page: 1, pages: 3, authoredUnknown: 7 } })).toThrow(/Writer/);
  expect(host.formatCopyMessage({ ...host.paginationSummary, values: { start: 1, end: 1, total: 1, page: 1, pages: 1 } })).toBe("1–1 of 1 record; 1/1");
});
it("refuses obsolete callback pagination rather than silently using handwritten summary text", () => {
  const { copy, host } = fixture(), error = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    const view = render(<>{surfaceRuntimeRenderers["sections.data-table"]!.render(table(copy, { ...host, paginationSummary: () => "Handwritten" }))}</>);
    expect(() => fireEvent.click(view.getByRole("button", { name: copy("strings.admin.action.showAll", { count: 205 }) }))).toThrow(/Writer ICU message/);
  } finally { error.mockRestore(); }
});
