// @vitest-environment node
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import ts from "typescript";
import { loadCatalogBundles, installedHeadlessLibrary } from "../catalog-bundles.js";
import { applyLibraryChange, libraryHash, resolve as resolveValues } from "./api.js";
import { emittedTokenProperties } from "./emit.js";
import { loadCatalog } from "./index.js";
import { loadComponentRegistry } from "./component-registry.js";
import { loadComponentCompositionRules } from "./component-compositions.js";
import { applyComponentLibraryChange, type ComponentOperation } from "./changeset-components.js";
import { componentLibraryHash, componentOf, resolveComponents, type ComponentLibrary } from "./resolve-components.js";
import { emitComponents } from "./emit-components.js";
import { componentImportClosureFindings, componentRelativeImports } from "./component-import-closure.js";
import type { LibraryData } from "./types.js";

/**
 * Dependency closure: shadcn@aria sources import sibling leaves through their generated indexes
 * (`../icon/index`). A selection either emits every such module or its check fails with a finding
 * that names the missing leaf and the fill that satisfies it.
 */
const designerSrc = resolve(import.meta.dirname, "..");
// Virtual files live inside the package so react and react-aria-components resolve from its node_modules.
const root = resolve(designerSrc, "__closure_typecheck__");
const bundles = loadCatalogBundles();
const catalog = { slots: loadComponentRegistry().slots, fills: bundles.componentFills, rules: loadComponentCompositionRules() };
const tokens = (() => {
  const values = loadCatalog();
  let library: LibraryData = { source: { kind: "consumer", author: "consumer", id: "closure-fixture", license: "MIT" }, fills: [], adoptedAt: "2026-11-02" };
  const changes = values.slots.filter(slot => slot.layer === "themes").flatMap(slot => {
    const offers = values.fills.filter(doc => doc.$extensions["com.clossys.fill"].slot === slot.id && doc.$extensions["com.clossys.fill"].mode !== "reference");
    const chosen = offers.find(doc => doc.$extensions["com.clossys.fill"].source === "foundry") ?? offers[0];
    return chosen ? [{ op: "adopt" as const, slot: slot.id, source: chosen.$extensions["com.clossys.fill"].source }] : [];
  });
  library = applyLibraryChange(values, library, { baseHash: libraryHash(library), changes });
  const resolved = resolveValues({ catalog: values, library });
  return Object.fromEntries([...emittedTokenProperties(resolved)].map(([id, output]) => [id, { property: output.property, light: "0" }]));
})();
async function select(changes: readonly ComponentOperation[], packageExports: Record<string, string[]> = {}) {
  let library: ComponentLibrary = { source: { kind: "consumer", author: "consumer", id: "closure-fixture", license: "MIT" }, fills: [], files: [], adoptedAt: "2026-11-02" };
  library = applyComponentLibraryChange(catalog, library, { baseHash: componentLibraryHash(library), changes }, bundles.sourceBundles);
  const assets = [...new Set(library.fills.flatMap(doc => componentOf(doc).reads.assets))];
  // As the producer does: every package a selected source imports is measured by its runtime exports.
  const modules = new Set(library.files.flatMap(file => [...file.content.matchAll(/\b(?:import|export)\s[^;]*?\bfrom\s*["']([^"']+)["']/g)].map(match => match[1]!)));
  const exports = { ...packageExports };
  for (const module of modules) if (!module.startsWith(".") && !module.endsWith(".css") && !exports[module]) exports[module] = Object.keys(await import(module));
  return resolveComponents({ catalog, library, values: { tokens, assets }, evidence: { observations: {}, installedRac: installedHeadlessLibrary() }, packageExports: exports });
}
const glyphModule = (assets: readonly string[]) => ({ path: "adapters/glyphs.ts", glyphs: Object.fromEntries(assets.map(asset => [asset, [["path", { d: "M6 9l6 6 6-6" }]]])) });
function typecheck(files: readonly { path: string; content: string }[]): string[] {
  const virtual = new Map(files.filter(file => /\.tsx?$/.test(file.path)).map(file => [resolve(root, file.path), file.content]));
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022, lib: ["lib.es2022.d.ts", "lib.dom.d.ts", "lib.dom.iterable.d.ts"],
    module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, jsx: ts.JsxEmit.ReactJSX,
    strict: true, noEmit: true, skipLibCheck: true, isolatedModules: true, esModuleInterop: true, types: [],
    paths: { "@clossys/designer/components": [resolve(designerSrc, "components/index.ts")] },
  };
  const host = ts.createCompilerHost(options, true);
  const { fileExists, readFile, getSourceFile } = host;
  host.fileExists = name => virtual.has(name) || fileExists.call(host, name);
  host.readFile = name => virtual.get(name) ?? readFile.call(host, name);
  host.directoryExists = name => [...virtual.keys()].some(path => dirname(path).startsWith(name)) || ts.sys.directoryExists(name);
  host.getSourceFile = (name, language, onError, create) => virtual.has(name)
    ? ts.createSourceFile(name, virtual.get(name)!, language, true, name.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
    : getSourceFile.call(host, name, language, onError, create);
  const program = ts.createProgram([...virtual.keys()], options, host);
  return ts.getPreEmitDiagnostics(program).map(diagnostic => {
    const where = diagnostic.file ? `${diagnostic.file.fileName.replace(root + "/", "")}:${diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start ?? 0).line + 1}` : "";
    return `${where} TS${diagnostic.code}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")}`;
  });
}
const errors = (profile: Awaited<ReturnType<typeof select>>) => profile.check.findings.filter(finding => finding.severity === "error");

