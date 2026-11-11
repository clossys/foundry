import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { writerText, type WriterInput } from "../../producer/src/publish/site-plan.js";
import { parseWriterSlotBody, type WriterSlotBodyRecord } from "./slot-body.js";
import { parseWriterDeclarations, projectWriterDeclarations, serializeWriterDeclarations, writeWriterDeclarations, WriterDeclarationsParseError, WRITER_DECLARATIONS_SCHEMA } from "./declarations.js";
import { mkdirSync, mkdtempSync, readFileSync as readText, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const page = JSON.parse(readFileSync(new URL("./cells/__fixtures__/generic-admin/example-page.r1.en.json", import.meta.url), "utf8"));
const common = JSON.parse(readFileSync(new URL("./cells/__fixtures__/generic-admin/example-common.r1.en.json", import.meta.url), "utf8"));
const siteSections = JSON.parse(readFileSync(new URL("./catalog/__fixtures__/site-bindings.json", import.meta.url), "utf8"));
const document = (locales: unknown, extra = {}) => JSON.stringify({ schema: WRITER_DECLARATIONS_SCHEMA, locales, ...extra });
const empty = () => ({ aliases: {}, sections: [] });
const row = (id: string, locale = "en", value = "Example"): WriterSlotBodyRecord => ({ locale, record: { id, context: "example.context", text: value }, bindings: ["opaque.path"] });
const section = (id = "title-1") => ({ sectionId: "sections.hero", configId: "ground.base", passageAlias: "ps.example.hero", fields: [{ key: "header.heading", locale: "en", source: "writer", ref: { id, extension: { fallback: false } }, authorNote: "retained" }], sectionNote: { state: "explicit" } });

describe("native Writer declarations", () => {
  it("preserves named generic aliases including external targets without copying records", () => {
    const parsed = parseWriterDeclarations(document({ en: { aliases: page.aliases, sections: [] } }));
    const selected = projectWriterDeclarations(parsed, "en");
    expect(selected).toEqual({ aliases: page.aliases, sections: [] });
    expect(selected.aliases["strings.example.page.cancel"]).toBe(common.records[0].id);
    expect(selected).not.toHaveProperty("records");
    expect(() => projectWriterDeclarations(parsed, "en", { completeRecords: page.records.map((r: any) => ({ locale: "en", record: r, bindings: [] })) })).toThrow(/Missing record st.0000000003/);
    expect(projectWriterDeclarations(parsed, "en", { completeRecords: [...page.records, ...common.records].map((r: any) => ({ locale: "en", record: r, bindings: [] })) })).toEqual(selected);
  });

  it("preserves complete public site mappings, passageAlias, field locale/source/ref and empty sections", () => {
    const parsed = parseWriterDeclarations(document({ en: { aliases: {}, sections: siteSections } }));
    const selected = projectWriterDeclarations(parsed, "en");
    expect(selected.sections).toEqual(siteSections);
    expect(selected.sections[0]!.passageAlias).toBe("ps.hero.home");
    expect(selected.sections[0]!.fields[0]).toEqual({ key: "header.heading", locale: "en", source: "writer", ref: { id: "st.0000000001" } });
    expect(selected.sections.at(-1)!.fields).toEqual([]);
    expect(selected.sections.at(-1)!.passageAlias).toBe("ps.band.transparent");
  });

  it("preserves root, locale, section, field and ref metadata and source ordering without input mutation", () => {
    const original = { schema: WRITER_DECLARATIONS_SCHEMA, provenance: { note: "fixture only", values: [null, false] }, locales: { en: { aliases: { second: "title-2", first: "title-1" }, sections: [section(), { sectionId: "sections.band", configId: "ground.base", fields: [], emptyNote: true }], localeNote: [2, 1] } } };
    const parsed = parseWriterDeclarations(JSON.stringify(original));
    expect(parsed).toEqual(original);
    const selected = projectWriterDeclarations(parsed, "en", { completeRecords: [row("title-1"), row("title-2")] });
    expect(selected).toEqual(original.locales.en);
    expect(Object.keys(selected.aliases)).toEqual(["second", "first"]);
    selected.sections[0]!.fields[0]!.ref.id = "edited-copy";
    expect(parsed).toEqual(original);
  });

  it("uses distinct explicit maps per locale and does not infer maps from contexts or opaque row bindings", () => {
    const parsed = parseWriterDeclarations(document({ en: { aliases: { heading: "title-en" }, sections: [section("title-en")] }, ar: { aliases: { heading: "title-ar" }, sections: [{ ...section("title-ar"), fields: [{ key: "header.heading", locale: "ar", source: "writer", ref: { id: "title-ar" } }] }] } }));
    const records = [row("title-en"), row("title-ar", "ar")];
    expect(projectWriterDeclarations(parsed, "en", { completeRecords: records }).aliases).toEqual({ heading: "title-en" });
    expect(projectWriterDeclarations(parsed, "ar", { completeRecords: records }).sections[0]!.fields[0]!.ref.id).toBe("title-ar");
    expect(() => projectWriterDeclarations(parsed, "ar", { completeRecords: [row("title-ar", "en")] })).toThrow(/Missing record title-ar.*ar/);
    expect(projectWriterDeclarations(parseWriterDeclarations(document({ en: empty() })), "en", { completeRecords: records })).toEqual(empty());
  });

  it("lets Producer writerText consume projected aliases and section refs against actual native text", () => {
    const rows = parseWriterSlotBody('## en\n### context.is.not.the.alias\n<!-- {"id":"title-1","bindings":["opaque.path"]} -->\nChoose a next step\n\n', ["en"]);
    const selected = projectWriterDeclarations(parseWriterDeclarations(document({ en: { aliases: { "authored.title": "title-1" }, sections: [section()] } })), "en", { completeRecords: rows });
    const records = rows.flatMap(r => typeof r.record.text === "string" ? [{ ...r.record, text: r.record.text }] : []);
    const input: WriterInput = { ...selected, records };
    const lookup = writerText(input);
    expect(lookup.alias("authored.title")).toBe("Choose a next step");
    expect(lookup.record(input.sections[0]!.fields[0]!.ref.id)).toBe("Choose a next step");
    expect(input.sections).toEqual(selected.sections);
    expect(selected.aliases).not.toHaveProperty("context.is.not.the.alias");
  });

  it.each([undefined, null, "", "{}", document({}), document({ en: {} }), document({ en: { aliases: {} } }), document({ en: { sections: [] } }), document({ en: { aliases: null, sections: [] } })])("rejects absent or incomplete declarations %j", source => {
    expect(() => parseWriterDeclarations(source as string)).toThrow(WriterDeclarationsParseError);
  });

  it("accepts explicit empty maps while missing locales never fall back", () => {
    const parsed = parseWriterDeclarations(document({ en: empty() }));
    expect(projectWriterDeclarations(parsed, "en", { completeRecords: [] })).toEqual(empty());
    expect(() => projectWriterDeclarations(parsed, "ar")).toThrow(/\/locales\/ar: Missing authored locale/);
    expect(() => projectWriterDeclarations(parsed, "constructor")).toThrow(/Missing authored locale/);
  });

  it.each([
    document({ en: { aliases: { title: "" }, sections: [] } }),
    document({ en: { aliases: [], sections: [] } }),
    document({ en: { aliases: {}, sections: [section(), section()] } }),
    document({ en: { aliases: {}, sections: [{ ...section(), fields: [section().fields[0], section().fields[0]] }] } }),
    document({ en: { aliases: {}, sections: [{ ...section(), fields: [{ key: "title", ref: {} }] }] } }),
    document({ en: { aliases: {}, sections: [{ ...section(), fields: [{ key: "title", ref: { id: "x" }, locale: "ar" }] }] } }),
    document({ en: { aliases: {}, sections: [{ ...section(), fields: [{ key: "title", ref: { id: "x" }, source: "" }] }] } }),
    document({ en: { aliases: {}, sections: [{ sectionId: "sections.band", configId: "ground.base" }] } }),
    document({ "en_US": empty() }),
  ])("rejects ambiguous or malformed declarations", source => {
    expect(() => parseWriterDeclarations(source)).toThrow(WriterDeclarationsParseError);
  });

  it("rejects dangling field refs and conflicting native records when complete rows are provided", () => {
    const parsed = parseWriterDeclarations(document({ en: { aliases: {}, sections: [section()] } }));
    expect(() => projectWriterDeclarations(parsed, "en", { completeRecords: [] })).toThrow(/\/fields\/0\/ref\/id: Missing record title-1/);
    expect(() => projectWriterDeclarations(parsed, "en", { completeRecords: [row("title-1"), row("title-1", "en", "Conflict")] })).toThrow(/Conflicting native record/);
    expect(projectWriterDeclarations(parsed, "en", { completeRecords: [row("title-1"), row("title-1")] }).sections).toEqual([section()]);
    expect(() => projectWriterDeclarations(parsed, "en", { completeRecords: [null] as unknown as WriterSlotBodyRecord[] })).toThrow(/Invalid native record row/);
  });

  it("rejects duplicate JSON aliases and escaped-key collisions instead of overwriting", () => {
    for (const aliases of ['{"title":"a","title":"b"}', '{"title":"a","\\u0074itle":"b"}']) {
      expect(() => parseWriterDeclarations(`{"schema":"${WRITER_DECLARATIONS_SCHEMA}","locales":{"en":{"aliases":${aliases},"sections":[]}}}`)).toThrow(/\/aliases\/title: Repeated JSON object key/);
    }
    expect(() => parseWriterDeclarations(document({ en: empty() }).replace('"sections":[]', '"sections":[],"sections":[]'))).toThrow(/Repeated JSON object key/);
  });

  it.each(["__proto__", "constructor", "prototype"])("preserves own alias and metadata keys %s without prototype effects", key => {
    const metadata = JSON.parse(`{"${key}":{"polluted":true}}`);
    const aliases = JSON.parse(`{"${key}":"title-1"}`);
    const original = { aliases, sections: [], extra: [metadata], ...metadata };
    const parsed = parseWriterDeclarations(document({ en: original }, metadata));
    const selected = projectWriterDeclarations(parsed, "en", { completeRecords: [row("title-1")] });
    expect(selected).toEqual(original);
    expect(Object.hasOwn(selected.aliases, key)).toBe(true);
    expect(selected.aliases[key]).toBe("title-1");
    expect(Object.hasOwn(selected, key)).toBe(true);
    expect(Object.hasOwn(parsed, key)).toBe(true);
    expect(Object.getPrototypeOf(selected.aliases)).toBe(Object.prototype);
    expect(writerText({ ...selected, records: [{ id: "title-1", text: "Actual text" }] }).alias(key)).toBe("Actual text");
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("preserves parsed numeric metadata values when making the projection copy", () => {
    const parsed = parseWriterDeclarations(`{"schema":"${WRITER_DECLARATIONS_SCHEMA}","locales":{"en":{"aliases":{},"sections":[],"zero":-0,"large":1e400}}}`);
    const selected = projectWriterDeclarations(parsed, "en");
    expect(Object.is(selected.zero, -0)).toBe(true);
    expect(selected.large).toBe(parsed.locales.en!.large);
  });
});

describe("writing native Writer declarations", () => {
  const declared = () => parseWriterDeclarations(document({ en: { aliases: { "page.home.meta-title": "title-1" }, sections: [section()] } }));
  const consumer = () => { const dir = mkdtempSync(join(tmpdir(), "writer-declarations-")); mkdirSync(join(dir, "agents", "writer"), { recursive: true }); return dir; };

  it("serializes canonical bytes the one reader accepts unchanged", () => {
    const bytes = serializeWriterDeclarations(declared());
    expect(bytes.endsWith("}\n")).toBe(true);
    expect(parseWriterDeclarations(bytes)).toEqual(declared());
    expect(() => serializeWriterDeclarations({ schema: WRITER_DECLARATIONS_SCHEMA, locales: { en: { aliases: {}, sections: [{ sectionId: "s", configId: "", fields: [] }] } } } as never)).toThrow(WriterDeclarationsParseError);
  });

  it("writes agents/writer/declarations.json only when every target is a pinned record", async () => {
    const dir = consumer();
    try {
      await expect(writeWriterDeclarations(dir, declared(), { completeRecords: [row("other")] })).rejects.toThrow(/Missing record title-1/);
      const written = await writeWriterDeclarations(dir, declared(), { completeRecords: [row("title-1")] });
      expect(written.path).toBe(join(dir, "agents", "writer", "declarations.json"));
      expect(readText(written.path, "utf8")).toBe(serializeWriterDeclarations(declared()));
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("refuses a symbolic link in place of the declarations file", async () => {
    const dir = consumer();
    try {
      symlinkSync(join(dir, "elsewhere.json"), join(dir, "agents", "writer", "declarations.json"));
      await expect(writeWriterDeclarations(dir, declared())).rejects.toThrow(/symbolic link/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
