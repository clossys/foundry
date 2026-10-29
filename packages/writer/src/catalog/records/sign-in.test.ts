import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import data from "./sign-in.json" with { type: "json" };
import { validateWriterRecord } from "../../model/validate.js";
import { writerPassageSchemaDigest } from "../../checks/closed-world.js";
import { resolveCopyRef } from "../../resolve.js";
import type { CopyRegistry } from "../../types.js";

import { withDeclaredCommonRecords } from "../__fixtures__/shared-records.fixture.js";
import aliasHandoff from "../__fixtures__/common-label-aliases.r1.json" with { type: "json" };
const sourceFor = (locale: "en" | "ar") => ({ ...data.locales[locale], records: locale === "en" ? withDeclaredCommonRecords(data.locales.en) : data.locales.ar.records });

const aliases = ["ps.sign-in.password", "ps.sign-in.provider", "ps.sign-in.verify"];
const sections = JSON.parse(readFileSync(new URL("../../../../designer/src/catalog/slots/sections.json", import.meta.url), "utf8")) as {
  id: string; contract: { passageSchema: string; copy: { fields: { key: string }[] } };
}[];
const section = sections.find(row => row.id === "sections.sign-in-form")!;
const schemaContract = {
  kind: "passage", source: "writer", sectionId: section.id,
  passageSchema: section.contract.passageSchema, copy: section.contract.copy,
};

describe("draft generic sign-in catalog records", () => {
  it.each(["en", "ar"] as const)("keeps %s opaque records unapproved and shape-valid", locale => {
    const source = sourceFor(locale);
    expect(new Set(source.records.map(record => record.id)).size).toBe(source.records.length);
    for (const record of source.records) {
      expect(record.id).toMatch(/^(st|ps)\.[0123456789abcdefghjkmnpqrstvwxyz]{10}$/);
      expect(record.status).toBe("draft");
      expect(record).not.toHaveProperty("approval");
      expect(validateWriterRecord(record, "text" in record ? "strings" : "passages")).toEqual([]);
    }
    expect(Object.keys(source.bindings)).toEqual(aliases);
  });

  it.each(["en", "ar"] as const)("pairs every %s passage field with its exact Writer CopyRef", locale => {
    const source = sourceFor(locale);
    const schemaKeys = section.contract.copy.fields.map(field => field.key).sort();
    expect(schemaKeys).toHaveLength(20);
    for (const binding of Object.values(source.bindings)) {
      const passage = source.records.find(record => record.id === binding.passageId)!;
      expect(passage).toMatchObject({ leaf: "passages.sign-in-form", schema: "passages.sign-in-form", schemaDigest: writerPassageSchemaDigest(schemaContract) });
      if (!("fields" in passage)) throw new Error("Expected a passage record");
      expect(Object.keys(binding.fields).sort()).toEqual(schemaKeys);
      expect(Object.keys(passage.fields!).sort()).toEqual(schemaKeys);
      for (const [field, ref] of Object.entries(binding.fields)) {
        expect(passage.fields![field as keyof typeof passage.fields]).toEqual({ ref: "string", id: ref.id });
        expect(source.records.find(record => record.id === ref.id)).toHaveProperty("text");
      }
    }
  });

  it.each(["en", "ar"] as const)("resolves every %s string through Writer using synthetic test approval", locale => {
    const source = sourceFor(locale);
    const strings = source.records.filter(record => "text" in record);
    // The authored catalog remains draft. This projection is a test fixture,
    // never approval evidence or a production copy registry.
    const registry: CopyRegistry = {
      id: "sign-in-catalog-test", locale, revision: "fixture-1",
      source: { kind: "generated", reference: "synthetic/sign-in-test" },
      entries: strings.map(record => ({ id: record.id, text: record.text!, context: record.context, status: "approved" })),
    };
    for (const entry of registry.entries) {
      const resolved = resolveCopyRef(registry, { id: entry.id, locale });
      expect(resolved.issues).toEqual([]);
      expect(resolved.complete).toBe(true);
      expect(resolved.resolution).toMatchObject({ text: entry.text, servedLocale: locale, chain: [locale] });
    }
    expect(resolveCopyRef(registry, { ...source.skipLink, locale }).complete).toBe(true);
    expect(Object.keys(source.notices)).toHaveLength(11);
    for (const [alias, ref] of Object.entries(source.notices)) {
      expect(alias).toMatch(/^st\.auth\.error\.[a-z-]+$/);
      expect(resolveCopyRef(registry, { ...ref, locale }).complete).toBe(true);
    }
  });

  it("shares stable record identities between locales without treating reuse as duplicate copy", () => {
    // Native Arabic retains its authored IDs and text. English shared identities
    // are connected by the handoff map; this does not prove a runtime alias reader.
    const remaps = aliasHandoff.aliases as Record<string, string>;
    expect([...new Set(data.locales.ar.records.map(record => remaps[record.id] ?? record.id))].sort())
      .toEqual(sourceFor("en").records.map(record => record.id).sort());
    expect(data.locales.ar.records).toHaveLength(39);
    for (const [id, text] of [["st.f5ce2skzxv", "تسجيل الدخول"], ["st.an5ekdr18g", "رجوع"], ["st.95zeepaj3s", "تسجيل الدخول"]])
      expect(data.locales.ar.records.find(record => record.id === id)).toMatchObject({ text, status: "draft" });
    const en = data.locales.en.bindings;
    expect(en["ps.sign-in.password"].fields["actions.submit"]).toEqual(en["ps.sign-in.provider"].fields["actions.submit"]);
    expect(data.locales.ar.records.filter(record => "text" in record).every(record => /[\u0600-\u06ff]/u.test(record.text!))).toBe(true);
  });
});
