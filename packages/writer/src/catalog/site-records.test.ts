import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { validateWriterRecord } from "../model/validate.js";
import { resolveWriterRefText } from "../checks/approval.js";
import type { WriterRecord } from "../model/types.js";
import { renderToStaticMarkup } from "react-dom/server";
import { writerPassageSchemaDigest } from "../checks/closed-world.js";
import { loadWriterCatalog } from "./ia/index.js";
import { renderErrorState, errorStateInputs } from "../../../designer/src/runtime/sections/error-state.js";
import { ANATOMY_CONTENT_KEY } from "../../../designer/src/runtime/sections/group-c-content.js";

import { withDeclaredCommonRecords } from "./__fixtures__/shared-records.fixture.js";

const read = (name: string) => JSON.parse(readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), name), "utf8"));

function globalErrorPassage(data: ReturnType<typeof read>) {
  const records = withDeclaredCommonRecords(data);
  const matches = records.filter(record => record.id === data.aliases["ps.error.global"]);
  if (matches.length !== 1 || !("fields" in matches[0]!)) throw new Error("ps.error.global must resolve to one passage");
  return { passage: matches[0], records };
}

describe("draft site Writer records", () => {
  it("resolves the existing global-error alias to a valid, renderable live ErrorState passage", () => {
    const data = read("./records/site.en.json");
    expect(data.aliases["ps.error.global"]).toBe("ps.000000002q");
    const { passage, records } = globalErrorPassage(data);
    expect(passage).toMatchObject({ leaf: "passages.error-state", schema: "passages.error-state", status: "draft", origin: "authored" });
    expect(passage.approval).toBeUndefined();
    expect(validateWriterRecord(passage, "passages")).toEqual([]);
    const schema = loadWriterCatalog().slots.find(slot => slot.id === passage.schema)!;
    const source = read("../../../designer/src/catalog/slots/sections.json").find((slot: { id: string }) => slot.id === "sections.error-state");
    expect(schema.contract).toEqual({ kind: "passage", source: "writer", sectionId: source.id, passageSchema: passage.schema, copy: source.contract.copy });
    expect(passage.schemaDigest).toBe(writerPassageSchemaDigest(schema.contract));
    const declared = (source.contract.copy.fields as { key: string }[]).map(field => field.key);
    expect(Object.keys(passage.fields).every(key => declared.includes(key))).toBe(true);
    const fields = Object.fromEntries(Object.entries(passage.fields).map(([key, ref]) => {
      expect(Array.isArray(ref), key).toBe(false);
      const text = resolveWriterRefText(Array.isArray(ref) ? ref[0]! : ref, records);
      expect(text.length, key).toBeGreaterThan(0);
      return [key, text];
    }));
    expect(fields).toEqual({ code: "Error", "header.heading": "Something went wrong", "header.description": "Please try again later.", "retry.label": "Return home", "report.label": "Support reference" });
    const html = renderToStaticMarkup(renderErrorState({
      fill: { leaf: "sections.error-state", ...errorStateInputs },
      selection: { leaf: "sections.error-state", members: ["kind.failure"] },
      content: {
        [ANATOMY_CONTENT_KEY]: { value: { heading: fields["header.heading"], description: fields["header.description"] } },
        code: { value: fields.code }, retry: { value: { label: fields["retry.label"] } }, report: { value: { label: fields["report.label"] } },
      },
    } as Parameters<typeof renderErrorState>[0]));
    expect(html).toContain('data-ds-leaf="sections.error-state"');
    for (const text of Object.values(fields)) expect(html).toContain(text);
  });

  it("rejects the actual global-error alias when its opaque target is missing", () => {
    const data = read("./records/site.en.json");
    globalErrorPassage(data);
    data.records = data.records.filter((record: WriterRecord) => record.id !== data.aliases["ps.error.global"]);
    expect(() => globalErrorPassage(data)).toThrow("ps.error.global must resolve to one passage");
  });

  it("validates every opaque record, semantic alias and passage reference without inventing approval", () => {
    const data = read("./records/site.en.json");
    const records = withDeclaredCommonRecords(data);
    const byId = new Map(records.map(record => [record.id, record]));
    expect(byId.size).toBe(records.length);
    for (const record of records) {
      const layer = record.id.startsWith("st.") ? "strings" : record.id.startsWith("ps.") ? "passages" : record.id.startsWith("pt.") ? "patterns" : "narratives";
      expect(validateWriterRecord(record, layer), record.id).toEqual([]);
      expect(record.status).toBe("draft"); expect(record.approval).toBeUndefined();
      if ("fields" in record) for (const value of Object.values(record.fields)) for (const ref of Array.isArray(value) ? value : [value]) expect(resolveWriterRefText(ref, records).length).toBeGreaterThan(0);
    }
    for (const alias of ["ps.hero.home", "ps.features.about", "ps.faq.about", "ps.form.contact", "st.form.error.required", "nr.legal.privacy", "nr.legal.terms", "ps.status.not-found", "ps.status.unavailable", "ps.status.construction", "ps.error.global"]) expect(byId.has(data.aliases[alias]), alias).toBe(true);
    for (const alias of ["nr.legal.privacy", "nr.legal.terms"]) {
      const narrative = byId.get(data.aliases[alias])!;
      expect(narrative.leaf).toBe("narratives.legal-document");
      expect("blocks" in narrative && narrative.blocks.length).toBeGreaterThan(0);
      const passage = byId.get(data.aliases[alias.replace("nr.", "ps.")])!;
      if ("fields" in passage && "blocks" in narrative) {
        const body = passage.fields.body!;
        expect(narrative.blocks[0]?.text).toBe(resolveWriterRefText(Array.isArray(body) ? body[0]! : body, records));
      }
    }
  });
});
