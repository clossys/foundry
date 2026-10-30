import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  pseudoLocalize, pseudoLocaleFields, resolveCopyRef, validateWriterRecord,
  type CopyRegistry, type WriterLayer, type WriterLibrary, type WriterRecord,
} from "../../index.js";
import { intlDirectionFor } from "../../locale.js";
import { parseIcuMessage } from "../../icu/parse.js";
import { writerTextFields } from "../../checks/length.js";
import { checkWriterLength } from "../../checks/length.js";
import { checkWriterICU } from "../../checks/icu.js";
import { checkWriterExpansion } from "../../checks/expansion.js";
import { checkWriterFreeze } from "../../checks/freeze.js";
import { checkWriterClosedWorld } from "../../checks/closed-world.js";
import { checkWriterPurity } from "../../checks/purity.js";
import { checkWriterCoverage } from "../../checks/coverage.js";
import { checkWriterApproval } from "../../checks/approval.js";
import { checkWriterLint } from "../../checks/lint/index.js";

const root = fileURLToPath(new URL(".", import.meta.url));
const opaqueId = /^(?:lx|st|pt|ps|nr)\.[0123456789abcdefghjkmnpqrstvwxyz]{10}$/;
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
interface Subject { file: string; locale: string; record: WriterRecord }
interface ExternalRecord { file: string; locale: string; recordId: string; source: string; sourceContext: string }
interface Finding {
  cell: string; severity: string; code: string; message: string;
  file?: string; locale?: string; recordId?: string; field?: string; path?: string;
}

function jsonFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? jsonFiles(path) : entry.isFile() && entry.name.endsWith(".json") ? [path] : [];
  }).sort();
}

/** Envelopes may nest; only opaque record objects are subjects, never aliases. */
function recordsIn(value: unknown, file: string, locale?: string): Subject[] {
  if (Array.isArray(value)) return value.flatMap(item => recordsIn(item, file, locale));
  if (!object(value)) return [];
  const tag = typeof value.locale === "string" ? value.locale : locale;
  if (typeof value.id === "string" && opaqueId.test(value.id) && typeof value.leaf === "string") {
    if (!tag) throw new Error(`${file}: recognized record ${value.id} has no locale envelope`);
    return [{ file, locale: tag, record: value as unknown as WriterRecord }];
  }
  return Object.entries(value).flatMap(([key, item]) => key === "locales" && object(item)
    ? Object.entries(item).flatMap(([localeTag, content]) => recordsIn(content, file, localeTag))
    : recordsIn(item, file, tag));
}

/** Shared-only sources still require explicit, resolvable native-locale records. */
function externalRecordsIn(value: unknown, file: string, locale?: string): ExternalRecord[] {
  if (Array.isArray(value)) return value.flatMap(item => externalRecordsIn(item, file, locale));
  if (!object(value)) return [];
  const tag = typeof value.locale === "string" ? value.locale : locale;
  const declarations: ExternalRecord[] = [];
  if (Object.hasOwn(value, "externalRecords")) {
    if (!tag || !Array.isArray(value.externalRecords)) throw new Error(`${file}: invalid external record envelope`);
    for (const row of value.externalRecords) {
      if (!object(row) || typeof row.recordId !== "string" || !opaqueId.test(row.recordId) ||
          typeof row.source !== "string" || !row.source || typeof row.sourceContext !== "string" || !row.sourceContext) {
        throw new Error(`${file}: invalid external record declaration`);
      }
      declarations.push({ file, locale: tag, recordId: row.recordId, source: row.source, sourceContext: row.sourceContext });
    }
  }
  return [...declarations, ...Object.entries(value).flatMap(([key, item]) => key === "externalRecords" ? []
    : key === "locales" && object(item)
      ? Object.entries(item).flatMap(([localeTag, content]) => externalRecordsIn(content, file, localeTag))
      : externalRecordsIn(item, file, tag))];
}

function bindingReferencesIn(value: unknown, locale?: string, binding = false): { locale: string; id: string }[] {
  if (binding && typeof value === "string" && opaqueId.test(value)) {
    if (!locale) throw new Error(`Binding ${value} has no native locale`);
    return [{ locale, id: value }];
  }
  if (Array.isArray(value)) return value.flatMap(item => bindingReferencesIn(item, locale, binding));
  if (!object(value)) return [];
  const tag = typeof value.locale === "string" ? value.locale : locale;
  return Object.entries(value).flatMap(([key, item]) => key === "locales" && object(item)
    ? Object.entries(item).flatMap(([localeTag, content]) => bindingReferencesIn(content, localeTag, binding))
    : bindingReferencesIn(item, tag, binding || key === "bindings"));
}

