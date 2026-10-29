import { afterEach, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { applyLibraryChange, libraryHash } from "../../../designer/src/catalog-core/api.js";
import { syntheticSource } from "../../../designer/src/catalog-core/__fixtures__/component-engine/synthetic.js";
import { componentIntegration } from "../../../designer/src/catalog-core/__fixtures__/component-integration.js";
import { libraryFiles } from "../../../designer/src/library-cli/fs-library.js";
import { libraryToCells } from "../../../designer/src/library-cli/cells.js";
import { migrateWriterCells } from "../../../writer/src/cells/migrate.js";
import { contentMapToCells } from "../content-map/cells.js";
import type { ContentMap } from "../content-map/contract.js";
import { emitAppLocal, parseAppLocalJson, parseGeneratedText, verifyAppLocal, writeAppLocal, generatedText } from "./index.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
const hash = (body: string) => createHash("sha256").update(body).digest("hex");
async function put(root: string, path: string, body: string) { await mkdir(dirname(join(root, path)), { recursive: true }); await writeFile(join(root, path), body); }
async function snapshot(root: string): Promise<Record<string, { hash: string; mtime: number }>> {
  const result: Record<string, { hash: string; mtime: number }> = {};
  async function walk(path: string) { for (const entry of await readdir(join(root, path), { withFileTypes: true })) {
    const name = path ? `${path}/${entry.name}` : entry.name;
    if (entry.isDirectory()) await walk(name);
    else result[name] = { hash: hash(await readFile(join(root, name), "utf8")), mtime: (await stat(join(root, name))).mtimeMs };
  } }
  await walk(""); return result;
}
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "publisher-app-local-")); roots.push(root);
  const input = componentIntegration(true), selected = syntheticSource();
  input.library = applyLibraryChange(input.catalog, input.library, { baseHash: libraryHash(input.library), changes: [{ portion: "components", change: { op: "adopt", slot: "components.button", source: "test-kit" } }], bundles: [{ slot: selected.candidate.slot, descriptorHash: selected.descriptorHash, upstream: [selected.upstream], files: [selected.file, selected.notice], transform: selected.candidate.transform!, blockers: [] }] });
  const library = join(root, "library");
  for (const [path, source] of libraryFiles(input.catalog, input.library, [], input.componentOptions)) await put(library, path, source);
  await libraryToCells(library, join(root, "clossys/agents/designer"), { catalog: input.catalog, componentOptions: input.componentOptions, date: "2026-10-29" });
  const map: ContentMap = { version: 1, publicationId: "example", format: "web.page.responsive", entries: [{ id: "home", title: "Home", path: "/", kind: "page", order: 0, pin: { nav: true }, source: { frameId: "frames.site-shell", sectionIds: [] } }] };
  await contentMapToCells(map, join(root, "clossys/agents/publisher"), { date: "2026-10-29" });
  const writerInput = join(root, "writer-input");
  await mkdir(writerInput);
  await cp(fileURLToPath(new URL("../../../writer/src/cells/__fixtures__/generic-envelope.json", import.meta.url)), join(writerInput, "copy.json"));
  await migrateWriterCells(writerInput, join(root, "clossys/agents/writer"), { date: "2026-10-29" });
  await put(root, "apps/web/package.json", JSON.stringify({ private: true, dependencies: { "react-aria-components": "1.21.1", react: "19.3.0" } }));
  return { root, catalog: input.catalog, target: { app: "apps/web", publication: "example", format: "web.page.responsive" as const } };
}
it("emits real selected source, active copy, theme and publication data entirely in memory", async () => {
  const options = await fixture(), before = await snapshot(options.root);
  const emitted = await emitAppLocal(options);
  expect(await snapshot(options.root)).toEqual(before);
  for (const name of ["theme.css", "copy/en.ts", "routes.ts", "nav.ts", "dependencies.json", ".manifest.json"]) expect(emitted.files[name], name).toBeTypeOf("string");
  expect(Object.keys(emitted.files)).toContain("components/button/button.tsx");
  expect(parseGeneratedText(emitted.files["components/button/button.tsx"]!).body).toContain('from "react-aria-components"');
  expect(parseGeneratedText(emitted.files["copy/en.ts"]!).body).toContain("Continue");
  expect(parseGeneratedText(emitted.files["theme.css"]!).body).toContain("--");
  expect(parseAppLocalJson(emitted.files["dependencies.json"]!)).toMatchObject({ "react-aria-components": "1.21.1" });
  for (const body of Object.values(emitted.files)) expect(body).not.toContain("@clossys/");
  const manifest = parseAppLocalJson(emitted.files[".manifest.json"]!) as Record<string, string>;
  expect(Object.keys(manifest).sort()).toEqual(Object.keys(emitted.files).filter(path => path !== ".manifest.json").sort());
  for (const [path, source] of Object.entries(emitted.files)) {
    expect(source).toMatch(/^\/\* generated by clossys publish; do not edit\nclossys-digest: sha256:[a-f0-9]{64}\n\*\/\n/);
    const parsed = parseGeneratedText(source); expect(parsed.digest).toBe(hash(parsed.body));
    if (path !== ".manifest.json") expect(manifest[path]).toBe(hash(source));
  }
});
it("uses active cells instead of stale compiled output and ignores later draft versions", async () => {
  const options = await fixture();
  const file = join(options.root, "clossys/agents/publisher/cells/page.home/v1.md");
  const source = await readFile(file, "utf8");
  await writeFile(file, source.replace("title: Home", "title: Current home"));
  await writeFile(file.replace("v1.md", "v2.md"), source.replace("version: 1", "version: 2").replace("status: active", "status: draft").replace(/^confirmed:.*\n/m, "").replace("title: Home", "title: Draft home"));
  const emitted = await emitAppLocal(options);
  expect(emitted.files["routes.ts"]).toContain("Current home"); expect(emitted.files["routes.ts"]).not.toContain("Draft home");
});
it("classifies missing, stale, hand edits, extra and first-party imports without changing hashes or mtimes", async () => {
  const options = await fixture(), expected = await emitAppLocal(options), directory = expected.outDir;
  await writeAppLocal(directory, expected);
  expect(await verifyAppLocal(directory, expected)).toEqual([]);
  await rm(join(directory, "theme.css"));
  await writeFile(join(directory, "routes.ts"), generatedText("export const routes = [];\n"));
  await writeFile(join(directory, "nav.ts"), expected.files["nav.ts"]! + "// manual edit\n");
  await writeFile(join(directory, "extra.ts"), generatedText("export {};\n"));
  await writeFile(join(directory, "toString"), generatedText("export {};\n"));
  await writeFile(join(directory, "copy/en.ts"), expected.files["copy/en.ts"]! + 'import "@clossys/writer";\n');
  const before = await snapshot(options.root), findings = await verifyAppLocal(directory, expected);
  expect(await snapshot(options.root)).toEqual(before);
  expect(findings).toEqual(expect.arrayContaining([
    expect.objectContaining({ kind: "missing", path: "theme.css" }), expect.objectContaining({ kind: "stale", path: "routes.ts" }),
    expect.objectContaining({ kind: "hand-edit", path: "nav.ts" }), expect.objectContaining({ kind: "extra", path: "extra.ts" }),
    expect.objectContaining({ kind: "clossys-import", path: "copy/en.ts" }), expect.objectContaining({ kind: "extra", path: "toString" }),
  ]));
});
it("refuses target/output traversal before writing and detects first-party app dependencies", async () => {
  const options = await fixture();
  await expect(emitAppLocal({ ...options, target: { ...options.target, app: "../outside" } })).rejects.toThrow();
  await expect(emitAppLocal({ ...options, outDir: "../outside" })).rejects.toThrow();
  const expected = await emitAppLocal(options); await writeAppLocal(expected.outDir, expected);
  await put(options.root, "apps/web/package.json", JSON.stringify({ dependencies: { "@clossys/writer": "0.6.0" } }));
  expect(await verifyAppLocal(expected.outDir, expected)).toContainEqual(expect.objectContaining({ kind: "clossys-import" }));
});