describe("component selection dependency closure", () => {
  it("reads only static relative specifiers, ignoring comments and packages", () => {
    expect(componentRelativeImports('// import { X } from "../gone/index";\nimport { Icon } from "../icon/index";\nimport type { A } from "./a";\nimport "./side.css";\nexport { B } from "../b/index";\nimport { cva } from "class-variance-authority";')).toEqual(["../b/index", "../icon/index", "./a", "./side.css"]);
  });

  it("shadcn@aria disclosure with the shadcn@aria icon rule emits a tree that tsc accepts", async () => {
    const profile = await select([{ op: "derive", slot: "components.icon", rule: "derive:icon@1", inputs: [] }, { op: "adopt", slot: "components.disclosure", source: "shadcn@aria" }]);
    expect(errors(profile)).toEqual([]);
    expect(profile.components["components.icon"]).toMatchObject({ originKind: "derived", impl: { kind: "source", entry: "components/icon/icon.tsx" } });
    const files = emitComponents(profile, ["component-index"], { glyphModule: glyphModule(profile.components["components.disclosure"]!.reads.assets) });
    expect(files.map(file => file.path)).toEqual(expect.arrayContaining(["components/disclosure/accordion.tsx", "components/icon/icon.tsx", "components/icon/index.ts", "component-index.ts"]));
    expect(typecheck(files)).toEqual([]);
  }, 60_000);

  it("shadcn@aria disclosure with the default Foundry icon emits a tree that tsc accepts", async () => {
    const packageExports = { "@clossys/designer/components": ["Icon"] };
    const profile = await select([{ op: "adopt", slot: "components.icon", source: "foundry" }, { op: "adopt", slot: "components.disclosure", source: "shadcn@aria" }], packageExports);
    expect(errors(profile)).toEqual([]);
    const files = emitComponents(profile, ["component-index"], { glyphModule: glyphModule(profile.components["components.disclosure"]!.reads.assets) });
    expect(typecheck(files)).toEqual([]);
  }, 60_000);

  it("counts the glyph module as emitted only when the selection emits one (DESIGNER-TESTS T4)", () => {
    const source = (reads: readonly string[]) => ({ slot: "components.badge", source: "consumer", impl: { kind: "source", entry: "components/badge/badge.tsx", export: "Badge" },
      reads: { assets: reads, components: [], themes: [] }, outputSha256: [{ path: "components/badge/badge.tsx", sha256: "x" }] }) as never;
    const files = [{ path: "components/badge/badge.tsx", content: 'import { glyphs } from "../../adapters/glyphs";\nexport const Badge = () => glyphs;\n' }];
    const run = (reads: readonly string[]) => componentImportClosureFindings({ catalog, files, fills: new Map([["components.badge", source(reads)]]) });
    // A leaf that reads an asset makes emitComponents write adapters/glyphs.ts, so its import resolves.
    expect(run(["assets.icon-date"])).toEqual([]);
    // With no asset read nothing emits the module: the import still fails closed.
    expect(run([])).toEqual([expect.objectContaining({ code: "K9", subject: "components.badge", message: "Source import ../../adapters/glyphs in components/badge/badge.tsx resolves to no selected file" })]);
  });

  it("refuses a selection whose source imports an unselected leaf, naming the fills that satisfy it", async () => {
    const [doc] = catalog.fills.filter(candidate => candidate.$extensions["com.clossys.fill"].id === "shadcn@aria/components.badge");
    const badge = componentOf(doc!);
    const entry = badge.impl.kind === "source" ? badge.impl.entry : "";
    const bundle = bundles.sourceBundles.find(candidate => candidate.slot === "components.badge")!;
    // An authored fill that keeps its own reads but adds an icon import nothing selects.
    const files = bundle.files.map(file => file.path === entry ? { ...file, content: `import { Icon } from "../icon/index";\nexport const BadgeIcon = Icon;\n${file.content}` } : file);
    const fill = { ...badge, outputSha256: files.map(file => ({ path: file.path, sha256: createHash("sha256").update(file.content).digest("hex") })) };
    const profile = await select([{ op: "author", slot: "components.badge", fill, files }]);
    expect(profile.check.ok).toBe(false);
    const finding = errors(profile).find(row => row.code === "K9")!;
    expect(finding).toMatchObject({ subject: "components.badge", severity: "error" });
    expect(finding.message).toContain(`Source import ../icon/index in ${entry} needs components.icon, which is not selected`);
    expect(finding.message).toContain("shadcn@aria rule derive:icon@1");
    expect(finding.message).toContain("foundry/components.icon");
    expect(() => emitComponents(profile, ["component-index"], { glyphModule: glyphModule([]) })).toThrow("checks failed; code generation refused");
  });
});