function validateSources(sources: Map<string, unknown>): Subject[] {
  const subjects = [...sources].flatMap(([file, value]) => recordsIn(value, file));
  for (const [file, value] of sources) {
    const local = subjects.filter(subject => subject.file === file);
    const external = externalRecordsIn(value, file);
    expect(local.length + external.length, `${file} must contain local records or explicit external records`).toBeGreaterThan(0);
    expect(new Set(external.map(row => `${row.locale}/${row.recordId}`)).size, `${file}: unique external declarations`).toBe(external.length);
    for (const declaration of external) {
      expect(sources.has(declaration.source), `${file}: discovered source ${declaration.source}`).toBe(true);
      expect(local.some(row => row.locale === declaration.locale && row.record.id === declaration.recordId), `${file}: external record must not shadow local record`).toBe(false);
      const targets = subjects.filter(row => row.file === declaration.source && row.locale === declaration.locale && row.record.id === declaration.recordId);
      expect(targets, `${file}: ${declaration.locale}/${declaration.recordId} must resolve in ${declaration.source}`).toHaveLength(1);
      expect(targets[0]!.record.context, `${file}: external source context`).toBe(declaration.sourceContext);
    }
    for (const reference of bindingReferencesIn(value)) {
      expect(local.some(row => row.locale === reference.locale && row.record.id === reference.id) ||
        external.some(row => row.locale === reference.locale && row.recordId === reference.id),
      `${file}: binding ${reference.locale}/${reference.id} must be local or explicitly declared`).toBe(true);
    }
  }
  return subjects;
}

function libraryFor(subjects: Subject[]): WriterLibrary {
  const locales: WriterLibrary["locales"] = {};
  for (const { locale, record, file } of subjects) {
    const content = locales[locale] ??= { records: [], documents: [], files: [] };
    content.records.push(record);
    let source = content.files!.find(row => row.path === file);
    if (!source) content.files!.push(source = { path: file, recordIds: [] });
    source.recordIds.push(record.id);
  }
  return {
    manifest: {
      consumer: "catalog-mechanical-test", messageSyntax: "icu-mf1", defaultLocale: "en",
      locales: Object.keys(locales).map(tag => {
        const dir = intlDirectionFor(tag);
        if (!dir) throw new Error(`No Intl direction for catalog locale ${tag}`);
        return { tag, dir, state: "active" };
      }),
      fallback: {}, strategy: { root: "synthetic/catalog-test", contract: "writer.messaging" },
      leafFreeze: { lexicon: "", strings: "", patterns: "", passages: "", narratives: "" },
    },
    locales,
  };
}

const checks = {
  lint: checkWriterLint, ICU: checkWriterICU, length: checkWriterLength,
  expansion: checkWriterExpansion, freeze: checkWriterFreeze, "closed-world": checkWriterClosedWorld,
  purity: checkWriterPurity, approval: checkWriterApproval,
};

