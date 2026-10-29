import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { getAdminCopy } from "@clossys/writer/admin-copy";
import { WriterRoutePage, type WriterRouteServerData } from "./WriterRoutePage.js";
import { WRITER_COPY_REFS } from "./copy.js";

it("renders the public Writer preview's loading draft with a visible provenance marker", () => {
  const copy = getAdminCopy(), before = JSON.stringify(copy);
  const serverData = { writer: { copy } } as WriterRouteServerData;
  const html = renderToStaticMarkup(<WriterRoutePage serverData={serverData} initialSession={undefined} />);
  const draft = copy.records.find(record => record.id === WRITER_COPY_REFS.loading.id)!;
  expect(html).toContain(draft.text);
  expect(html).toContain(`data-copy-ref="${draft.id}"`);
  expect(html).toContain('data-copy-status="draft"');
  expect(html).toContain('data-copy-locale="en"');
  expect(JSON.stringify(copy)).toBe(before);
  expect(draft).not.toHaveProperty("approval");
});

it("keeps missing Writer preview copy as an explicit Need", () => {
  const source = getAdminCopy();
  const copy = { ...source, records: source.records.filter(record => record.id !== WRITER_COPY_REFS.loading.id) };
  expect(() => renderToStaticMarkup(<WriterRoutePage serverData={{ writer: { copy } } as WriterRouteServerData} initialSession={undefined} />)).toThrow(`Writer copy Need: ${WRITER_COPY_REFS.loading.id}`);
});
