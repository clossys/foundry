// @vitest-environment node
import * as fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join, posix } from "node:path";
import { tmpdir } from "node:os";
import ts from "typescript";
import { afterEach, describe, expect, it, vi } from "vitest";
import { collectSourceClosure, readActiveSourceLibrary, type SourceModule, type SourceImport, type SourceRequest } from "./source-closure.js";
import type { CompositeLibraryData } from "../catalog-core/types.js";
import { loadCatalog } from "../catalog-core/index.js";
import { adoptedComponentIntegration } from "../catalog-core/__fixtures__/component-integration.js";
import { propose } from "@clossys/strategist/cell-format";
import { libraryToCells } from "../library-cli/cells.js";
import { libraryFiles, readLibrary } from "../library-cli/fs-library.js";

vi.mock("node:fs/promises", { spy: true });

const hash = (content: string) => createHash("sha256").update(content).digest("hex");
function library(content = 'import { label } from "../_parts/label.js"; export const Button = () => label;'): CompositeLibraryData {
  const files = [
    { path: "components/button/Button.ts", content },
    { path: "components/_parts/label.ts", content: 'import { text } from "../../adapters/text.js"; export const label = text;' },
    { path: "adapters/text.ts", content: 'export { text } from "example-text";' },
    { path: "notices/button.txt", content: "MIT example source" },
  ];
  return {
    source: { id: "example", kind: "consumer", author: "consumer", license: "MIT" }, values: { fills: [] },
    components: { files, fills: [{
      $extensions: { "com.clossys.fill": { id: "example/components.button", slot: "components.button", source: "example" } },
      components: { button: { slot: "components.button", source: "example", root: "Button", members: [], props: [], propMap: {}, reads: { tokens: [], assets: [], components: [] }, composes: [], impl: { kind: "source", entry: files[0]!.path, export: "Button" }, license: "MIT", deps: [], origin: { kind: "authored", license: "MIT" }, notice: files[3]!.path, outputSha256: files.map(file => ({ path: file.path, sha256: hash(file.content) })) } },
    }] as CompositeLibraryData["components"]["fills"] },
  };
}
function analyze(module: SourceModule): SourceImport[] {
  const source = ts.createSourceFile(module.path, module.content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const result: SourceImport[] = [];
  for (const statement of source.statements) if ((ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) && statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)) {
    result.push({ specifier: statement.moduleSpecifier.text, start: statement.moduleSpecifier.getStart(source), end: statement.moduleSpecifier.end });
  }
  return result;
}
function resolve(request: SourceRequest) {
  if (request.specifier === "example-text") return { kind: "dependency" as const, name: "example-text", version: "^2.3.4" };
  const path = posix.normalize(posix.join(dirname(request.importer!.path), request.specifier)).replace(/\.js$/, ".ts");
  const content = request.files.get(path);
  if (content === undefined) throw new Error("Missing source " + path);
  return { kind: "source" as const, module: { path, content } };
}
describe("selected source closure", () => {
  it("collects actual transitive shared source, rewrites imports, and preserves manifest dependency ranges", () => {
    const input = library(), before = structuredClone(input);
    const result = collectSourceClosure({ library: input, analyze, resolve });
    expect(result.entries).toEqual([{ slot: "components.button", export: "Button", path: "components/button/Button.ts" }]);
    expect(result.files.map(file => file.path)).toEqual(["adapters/text.ts", "components/_parts/label.ts", "components/button/Button.ts"]);
    expect(result.files.find(file => file.path.endsWith("Button.ts"))!.content).toContain('"../_parts/label.ts"');
    expect(result.dependencies).toEqual({ "example-text": "^2.3.4" });
    expect(input).toEqual(before);
  });
  it("collects additional app roots and handles import cycles once", () => {
    const input = library();
    const page = { path: "app/page.ts", content: 'export { next } from "./next.js";' };
    const next = { path: "app/next.ts", content: 'export { next } from "./page.js";' };
    const result = collectSourceClosure({ library: input, analyze, additionalEntries: [page], resolve: request => request.specifier === "./next.js" ? { kind: "source", module: next } : request.specifier === "./page.js" ? { kind: "source", module: page } : resolve(request) });
    expect(result.files.filter(file => file.path.startsWith("app/"))).toHaveLength(2);
  });
  it("refuses absent selected leaves, descriptor dependencies and missing actual sources", () => {
    expect(() => collectSourceClosure({ library: library(), slots: ["components.absent"], analyze, resolve })).toThrow(/selected/i);
    const input = library();
    input.components.fills[0]!.components.button!.reads.components = ["components.absent"];
    expect(() => collectSourceClosure({ library: input, analyze, resolve })).toThrow(/selected/i);
    expect(() => collectSourceClosure({ library: library('import "./absent.js"; export const Button = 1;'), analyze, resolve })).toThrow(/Missing source/);
  });
  it("refuses unselected leaves returned by a resolver and changed receipted source", () => {
    expect(() => collectSourceClosure({ library: library(), analyze, resolve: () => ({ kind: "source", module: { path: "components/menu/Menu.ts", content: "export const Menu = 1;", ownerSlot: "components.menu" } }) })).toThrow(/selected/i);
    const input = library(); input.components.files[0]!.content += "// edited";
    expect(() => collectSourceClosure({ library: input, analyze, resolve })).toThrow(/hash/i);
  });
  it("resolves package seeds with only the selected named export and never copies a package barrel", () => {
    const input = library(), fill = input.components.fills[0]!.components.button!;
    fill.impl = { kind: "package", module: "@clossys/designer/components", export: "Button" };
    fill.pin = { package: "@clossys/designer", version: "0.12.0", export: "./components#Button" };
    const resolver = vi.fn((_request: SourceRequest) => ({ kind: "source" as const, module: { path: "ui/Button.ts", content: "export const Button = 1;", ownerSlot: "components.button" } }));
    expect(collectSourceClosure({ library: input, analyze, resolve: resolver }).files).toEqual([{ path: "ui/Button.ts", content: "export const Button = 1;" }]);
    expect(resolver.mock.calls[0]![0]).toMatchObject({ specifier: "@clossys/designer/components", names: ["Button"], importer: undefined });
  });
  it("accepts explicit installed and copied consumer source origins while enforcing selected owners", () => {
    const input = library(), fill = input.components.fills[0]!.components.button!;
    fill.impl = { kind: "package", module: "example-kit/components", export: "Button" };
    fill.pin = { package: "example-kit", version: "1.2.3", export: "./components#Button" };
    // Explicitly synthetic public source snapshots exercise the resolver boundary.
    const installed: SourceModule = { path: "components/_vendor/example-kit/src/Button.ts", content: 'import { label } from "label-source"; export const Button = () => label;', origin: "installed", ownerSlot: "components.button" };
    const consumer: SourceModule = { path: "components/_consumer/label.ts", content: 'export const label = "Continue";', origin: "consumer" };
    const resolver = (request: SourceRequest) => ({ kind: "source" as const, module: request.importer ? consumer : installed });
    const result = collectSourceClosure({ library: input, analyze, resolve: resolver });
    expect(result.files).toHaveLength(2);
    expect(result.files.find(file => file.path === installed.path)!.content).toContain('"../../../_consumer/label.ts"');
    for (const origin of ["installed", "consumer"] as const) {
      expect(() => collectSourceClosure({ library: input, analyze, resolve: () => ({ kind: "source", module: { ...installed, origin, ownerSlot: "components.menu" } }) })).toThrow(/selected/i);
    }
    expect(() => collectSourceClosure({ library: input, analyze, resolve: () => ({ kind: "source", module: { ...installed, origin: undefined } }) })).toThrow(/receipted/i);
  });
  it("refuses conflicting dependency ranges and unresolved firstparty text, including comments", () => {
    const input = library('import "one"; import "two"; export const Button = 1;');
    expect(() => collectSourceClosure({ library: input, analyze, resolve: request => ({ kind: "dependency", name: "example-text", version: request.specifier === "one" ? "^1.0.0" : "^2.0.0" }) })).toThrow(/conflict/i);
    const comment = library('/* @clossys/designer */ export const Button = 1;');
    expect(() => collectSourceClosure({ library: comment, analyze, resolve })).toThrow(/firstparty/i);
    expect(collectSourceClosure({ library: comment, analyze, resolve, transformSource: content => content.replace(/\/\*[\s\S]*?\*\//g, "") }).files[0]!.content).not.toContain("@clossys");
  });
});

const temporary: string[] = [];
afterEach(async () => { for (const path of temporary.splice(0)) await fs.rm(path, { recursive: true, force: true }); });
describe("active source library", () => {
  it("reads authoritative pointers without creating a compiled projection or changing the consumer", async () => {
    const root = await fs.mkdtemp(join(tmpdir(), "source-closure-")); temporary.push(root);
    const fixture = new URL("../library-cli/__fixtures__/agent-receipted/", import.meta.url);
    const catalog = loadCatalog(), cells = join(root, "cells");
    await libraryToCells(fixture.pathname, cells, { catalog, date: "2026-10-29" });
    const before = await fs.readFile(join(cells, "tree.json"), "utf8");
    const expected = await readLibrary(fixture.pathname, catalog);
    const writes = [vi.mocked(fs.writeFile), vi.mocked(fs.mkdir), vi.mocked(fs.mkdtemp)];
    for (const write of writes) write.mockClear();
    expect(await readActiveSourceLibrary(cells, catalog)).toEqual(expected);
    for (const write of writes) expect(write).not.toHaveBeenCalled();
    expect(await fs.readFile(join(cells, "tree.json"), "utf8")).toBe(before);
    expect(await fs.readdir(root)).toEqual(["cells"]);
  });
  it("reconstructs a composite library from active cells while newer drafts remain invisible", async () => {
    const root = await fs.mkdtemp(join(tmpdir(), "source-closure-")); temporary.push(root);
    const integration = adoptedComponentIntegration(), input = join(root, "input"), cells = join(root, "cells");
    for (const [path, content] of libraryFiles(integration.catalog, integration.library, [], integration.componentOptions)) {
      await fs.mkdir(dirname(join(input, path)), { recursive: true });
      await fs.writeFile(join(input, path), content);
    }
    await libraryToCells(input, cells, { catalog: integration.catalog, componentOptions: integration.componentOptions, date: "2026-10-29" });
    const expected = await readLibrary(input, integration.catalog);
    const draft = await propose(cells, "components.button");
    await fs.writeFile(join(cells, draft.path), draft.source.replace("## Rationale", "Invalid unfinished draft"));
    expect(await readActiveSourceLibrary(cells, integration.catalog)).toEqual(expected);
    const tree = JSON.parse(await fs.readFile(join(cells, "tree.json"), "utf8"));
    tree.active["components.button"] = 2;
    await fs.writeFile(join(cells, "tree.json"), JSON.stringify(tree));
    await expect(readActiveSourceLibrary(cells, integration.catalog)).rejects.toThrow(/status|active/i);
  });
});