describe("catalog mechanical audit (synthetic approval is never authored approval)", () => {
  it.each(["empty", "missing-source", "wrong-context", "wrong-locale", "undeclared-binding"])("rejects %s in a shared-only source", fault => {
    const record = { id: "st.0000000001", leaf: "strings.common", context: "shared.label" };
    const declaration = { recordId: record.id, source: "common.json", sourceContext: record.context };
    const shared = { locale: "en", records: [], externalRecords: [declaration], bindings: [{ recordId: record.id }] };
    if (fault === "empty") { shared.externalRecords = []; shared.bindings = []; }
    if (fault === "missing-source") declaration.source = "absent.json";
    if (fault === "wrong-context") declaration.sourceContext = "wrong.context";
    if (fault === "wrong-locale") shared.locale = "ar";
    if (fault === "undeclared-binding") shared.bindings[0]!.recordId = "st.0000000002";
    expect(() => validateSources(new Map<string, unknown>([
      ["common.json", { locale: "en", records: [record] }], ["shared.json", shared],
    ]))).toThrow();
  });

  it("preserves the legal revision text when its ICU part becomes a String reference", () => {
    const subjects = recordsIn(JSON.parse(readFileSync(join(root, "site.en.json"), "utf8")), "site.en.json");
    const library = libraryFor(subjects);
    const pattern = subjects.find(({ record }) => record.id === "pt.0000000030")!.record;
    const text = subjects.find(({ record }) => record.id === "st.0000000033")!.record;
    expect(pattern).toHaveProperty("parts.title.ref", { kind: "string", id: text.id });
    expect(text).toMatchObject({
      leaf: "strings.legal-lines", status: "draft", origin: "authored",
      text: "Updated {date, date, long}", args: [{ name: "date", type: "date" }],
    });
    expect(writerTextFields(library).find(field => field.recordId === pattern.id && field.field === "parts.title")?.text)
      .toBe("Updated {date, date, long}");
    expect(checkWriterICU(library)).toEqual([]);
  });

  it("does not mistake fallback resolution for native locale coverage", () => {
    // Entirely synthetic: this fixture supplies no approval to authored records.
    const record = {
      id: "st.0000000001", leaf: "strings.interface", context: "Fallback coverage fixture",
      text: "Fixture", status: "draft", origin: "authored",
    } satisfies WriterRecord;
    const library = libraryFor([{ file: "synthetic.json", locale: "en", record }]);
    library.manifest.locales.push({ tag: "fr", dir: "ltr", state: "active" });
    library.manifest.fallback.fr = ["en"];
    library.locales.fr = { records: [], documents: [] };
    const registry: CopyRegistry = {
      id: "fallback-mechanical-test", locale: "en", revision: "fixture-1",
      source: { kind: "generated", reference: "synthetic/fallback-test" },
      entries: [{ id: record.id, text: record.text, context: record.context, status: "approved" }],
    };
    const empty: CopyRegistry = { ...registry, locale: "fr", entries: [] };
    const result = resolveCopyRef(registry, { id: record.id, locale: "fr" }, {
      manifest: library.manifest, registries: [empty],
    });
    expect(result.issues).toEqual([]);
    expect(result.complete).toBe(true);
    expect(result.resolution).toMatchObject({ servedLocale: "en", chain: ["fr", "en"] });
    expect(checkWriterCoverage(library)).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "WR10", locale: "fr", recordId: record.id, field: "records" }),
    ]));
    expect(record.status).toBe("draft");
    expect(record).not.toHaveProperty("approval");
  });

  it("discovers every JSON source and compiles every text subject in all three preview locales", () => {
    const files = jsonFiles(root);
    const originals = new Map(files.map(file => [file, readFileSync(file, "utf8")]));
    const subjects = validateSources(new Map(files.map(file => [relative(root, file), JSON.parse(originals.get(file)!)])));
    expect(files.length).toBeGreaterThan(0);
    const library = libraryFor(subjects);
    const adminInventory = JSON.parse(readFileSync(new URL("../__fixtures__/admin-writer-source-inventory.json", import.meta.url), "utf8"));
    expect(adminInventory.adminCoverage).toBe(false);
    expect(adminInventory.findings.length).toBeGreaterThan(0);
    const snapshot = JSON.stringify(library);
    const findings: Finding[] = [];
    const compileErrors: Finding[] = [];
    const compiled: { file: string; sourceLocale: string; recordId: string; field: string; locale: string; samples: number }[] = [];
    const locate = (locale?: string, id?: string) => subjects.find(row => row.locale === locale && row.record.id === id)?.file;
    const shapeIssues = subjects.flatMap(({ record, file, locale }) =>
      validateWriterRecord(record, record.leaf.split(".")[0] as WriterLayer).map(issue => ({
        ...issue, cell: "shape", severity: "error", file, locale, recordId: record.id,
      })));
    findings.push(...shapeIssues);
    for (const [locale, content] of Object.entries(library.locales)) {
      expect(new Set(content.records.map(record => record.id)).size, `unique IDs in ${locale}`).toBe(content.records.length);
    }
    for (const [cell, check] of Object.entries(checks)) {
      findings.push(...check(library).map(finding => ({ ...finding, cell, file: locate(finding.locale, finding.recordId) })));
    }
    // Coverage follows each source file's native locale envelope. An English-only
    // site bundle does not promise Arabic merely because another bundle has it.
    for (const file of files.map(file => relative(root, file))) {
      findings.push(...checkWriterCoverage(libraryFor(subjects.filter(subject => subject.file === file)))
        .map(finding => ({ ...finding, cell: "coverage", file })));
    }
    // WR3 also reports missing external evidence/catalog schemas. Keep those Needs
    // distinct from actual broken local references, which must fail this proof.
    const brokenRefs = findings.filter(finding => finding.code === "WR3" &&
      (/^Reference .* (?:must resolve|targets a retired|must target)/.test(finding.message) || /^Pattern .* has no part /.test(finding.message)));
    const fields = writerTextFields(library);
    const passages = subjects.filter(({ record }) => "fields" in record);
    expect(passages.length).toBeGreaterThan(0);
    expect(fields.length).toBeGreaterThan(0);
    // Cross-check the public pseudo field pipeline against the literal primitive.
    for (const locale of ["en-XA", "ar-XB"] as const) {
      const preview = pseudoLocaleFields(library, locale);
      const english = fields.filter(field => field.locale === "en" && !field.externalLegal);
      expect(preview.fields.length).toBe(english.length);
      preview.fields.forEach((field, index) => expect(field.text).toBe(pseudoLocalize(english[index]!.text, locale)));
    }
    for (const field of fields) {
      const file = locate(field.locale, field.recordId)!;
      const source = parseIcuMessage(field.text);
      for (const locale of ["en", "en-XA", "ar-XB"] as const) {
        const failure = (code: string, message: string) => compileErrors.push({
          cell: "compile", severity: "error", code, message, file, locale,
          recordId: field.recordId, field: field.field,
        });
        try {
          const text = locale === "en" ? field.text : pseudoLocalize(field.text, locale);
          const parsed = parseIcuMessage(text);
          for (const issue of parsed.issues) failure(issue.code, issue.message);
          expect([...new Set(parsed.arguments.map(arg => arg.name))].sort()).toEqual([...new Set(source.arguments.map(arg => arg.name))].sort());
          const names = [...new Set(parsed.arguments.map(arg => arg.name))];
          // TEST ONLY projection: source records/status/approval are never changed.
          const registry: CopyRegistry = {
            id: "catalog-mechanical-test", locale, revision: "fixture-1",
            source: { kind: "generated", reference: "synthetic/catalog-mechanical-test" },
            entries: [{ id: field.recordId, text, context: "Mechanical field compilation fixture", status: "approved", placeholders: names }],
          };
          for (const sample of [0, 1, 2, 5]) {
            const values = Object.fromEntries(names.map(name => {
              const args = parsed.arguments.filter(arg => arg.name === name);
              // Writer CopyValue dates are numeric epoch milliseconds, not Date objects.
              const value = args.some(arg => arg.type === "date") ? Date.UTC(1970, 0, 1)
                : args.some(arg => arg.type === "number" || arg.type === "plural") ? sample : "other";
              return [name, value];
            }));
            expect(Object.keys(values).sort()).toEqual(names.slice().sort());
            const result = resolveCopyRef(registry, { id: field.recordId, locale, values });
            for (const issue of result.issues) failure(issue.reason, issue.message);
            if (!result.complete || !result.resolution) failure("incomplete", "Field resolution did not complete");
          }
          compiled.push({ file, sourceLocale: field.locale, recordId: field.recordId, field: field.field, locale, samples: 4 });
        } catch (error) { failure("exception", error instanceof Error ? error.message : String(error)); }
      }
    }
    // Every passage ref must have a field subject; WR3 cannot silently remove it.
    for (const { record, locale } of passages) {
      if (!("fields" in record)) continue;
      for (const [key, value] of Object.entries(record.fields)) {
        const count = Array.isArray(value) ? value.length : 1;
        expect(fields.filter(row => row.locale === locale && row.recordId === record.id &&
          (row.field === `fields.${key}` || row.field.startsWith(`fields.${key}[`))).length,
        `${locale}/${record.id}/${key}`).toBe(count);
      }
    }
    writeFileSync(fileURLToPath(new URL("../../../reports/mechanical-audit.json", import.meta.url)), JSON.stringify({
      scope: "Discovered JSON catalog records; mechanical harness, not admin coverage or approval",
      coverageScope: "Per JSON file and its native locale envelope; other checks and references use merged same-locale records",
      lexicon: {
        configuredRecords: subjects.filter(({ record }) => record.leaf.startsWith("lexicon.")).length,
        scope: "WR5 execution without active configured lexicon rules does not establish voice clearance",
      },
      files: files.map(file => relative(root, file)), records: subjects.length, passages: passages.length,
      textFields: fields.length, compiled, compileErrors, findings, brokenRefs,
      adminInventory,
      futureNarratives: "Markdown narratives require WR-NARR parsing, coverage and approval evidence before inclusion.",
    }, null, 2));
    expect(findings.filter(finding => finding.code === "WR8")).toEqual([]);
    expect(shapeIssues).toEqual([]);
    expect(brokenRefs).toEqual([]);
    expect(compileErrors).toEqual([]);
    expect(compiled.length).toBe(fields.length * 3);
    expect(JSON.stringify(library)).toBe(snapshot);
    for (const [file, source] of originals) expect(readFileSync(file, "utf8")).toBe(source);
  });
});
