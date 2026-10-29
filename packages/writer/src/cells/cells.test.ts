import { cp, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAdminCopy, type AdminCopyEnvelope } from "../admin-copy.js";
import { validateWriterRecord } from "../model/validate.js";
import { compileWriterCells } from "./compile.js";
import { resolveWriterCellRoot } from "./cli.js";
import { migrateWriterCells } from "./migrate.js";
import { parseWriterCell, serializeWriterCell } from "./parse.js";

type JsonObject = Record<string, any>;
const sourceRoot = fileURLToPath(new URL("../catalog/records/", import.meta.url));
const fixturePath = fileURLToPath(new URL("./__fixtures__/generic-envelope.json", import.meta.url));
const temporaryRoots: string[] = [];
const json = async (path: string): Promise<JsonObject> => JSON.parse(await readFile(path, "utf8"));
const canonical = (value: unknown): string => JSON.stringify(value, null, 2) + "\n";

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "writer-cells-test-"));
  temporaryRoots.push(root);
  return root;
}

async function cellBytes(root: string): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  for (const id of (await readdir(join(root, "cells"))).sort()) {
    for (const version of (await readdir(join(root, "cells", id))).sort()) {
      files[`cells/${id}/${version}`] = await readFile(join(root, "cells", id, version), "utf8");
    }
  }
  return files;
}

async function sourceFiles(root: string, prefix = ""): Promise<Record<string, JsonObject>> {
  const files: Record<string, JsonObject> = {};
  for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) Object.assign(files, await sourceFiles(root, path));
    else if (entry.isFile() && path.endsWith(".json")) files[path] = await json(join(root, path));
  }
  return files;
}

function countByLocale(files: Record<string, unknown>): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of Object.values(files) as JsonObject[]) {
    const locales = value.locales ?? (Array.isArray(value.records) ? { [value.locale]: value } : {});
    for (const [locale, envelope] of Object.entries(locales) as [string, JsonObject][]) {
      counts[locale] = (counts[locale] ?? 0) + envelope.records.length;
    }
  }
  return counts;
}

afterAll(async () => {
  await Promise.all(temporaryRoots.map(root => rm(root, { recursive: true, force: true })));
});

describe("repository-owned Writer cell root", () => {
  it("defaults to clossys/agents/writer from the repository root and nested application cwd", async () => {
    const repository = await temporaryRoot();
    await mkdir(join(repository, ".git"));
    const nested = join(repository, "apps", "example", "src");
    await mkdir(nested, { recursive: true });
    expect(resolveWriterCellRoot(repository)).toBe(join(repository, "clossys", "agents", "writer"));
    expect(resolveWriterCellRoot(nested)).toBe(join(repository, "clossys", "agents", "writer"));
  });

  it("recognizes a worktree .git file as a repository boundary", async () => {
    const repository = await temporaryRoot();
    await writeFile(join(repository, ".git"), "gitdir: synthetic-worktree-metadata\n");
    const nested = join(repository, "apps", "example");
    await mkdir(nested, { recursive: true });
    expect(resolveWriterCellRoot(nested)).toBe(join(repository, "clossys", "agents", "writer"));
  });

  it("honors an explicit root override relative to cwd or as an absolute path", async () => {
    const repository = await temporaryRoot();
    await mkdir(join(repository, ".git"));
    const nested = join(repository, "apps", "example");
    await mkdir(nested, { recursive: true });
    expect(resolveWriterCellRoot(nested, "authored-copy")).toBe(join(nested, "authored-copy"));
    const override = join(repository, "custom", "copy");
    expect(resolveWriterCellRoot(nested, override)).toBe(override);
  });

  it("uses the working directory as the root context when no repository exists", async () => {
    const directory = await temporaryRoot();
    expect(resolveWriterCellRoot(directory)).toBe(join(directory, "clossys", "agents", "writer"));
  });
});

