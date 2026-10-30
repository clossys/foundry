import { afterEach, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkContentMap, projectPageBody } from "./index.js";
import type { ContentMap, ContentMapPageBody, ContentMapProjectedBody } from "./index.js";
import { compileContentMaps, contentMapFromCells, contentMapToCells } from "./cells.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
const body = (): ContentMapPageBody => ({
  template: "ia-scroll",
  bands: { L0: "sections.section-header", L1: "sections.section-header", L2: "sections.data-table" },
  row: { columns: ["title", "specimen", "status", "version", "usedBy", "linkOut"] },
});
const map = (declaration: ContentMapPageBody = body()): ContentMap => ({
  version: 1, publicationId: "body-example", format: "web.page.responsive",
  entries: [{ id: "designer", kind: "page", title: "Designer", path: "/designer", order: 0, source: { planItemId: "designer" }, body: declaration }],
});

it("projects distinct per-cell specimen bindings from one unresolved page body", () => {
  const source = map(), before = structuredClone(source);
  expect(checkContentMap(source)).toEqual([]);
  const token: ContentMapProjectedBody = projectPageBody(source, "designer", "sections.specimen-token");
  expect(token).toEqual({ ...body(), row: { specimen: "sections.specimen-token", columns: body().row.columns } });
  expect(projectPageBody(source, "designer", "sections.specimen-component").row.specimen).toBe("sections.specimen-component");
  expect(Object.keys(token)).toEqual(["template", "bands", "row"]);
  expect(source).toEqual(before);
  expect(token.bands).not.toBe(source.entries[0]!.body!.bands);
  expect(token.row.columns).not.toBe(source.entries[0]!.body!.row.columns);
});

it("accepts an explicit authored binding and requires agreement with a supplied binding", () => {
  const declaration = body(), source = map({ ...declaration, row: { ...declaration.row, specimen: "sections.specimen-token" } });
  expect(projectPageBody(source, "designer").row.specimen).toBe("sections.specimen-token");
  expect(projectPageBody(source, "designer", "sections.specimen-token")).toEqual(projectPageBody(source, "designer"));
  expect(() => projectPageBody(source, "designer", "sections.specimen-component")).toThrow(/disagrees/);
});

it.each([undefined, "", "sections.data-table", "sections.specimen-", "sections.specimen-Token", "sections.specimen-token/other", " sections.specimen-token"])("refuses missing or invalid per-cell binding %s", specimen => {
  expect(() => projectPageBody(map(), "designer", specimen)).toThrow(/bound sections\.specimen/);
});

it("keeps body optional for legacy maps and refuses projection without an existing page body", () => {
  const { body: _body, ...entry } = map().entries[0]!;
  const legacy: ContentMap = { ...map(), entries: [entry] };
  expect(checkContentMap(legacy)).toEqual([]);
  expect(() => projectPageBody(legacy, "designer", "sections.specimen-token")).toThrow(/body is missing/);
  expect(() => projectPageBody(map(), "missing", "sections.specimen-token")).toThrow(/page is missing/);
  expect(() => projectPageBody({ ...legacy, entries: [{ ...entry, kind: "group" }] }, "designer", "sections.specimen-token")).toThrow(/page is missing/);
});

it.each([
  null,
  { ...body(), template: "other" },
  { ...body(), extra: true },
  { ...body(), bands: { ...body().bands, L2: "sections.section-header" } },
  { ...body(), bands: { ...body().bands, L3: "sections.specimen-token" } },
  { ...body(), bands: { L0: "sections.section-header", L1: "sections.section-header" } },
  { ...body(), row: { ...body().row, specimen: null } },
  { ...body(), row: { ...body().row, specimen: "sections.data-table" } },
  { ...body(), row: { ...body().row, extra: true } },
  { ...body(), row: { columns: ["specimen", "title", "status", "version", "usedBy", "linkOut"] } },
  { ...body(), row: { columns: [...body().row.columns, "extra"] } },
  { ...body(), row: {} },
])("refuses malformed or open page body %#", declaration => {
  const source = map(declaration as ContentMapPageBody);
  expect(checkContentMap(source)).toContainEqual(expect.objectContaining({ code: "contract", path: "entries.0.body" }));
  expect(() => projectPageBody(source, "designer", "sections.specimen-token")).toThrow(/refused/);
});

it.each(["group", "section", "slide", "external"])("refuses body on non-page kind %s", kind => {
  const source = { ...map(), entries: [{ ...map().entries[0], kind }] };
  expect(checkContentMap(source)).toContainEqual(expect.objectContaining({ code: "contract", path: "entries.0.body" }));
});

it("round-trips the authoritative Body block between Actions and Route and preserves unresolved ports", async () => {
  const root = await mkdtemp(join(tmpdir(), "publisher-body-")); roots.push(root);
  const source: ContentMap = { ...map(), entries: map().entries.map(entry => ({ ...entry, actions: [{ id: "open", label: "Open", icon: "assets.icon-open", intent: "open", defaultOpen: false }] })) };
  await contentMapToCells(source, root, { date: "2026-10-30", routePack: { packId: source.publicationId, routes: [{ instanceId: "designer", path: "/designer", label: "Designer", channel: "app" }] } });
  const file = join(root, "cells/page.designer/v1.md"), authored = await readFile(file, "utf8");
  expect(authored.indexOf("## Actions")).toBeLessThan(authored.indexOf("## Body"));
  expect(authored.indexOf("## Body")).toBeLessThan(authored.indexOf("## Route"));
  expect(await contentMapFromCells(root, source.publicationId)).toEqual(source);
  const resolved = { ...body(), row: { ...body().row, specimen: "sections.specimen-token" } };
  await writeFile(file, authored.replace(JSON.stringify(body(), null, 2), JSON.stringify(resolved, null, 2)));
  expect(projectPageBody(await contentMapFromCells(root, source.publicationId), "designer").row.specimen).toBe("sections.specimen-token");
  const output = join(root, "content-map", `${source.publicationId}.json`), before = await readFile(output, "utf8");
  await writeFile(file, authored.replace('"ia-scroll"', '"invalid"'));
  await expect(compileContentMaps(root)).rejects.toThrow(/body/);
  expect(await readFile(output, "utf8")).toBe(before);
  await writeFile(file, authored.replace(/\n## Body\n```json\n[\s\S]*?\n```\n/, "") + `\n## Body\n\`\`\`json\n${JSON.stringify(body())}\n\`\`\`\n`);
  await expect(contentMapFromCells(root, source.publicationId)).rejects.toThrow(/ordered/);
});

it.each(["null", "{}"])("refuses malformed fenced Body %s", async declaration => {
  const root = await mkdtemp(join(tmpdir(), "publisher-body-")); roots.push(root);
  await contentMapToCells(map(), root, { date: "2026-10-30" });
  const file = join(root, "cells/page.designer/v1.md"), authored = await readFile(file, "utf8");
  await writeFile(file, authored.replace(JSON.stringify(body(), null, 2), declaration));
  await expect(contentMapFromCells(root, "body-example")).rejects.toThrow(/body/);
});
