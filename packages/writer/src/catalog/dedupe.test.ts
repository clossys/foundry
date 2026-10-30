import { readFileSync, readdirSync } from "node:fs";
import { expect, it } from "vitest";
import type { StringRecord } from "../model/types.js";
import { checkStringDuplicates } from "./dedupe.js";
import { checkWriterClosedWorld } from "../checks/closed-world.js";
import type { WriterLibrary } from "../model/types.js";

const record = (id: StringRecord["id"], leaf: StringRecord["leaf"] = "strings.common"): StringRecord => ({
  id, leaf, context: id, text: "Open", status: "draft", origin: "foundry-default",
});

it("rejects a seeded same-text same-leaf duplicate and accepts a declared semantic split", () => {
  const records = [record("st.0000000001"), record("st.0000000002")];
  expect(checkStringDuplicates(records)).toEqual([{ leaf: "strings.common", text: "Open", recordIds: records.map(row => row.id) }]);
  expect(checkStringDuplicates(records, [{ recordIds: records.map(row => row.id), reason: "Different grammatical senses require independent translations." }])).toEqual([]);
  expect(checkStringDuplicates(records, [{ recordIds: records.map(row => row.id), reason: " " }])).toHaveLength(1);
  expect(checkStringDuplicates([...records, record("st.0000000003")], [{ recordIds: records.map(row => row.id), reason: "A third record is not covered by this split." }])).toHaveLength(1);
  expect(checkStringDuplicates([records[0]!, record("st.0000000002", "strings.actions")])).toEqual([]);
});

it("enforces the seeded duplicate through the library's normal closed-world gate", () => {
  const records = [record("st.0000000001"), record("st.0000000002")];
  const library: WriterLibrary = {
    manifest: { consumer: "dedupe-proof", messageSyntax: "icu-mf1", defaultLocale: "en", locales: [{ tag: "en", dir: "ltr", state: "active" }], fallback: {}, strategist: { path: "strategy" }, leafFreeze: { lexicon: "", strings: "", patterns: "", passages: "", narratives: "" } },
    locales: { en: { records, documents: [] } },
  };
  expect(checkWriterClosedWorld(library)).toContainEqual(expect.objectContaining({ code: "WR3", field: "text", message: expect.stringContaining("Duplicate text in strings.common") }));
  expect(checkWriterClosedWorld(library, { stringSplits: [{ recordIds: records.map(row => row.id), reason: "Independent grammatical senses require separate translation." }] })).toEqual([]);
});

it("keeps every English source record free of undeclared same-leaf text duplicates", () => {
  const records: StringRecord[] = [];
  const collect = (value: unknown): void => {
    if (Array.isArray(value)) { value.forEach(collect); return; }
    if (!value || typeof value !== "object") return;
    const row = value as Record<string, unknown>;
    if (typeof row.id === "string" && typeof row.leaf === "string" && typeof row.text === "string") records.push(row as unknown as StringRecord);
    else for (const [key, child] of Object.entries(row)) if (key !== "ar") collect(child);
  };
  const visit = (directory: URL): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = new URL(entry.name, directory);
      if (entry.isDirectory()) visit(new URL(`${entry.name}/`, directory));
      else if (entry.name.endsWith(".json")) collect(JSON.parse(readFileSync(path, "utf8")));
    }
  };
  visit(new URL("./records/", import.meta.url));
  expect(records.length).toBeGreaterThan(1000);
  expect(checkStringDuplicates(records)).toEqual([]);
});
