import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { validateWriterRecord } from "../model/validate.js";
import { resolveWriterRefText } from "../checks/approval.js";
import type { WriterRecord } from "../model/types.js";

const read = (name: string) => JSON.parse(readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), name), "utf8"));
describe("draft site Writer records", () => {
  it("validates every opaque record, semantic alias and passage reference without inventing approval", () => {
    const data = read("./records/site.en.json");
    const records = data.records as WriterRecord[];
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