describe("Writer section cells against the pinned source inventory", () => {
  let root: string;
  let originals: Record<string, JsonObject>;
  beforeAll(async () => {
    root = await temporaryRoot();
    originals = await sourceFiles(sourceRoot);
    await migrateWriterCells(sourceRoot, root, { date: "2026-10-29" });
  });

  it("reproduces every source, preserving metadata, external records, bindings and content", async () => {
    const result = await compileWriterCells(root);
    expect(result.files).toEqual(originals);
    expect(Object.keys(originals)).toHaveLength(12);
    expect(countByLocale(originals)).toEqual({ en: 1429, ar: 38 });
    expect(countByLocale(result.files)).toEqual(countByLocale(originals));
    expect(result.recordCount).toBe(1467);
  });

  it("preserves the nested pending envelope at its original relative output path", async () => {
    const output = await temporaryRoot();
    const path = "pending/sections-upgrade.r1.en.json";
    const result = await compileWriterCells(root, output);
    expect(originals[path]!.records).toHaveLength(7);
    expect(result.files[path]).toEqual(originals[path]);
    expect(await json(join(output, path))).toEqual(originals[path]);
    expect(result.files).not.toHaveProperty("sections-upgrade.r1.en.json");
    await expect(compileWriterCells(root, output, { check: true })).resolves.toMatchObject({ recordCount: 1467 });
  });

  it("round-trips sign-in English and Arabic records, passage skeletons and locale metadata", async () => {
    const result = await compileWriterCells(root);
    const output = result.files["sign-in.json"] as JsonObject;
    expect(output).toEqual(originals["sign-in.json"]);
    expect(Object.keys(output.locales)).toEqual(["en", "ar"]);
    for (const locale of ["en", "ar"]) {
      expect(output.locales[locale].records).toHaveLength(38);
      expect(output.locales[locale].records.filter((record: JsonObject) => !("text" in record))).toHaveLength(3);
      expect(Array.isArray(output.locales[locale].bindings)).toBe(false);
      expect(Object.keys(output.locales[locale].bindings)).toHaveLength(3);
    }
    expect(output.locales.ar.legacyRecords).toHaveLength(3);
    expect(Object.keys(output.locales.ar.legacyBindings)).toHaveLength(3);
  });

  it("preserves admin Studio record and binding order rather than sorting opaque ids", async () => {
    const original = originals["admin-studio.r1.en.json"]!;
    const sortedIds = original.records.map((record: JsonObject) => record.id).sort();
    const originalIds = original.records.map((record: JsonObject) => record.id);
    expect(originalIds).not.toEqual(sortedIds);
    const output = (await compileWriterCells(root)).files["admin-studio.r1.en.json"] as JsonObject;
    expect(output.records.map((record: JsonObject) => record.id)).toEqual(originalIds);
    expect(output.bindings).toEqual(original.bindings);
  });

  it("keeps the admin runtime createAdminCopy projection equal after compilation", async () => {
    const files = (await compileWriterCells(root)).files;
    const project = (sources: Record<string, unknown>) => {
      const names = ["admin-studio.r1.en.json", "admin-voice.r1.en.json", "admin-meta.r1.en.json", "admin-chat.r1.en.json", "common-labels.r1.en.json"];
      const envelopes = names.map(name => sources[name]) as AdminCopyEnvelope[];
      const writer = sources["admin-writer.r1.en.json"] as JsonObject;
      const paging = sources["admin-writer-paging.r1.en.json"] as JsonObject;
      envelopes.splice(3, 0, { ...writer, records: [...writer.records, ...paging.records], bindings: [...writer.bindings, ...paging.bindings] } as AdminCopyEnvelope);
      return createAdminCopy(envelopes);
    };
    expect(project(files)).toEqual(project(originals));
  });

  it("uses flat permanent section ids with multiple records per cell and all locales together", async () => {
    const bytes = await cellBytes(root);
    const paths = Object.keys(bytes);
    expect(paths.length).toBeGreaterThan(0);
    expect(paths.length).toBeLessThan(150);
    const cells = paths.map(path => {
      expect(path).toMatch(/^cells\/[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*\/v1\.md$/);
      return parseWriterCell(bytes[path]!, path);
    });
    expect(cells.every(cell => cell.records.length >= 1)).toBe(true);
    expect(cells.some(cell => cell.records.length > 1)).toBe(true);
    expect(cells.some(cell => cell.locales.includes("en") && cell.locales.includes("ar"))).toBe(true);
    for (const cell of cells) {
      expect(cell.status).toBe("active");
      expect(cell.confirmed).toBe("migration:2026-10-29");
      expect(cell.links).toEqual([]);
    }
  });

  it("regroups using tree.json alone while preserving all cell bytes and compiled content", async () => {
    const regrouped = await temporaryRoot();
    await cp(root, regrouped, { recursive: true });
    const beforeBytes = await cellBytes(regrouped);
    const before = await compileWriterCells(regrouped);
    const tree = await json(join(regrouped, "tree.json"));
    const ids = Object.keys(tree.active).reverse();
    tree.tree = [{ id: "reorganized", name: "Reorganized", children: [{ id: "reorganized.copy", name: "Copy", cells: ids }] }];
    await writeFile(join(regrouped, "tree.json"), canonical(tree));
    const after = await compileWriterCells(regrouped);
    expect(after.files).toEqual(before.files);
    expect(await cellBytes(regrouped)).toEqual(beforeBytes);
  });

  it("compiles only active pointers while newer draft versions remain invisible", async () => {
    const draftRoot = await temporaryRoot();
    await cp(root, draftRoot, { recursive: true });
    const before = await compileWriterCells(draftRoot);
    const tree = await json(join(draftRoot, "tree.json"));
    const id = Object.keys(tree.active).find(id => tree.active[id] !== null)!;
    const active = tree.active[id];
    const draft = parseWriterCell(await readFile(join(draftRoot, "cells", id, `v${active}.md`), "utf8"));
    draft.version = active + 1;
    draft.status = "draft";
    delete draft.confirmed;
    const string = draft.records.find(row => typeof row.record.text === "string");
    expect(string).toBeDefined();
    string!.record.text = "An unpublished replacement from a newer draft";
    await writeFile(join(draftRoot, "cells", id, `v${draft.version}.md`), serializeWriterCell(draft));
    const after = await compileWriterCells(draftRoot);
    expect(after.files).toEqual(before.files);
    expect(await json(join(draftRoot, "tree.json"))).toEqual(tree);
  });

  it("check detects a hand-edited generated record file without rewriting it", async () => {
    const output = await temporaryRoot();
    await compileWriterCells(root, output);
    await expect(compileWriterCells(root, output, { check: true })).resolves.toBeDefined();
    const path = join(output, "admin-studio.r1.en.json");
    const edited = await json(path);
    edited.records[0].text = "Hand-edited output drift";
    const bytes = canonical(edited);
    await writeFile(path, bytes);
    await expect(compileWriterCells(root, output, { check: true })).rejects.toThrow(/drift|differ|mismatch/i);
    expect(await readFile(path, "utf8")).toBe(bytes);
  });
});

describe("generic record grammar and metadata round-trip", () => {
  it("rejects absolute and traversal paths in generated manifest entries", async () => {
    const root = await temporaryRoot();
    const output = await temporaryRoot();
    await migrateWriterCells(fixturePath, root, { date: "2026-10-29" });
    const manifest = await json(join(root, "compile.json"));
    for (const path of ["../outside.json", "/outside.json", "pending/../outside.json", "C:\\outside.json", "C:/outside.json"]) {
      manifest.files[0].path = path;
      await writeFile(join(root, "compile.json"), canonical(manifest));
      await expect(compileWriterCells(root, output)).rejects.toThrow(/path|escape/i);
    }
    manifest.files[0].path = "generic-envelope.json";
    manifest.passthrough.push({ path: "../metadata.json", value: {} });
    await writeFile(join(root, "compile.json"), canonical(manifest));
    await expect(compileWriterCells(root, output)).rejects.toThrow(/path|escape/i);
    expect(await readdir(output)).toEqual([]);
  });

  it("refuses directory and file source symlinks instead of importing outside content", async () => {
    for (const kind of ["directory", "file"]) {
      const from = await temporaryRoot();
      const outside = await temporaryRoot();
      await cp(fixturePath, join(outside, "outside.json"));
      await symlink(kind === "directory" ? outside : join(outside, "outside.json"), join(from, kind === "directory" ? "nested" : "linked.json"));
      const root = await temporaryRoot();
      await expect(migrateWriterCells(from, root)).rejects.toThrow(/symlink/i);
      expect(await readdir(root)).toEqual([]);
    }
  });

  it("refuses an output directory symlink that redirects a nested source outside the destination", async () => {
    const from = await temporaryRoot();
    await mkdir(join(from, "pending"));
    await cp(fixturePath, join(from, "pending", "envelope.json"));
    const root = await temporaryRoot();
    await migrateWriterCells(from, root);
    const output = await temporaryRoot();
    const outside = await temporaryRoot();
    await symlink(outside, join(output, "pending"));
    await expect(compileWriterCells(root, output)).rejects.toThrow(/symlink/i);
    await expect(compileWriterCells(root, output, { check: true })).rejects.toThrow(/symlink/i);
    expect(await readdir(outside)).toEqual([]);
  });

  it("writes a newly authored section record and its bindings to each mapped envelope", async () => {
    const from = await temporaryRoot();
    const root = await temporaryRoot();
    const record = { id: "st.0000000001", leaf: "strings.actions", context: "sample.auth.action", status: "draft", origin: "foundry-default", text: "Continue" };
    const envelope = { locale: "en", records: [record], bindings: [] };
    for (const name of ["first.json", "second.json"]) await writeFile(join(from, name), canonical(envelope));
    await migrateWriterCells(from, root, { date: "2026-10-29" });
    const path = join(root, "cells", "sample.auth", "v1.md");
    const cell = parseWriterCell(await readFile(path, "utf8"));
    cell.records.push({ locale: "en", record: { ...record, id: "st.0000000002", context: "sample.auth.cancel", text: "Cancel" }, bindings: [{ target: "actions.cancel", kind: "CopyRef" }] });
    await writeFile(path, serializeWriterCell(cell));
    await expect(compileWriterCells(root)).rejects.toThrow(/--write/);
    const result = await compileWriterCells(root, undefined, { write: true });
    for (const name of ["first.json", "second.json"]) {
      const output = result.files[name] as JsonObject;
      expect(output.records.map((row: JsonObject) => row.id)).toEqual(["st.0000000001", "st.0000000002"]);
      expect(output.bindings).toEqual([{ recordId: "st.0000000002", target: "actions.cancel", kind: "CopyRef" }]);
    }
    expect((await compileWriterCells(root)).files).toEqual(result.files);
  });

  it("preserves a mixed Admin-shaped directory, including IA, config and provenance passthrough", async () => {
    const from = await temporaryRoot();
    const root = await temporaryRoot();
    const envelope = await json(fixturePath);
    const extra = {
      "consumer-pages.config.json": { routes: ["/example"], locale: "en" },
      "source.json": { repository: "example", head: "fixture", files: [{ file: "example.r1.en.json", sha256: "0".repeat(64) }] },
      "writer-ia.source.json": { commit: "fixture", files: [{ file: "writer-ia.strings.json", sha256: "1".repeat(64) }] },
      ...Object.fromEntries(["lexicon", "narratives", "passages", "patterns", "strings"].map(layer => [`writer-ia.${layer}.json`, [{ id: `${layer}.example`, label: "Example", children: [] }]])),
    };
    const names = ["admin-chat.r1.en.json", "admin-meta.r1.en.json", "admin-pages.r1.en.json", "admin-studio.r1.en.json", "admin-voice.r1.en.json", "admin-writer-paging.r1.en.json", "admin-writer.r1.en.json", "common-labels.r1.en.json"];
    const originals = {
      ...Object.fromEntries(names.map(name => [name, envelope])),
      "admin-pages.r1.ar.json": { ...envelope, locale: "ar", direction: "rtl" },
      "sign-in.json": { version: 1, locales: { en: { records: envelope.records, bindings: {} }, ar: { records: envelope.records, bindings: {} } } },
      ...extra,
    };
    expect(Object.keys(originals)).toHaveLength(18);
    for (const [name, value] of Object.entries(originals)) await writeFile(join(from, name), canonical(value));
    await migrateWriterCells(from, root, { date: "2026-10-29" });
    expect((await compileWriterCells(root)).files).toEqual(originals);
    const manifest = await json(join(root, "compile.json"));
    expect(manifest.passthrough.map((file: JsonObject) => file.path).sort()).toEqual(Object.keys(extra).sort());
  });

  it("preserves consumer envelope source identities, aliases, external owners and binding targets", async () => {
    // Generic data follows the native admin prepareAdminPageCopyEnvelopes
    // boundary; it contains no private product copy or approval evidence.
    const from = fileURLToPath(new URL("./__fixtures__/generic-admin/", import.meta.url));
    const root = await temporaryRoot();
    const originals: Record<string, JsonObject> = {};
    for (const file of await readdir(from)) originals[file] = await json(join(from, file));
    await migrateWriterCells(from, root, { date: "2026-10-29" });
    const output = (await compileWriterCells(root)).files as Record<string, JsonObject>;
    expect(output).toEqual(originals);
    for (const envelope of Object.values(output)) {
      expect(envelope.state).toBe("draft");
      expect(envelope.activation).toBe("none");
      for (const record of envelope.records) {
        expect(validateWriterRecord(record, "strings")).toEqual([]);
        expect(record).not.toHaveProperty("approval");
      }
      for (const external of envelope.externalRecords) {
        const owner = output[external.source]!;
        expect(owner.records.find((record: JsonObject) => record.id === external.recordId)).toMatchObject({ context: external.sourceContext });
      }
    }
    const page = output["example-page.r1.en.json"]!;
    expect(page.aliases["strings.example.page.cancel"]).toBe("st.0000000003");
    expect(page.bindings.find((binding: JsonObject) => binding.recordId === "st.0000000003")).toMatchObject({ target: "page.actions.cancel", kind: "CopyRef" });
  });

  it("preserves escaped headings, comments, backslashes, multiline ICU and textless passages", async () => {
    const root = await temporaryRoot();
    const original = await json(fixturePath);
    await migrateWriterCells(fixturePath, root, { date: "2026-10-29" });
    const files = await cellBytes(root);
    expect(Object.keys(files)).toEqual(["cells/sample.auth/v1.md"]);
    const source = files["cells/sample.auth/v1.md"]!;
    expect(source).toContain("\n\\# A heading\n");
    expect(source).toContain("\n\\<!-- literal comment\n");
    expect(source).toContain("\n\\\\literal slash\n");
    expect(source).toContain("```json");
    const parsed = parseWriterCell(source, "cells/sample.auth/v1.md");
    expect(parsed.records.find(row => row.record.id === "st.0000000002")!.record).toEqual(original.records[0]);
    const passage = parsed.records.find(row => row.record.id === "ps.0000000001")!.record;
    expect(passage).toEqual(original.records[2]);
    expect(passage).not.toHaveProperty("text");
    expect(parseWriterCell(serializeWriterCell(parsed)).records).toEqual(parsed.records);
    const compiled = await compileWriterCells(root);
    expect(compiled.files["generic-envelope.json"]).toEqual(original);
  });

  const document = [
    "---", "id: sample.auth", "version: 1", "status: draft", "updated: 2026-10-29", "links: []", "locales: [en]", "---", "", "## en", "### sample.auth.title",
    '<!-- {"id":"st.0000000001","leaf":"strings.page-titles","status":"draft","origin":"foundry-default","bindings":[]} -->',
    "A generic heading", "",
  ].join("\n");

  it("reads record text and metadata from authored Markdown independently of serialization", () => {
    const parsed = parseWriterCell(document, "cells/sample.auth/v1.md");
    expect(parsed.id).toBe("sample.auth");
    expect(parsed.records).toEqual([{ locale: "en", record: { id: "st.0000000001", leaf: "strings.page-titles", status: "draft", origin: "foundry-default", context: "sample.auth.title", text: "A generic heading" }, bindings: [] }]);
  });

  it("rejects a frontmatter id that disagrees with its permanent path", () => {
    expect(() => parseWriterCell(document, "cells/sample.other/v1.md")).toThrow(/id|path/i);
  });

  it("rejects a frontmatter version that disagrees with its path", () => {
    expect(() => parseWriterCell(document, "cells/sample.auth/v2.md")).toThrow(/version|path/i);
  });

  it("rejects grouping segments inside Writer cell ids", () => {
    expect(() => parseWriterCell(document.replace("id: sample.auth", "id: sample.group.auth"))).toThrow(/id/i);
  });

  it("rejects unknown frontmatter keys instead of silently losing authored data", () => {
    expect(() => parseWriterCell(document.replace("links: []", "links: []\nunknown: value"))).toThrow(/unknown|key|field/i);
  });

  it("rejects locale sections absent from the declared locale profile", () => {
    expect(() => parseWriterCell(document.replace("## en", "## ar"))).toThrow(/locale|section/i);
  });
});
