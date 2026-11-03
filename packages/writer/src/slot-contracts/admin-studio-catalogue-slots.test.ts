import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { listSlots, readCandidate, readSlot } from "../../../producer/src/records/slots.js";
import { parseFrontmatter, validateCandidate } from "../../../producer/src/records/slot-model/index.js";
import { writerRecords } from "../../../producer/src/migrate/sources.js";
import { recordSpecimenInput, slotGallery } from "../../../producer/src/server/slot-gallery.js";

const consumer = fileURLToPath(new URL("../../../../clossys/", import.meta.url));
const sourcePath = "packages/writer/src/catalog/records/admin-studio.r1.en.json";
const sourceBytes = readFileSync(new URL("../catalog/records/admin-studio.r1.en.json", import.meta.url), "utf8");
const catalogue = JSON.parse(sourceBytes);
const candidate = "admin-studio-draft-v1.md";

describe("Studio catalogue draft Writer specimens", () => {
  for (const [slot, count] of [["strings.names", 300]] as const) {
    it(`preserves every ${slot} source record through the canonical specimen reader`, () => {
      const entry = listSlots(consumer, "writer").find(row => row.id === slot)!;
      expect(entry.pin).toBeNull();
      const source = readCandidate(consumer, "writer", slot, candidate);
      expect(validateCandidate("strings", slot, candidate, source.bytes)).toEqual([]);
      const parsed = parseFrontmatter(source.bytes);
      if (!parsed.ok) throw new Error(parsed.message);
      expect(parsed.value.fields.source).toEqual({
        kind: "derived",
        ref: [sourcePath + "#records", sourcePath + "#sourceCommit=" + catalogue.sourceCommit],
        hash: createHash("sha256").update(sourceBytes).digest("hex"),
      });
      expect(parsed.value.fields.locales).toEqual([catalogue.locale]);
      const expected = catalogue.records.filter((row: { leaf: string }) => row.leaf === slot);
      const records = writerRecords(parsed.value.body);
      expect(records).toHaveLength(count);
      expect(records.map(row => ({ ...((row.meta.catalogue as { record: object }).record), text: row.text }))).toEqual(expected);
      expect(records.map(row => row.key)).toEqual(expected.map((row: { context: string }) => row.context));
      for (const row of records) {
        expect(row.locale).toBe(catalogue.locale);
        expect(row.meta.bindings).toEqual([]);
        expect(row.meta.catalogue).toMatchObject({ version: catalogue.version, revision: catalogue.revision,
          state: "draft", activation: "none", locale: catalogue.locale, sourceCommit: catalogue.sourceCommit });
        expect(row.meta.id).toBe((row.meta.catalogue as { record: { id: string } }).record.id);
      }
      const specimen = recordSpecimenInput(consumer, "writer", slot)!;
      expect(specimen.rows.map(row => row.text)).toEqual(expected.map((row: { text: string }) => row.text));
      expect(specimen.empty).toBe("No pin");
      expect(slotGallery(consumer, "writer").sections.flatMap(section => section.cards).find(card => card.id === slot))
        .toMatchObject({ status: "draft", candidate, emptyState: "No pin" });
    });
  }

  it("keeps every migrated name inside its canonical slot limits", () => {
    const slot = "strings.names";
    const contract = readSlot(consumer, "writer", slot).contract;
    const parsed = parseFrontmatter(readCandidate(consumer, "writer", slot, candidate).bytes);
    if (!parsed.ok) throw new Error(parsed.message);
    for (const row of writerRecords(parsed.value.body)) {
      expect([...row.text].length).toBeLessThanOrEqual(Number(contract.maxChars));
      expect(row.text.trim().split(/\s+/).length).toBeLessThanOrEqual(Number(contract.maxWords));
    }
  });
});
