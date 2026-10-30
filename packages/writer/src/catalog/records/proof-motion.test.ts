import { describe, expect, it } from "vitest";
import site from "./site.en.json" with { type: "json" };
import passages from "../slots/passages.json" with { type: "json" };
import { validateWriterRecord } from "../../model/validate.js";
import { checkWriterClosedWorld, writerPassageSchemaDigest } from "../../checks/closed-world.js";
import type { WriterLibrary, WriterRecord } from "../../model/types.js";

describe("draft proof-section motion copy", () => {
  it.each([
    ["logo-cloud", "pause"], ["logo-cloud", "resume"],
    ["testimonials", "previous"], ["testimonials", "next"],
    ["gallery", "close"], ["gallery", "enlarge"],
  ])("declares the %s %s control as authored draft copy and a passage field", (section, control) => {
    const alias = `st.proof.${section}.${control}`;
    const id = (site.aliases as Record<string, string>)[alias];
    expect(id).toMatch(/^st\.[0123456789abcdefghjkmnpqrstvwxyz]{10}$/);
    const record = site.records.find(row => row.id === id)!;
    expect(record).toMatchObject({ status: "draft", origin: "authored" });
    expect(record).not.toHaveProperty("approval");
    expect(validateWriterRecord(record, "strings")).toEqual([]);
    const schema = passages.find(row => row.id === `passages.${section}`)!;
    expect(schema.contract.copy.fields).toContainEqual(expect.objectContaining({ key: `controls.${control}`, kind: "plain" }));
  });
  it("provides referentially complete, unapproved native preview passages", () => {
    const aliases = site.aliases as Record<string, string>;
    const ids = new Set(Object.entries(aliases).filter(([alias]) => /^(?:st|ps)\.proof\./.test(alias)).map(([, id]) => id));
    const records = site.records.filter(row => ids.has(row.id)) as WriterRecord[];
    for (const section of ["logo-cloud", "testimonials", "stats", "gallery"]) {
      const record = records.find(row => row.id === aliases[`ps.proof.${section}`])!;
      const schema = passages.find(row => row.id === `passages.${section}`)!;
      expect(record).toMatchObject({ status: "draft", origin: "authored", schema: schema.id, schemaDigest: writerPassageSchemaDigest(schema.contract) });
      expect(record).not.toHaveProperty("approval");
      expect(validateWriterRecord(record, "passages")).toEqual([]);
    }
    const library: WriterLibrary = {
      manifest: { consumer: "proof-preview", messageSyntax: "icu-mf1", defaultLocale: "en", locales: [{ tag: "en", dir: "ltr", state: "active" }], fallback: {}, strategy: { root: "strategy", contract: "writer.messaging" }, leafFreeze: { lexicon: "", strings: "", patterns: "", passages: "", narratives: "" } },
      locales: { en: { records, documents: [] } },
    };
    expect(checkWriterClosedWorld(library)).toEqual([]);
  });
});
