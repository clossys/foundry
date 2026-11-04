import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { listSlots, readCandidate, readSlot } from "../../../producer/src/records/slots.js";
import { parseFrontmatter, validateCandidate } from "../../../producer/src/records/slot-model/index.js";
import { recordSpecimenInput, slotGallery } from "../../../producer/src/server/slot-gallery.js";
import { parseWriterSlotBody } from "../slot-body.js";

/** Rows in source order through the canonical Writer slot-body parser (the legacy migrate reader is gone). */
const writerRecords = (body: string, locales: readonly string[]) => parseWriterSlotBody(body, locales)
  .map(({ locale, record: { context, text, ...meta }, bindings }) => ({ locale, key: context, meta: { ...meta, bindings } as Record<string, unknown>, text: text ?? "" }));

const consumer = fileURLToPath(new URL("../../../../clossys/", import.meta.url));
const sourcePath = "packages/writer/src/catalog/records/admin-studio.r1.en.json";
const sourceBytes = readFileSync(new URL("../catalog/records/admin-studio.r1.en.json", import.meta.url), "utf8");
const catalogue = JSON.parse(sourceBytes);
const candidate = "admin-studio-draft-v1.md";
/** The slot's pin as the file records it: the owner may pin the draft, and the test follows the file. */
const pinOf = (slot: string) => {
  const path = fileURLToPath(new URL(`agents/writer/${slot}/pin.json`, `file://${consumer}`));
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) as { candidate: string; sha256: string } : null;
};

describe("Studio catalogue draft Writer specimens", () => {
  for (const [slot, count] of [["strings.names", 300]] as const) {
    it(`preserves every ${slot} source record through the canonical specimen reader`, () => {
      const entry = listSlots(consumer, "writer").find(row => row.id === slot)!;
      const pin = pinOf(slot);
      if (pin) expect(entry.pin).toMatchObject({ candidate: pin.candidate });
      else expect(entry.pin).toBeNull();
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
      const records = writerRecords(parsed.value.body, parsed.value.fields.locales as string[]);
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
      // The empty-state words are a Writer copy reference, resolved by Studio.
      expect(specimen.empty).toEqual({ copy: "studio.no-pin" });
      const card = slotGallery(consumer, "writer").sections.flatMap(section => section.cards).find(card => card.id === slot);
      if (pin) {
        expect(pin.candidate).toBe(candidate);
        expect(card).toMatchObject({ status: "active", candidate, state: { state: "pinned" } });
        expect(card).not.toHaveProperty("emptyState");
      } else expect(card).toMatchObject({ status: "draft", candidate, emptyState: "no-pin" });
    });
  }

  it("keeps every migrated name inside its canonical slot limits", () => {
    const slot = "strings.names";
    const contract = readSlot(consumer, "writer", slot).contract;
    const parsed = parseFrontmatter(readCandidate(consumer, "writer", slot, candidate).bytes);
    if (!parsed.ok) throw new Error(parsed.message);
    for (const row of writerRecords(parsed.value.body, parsed.value.fields.locales as string[])) {
      expect([...row.text].length).toBeLessThanOrEqual(Number(contract.maxChars));
      expect(row.text.trim().split(/\s+/).length).toBeLessThanOrEqual(Number(contract.maxWords));
    }
  });
});
