/** @vitest-environment node */
import * as fs from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { importFoundryFrames } from "../importers/foundry-frames.js";
import { importFoundrySections } from "../importers/foundry-sections.js";
import { sha256 } from "../catalog-core/digest.js";
import type { SurfaceCandidateDocument } from "../catalog-core/surface-types.js";
import { packageBarrelExports, readSurfacePackageEvidence, surfacePackageModules } from "./surface-package-evidence.js";
import { syntheticSurface } from "../catalog-core/__fixtures__/surface-engine/synthetic.js";
import { analyzeSurfaceSource } from "../catalog-core/surface-source-analysis.js";

const here = dirname(fileURLToPath(import.meta.url));
const fills = [...importFoundrySections().fills, ...importFoundryFrames().fills] as unknown as SurfaceCandidateDocument[];
const temporary: string[] = [];
afterAll(async () => { for (const path of temporary) await fs.rm(path, { recursive: true, force: true }); });

describe("packageBarrelExports", () => {
  it("separates value and type exports of a barrel, deterministically", () => {
    const text = `/** export { Fake } from "./no.js"; */\n// export { AlsoFake }\nexport { A, B as C, type D } from "./a.js";\nexport type { E, F as G } from "./e.js";\nexport function H() {}\nexport const I = 1, J = 2;\nexport class K {}\nexport interface L {}\nexport type M = string;\nexport default H;\n`;
    expect(packageBarrelExports(text)).toEqual({ values: ["A", "C", "H", "I", "J", "K", "default"], types: ["D", "E", "G", "L", "M"] });
  });
  it("refuses a star re-export it cannot enumerate from the barrel alone", () => {
    expect(() => packageBarrelExports(`export * from "./a.js";`)).toThrow(/star re-export/);
  });
  it("ignores export-shaped text in strings, nested templates, comments and declaration literals", () => {
    for (const prefix of [
      'const text = "export const Ghost = 1; export default Ghost";',
      "const text = 'export const Ghost = 1; export default Ghost';",
      'const text = `export const Ghost = 1; export default Ghost`;',
      'const text = `raw ${`export const Ghost = 1; ${"export type Phantom = 1"}`} export default Ghost`;',
      '/* export const Ghost = 1; */ // export default Ghost\n',
      'const text = "/* export const Ghost = 1 */ // export default Ghost";',
      'const text = "export * from ghost";',
    ]) expect(packageBarrelExports(prefix + '\nexport { Visible } from "./visible.js";')).toEqual({ values: ["Visible"], types: [] });
    expect(packageBarrelExports('export const Text = "export const Ghost = 1;"; export const Visible = 1;')).toEqual({ values: ["Text", "Visible"], types: [] });
    expect(packageBarrelExports('declare const text: "export interface Ghost {}"; export interface Visible {}')).toEqual({ values: [], types: ["Visible"] });
    expect(packageBarrelExports('const text = "export default Ghost"; export default function Actual() {}')).toEqual({ values: ["default"], types: [] });
  });
  it("refuses unsupported or unterminated literal syntax instead of guessing export names", () => {
    expect(() => packageBarrelExports('const regex = /export const Ghost = 1;/; export const Visible = 1;')).toThrow(/unsupported.*lexical/);
    expect(() => packageBarrelExports('const text = `unfinished export const Ghost = 1;')).toThrow(/unsupported.*lexical/);
  });
});

describe("readSurfacePackageEvidence", () => {
  it("reads every package the Foundry Section/Frame candidates point at from the installed barrels", async () => {
    const evidence = await readSurfacePackageEvidence(fills);
    expect(evidence.map(row => `${row.module}@${row.version}`)).toEqual(["@clossys/designer/blocks@0.12.0", "@clossys/designer/frames@0.12.0", "@clossys/designer/shell/server@0.12.0"]);
    // Every pointed-at export is present in the inventory read from its own barrel.
    for (const doc of fills) {
      const entry = Object.values((doc as unknown as { sections?: Record<string, { impl: { module: string; export: string } }> }).sections ?? (doc as unknown as { frames: Record<string, { impl: { module: string; export: string } }> }).frames)[0]!;
      expect(evidence.find(row => row.module === entry.impl.module)!.values, entry.impl.module).toContain(entry.impl.export);
    }
    const blocks = evidence.find(row => row.module === "@clossys/designer/blocks")!;
    // The installed barrel: the built export target when this install is built, else the source the build compiles.
    const builtBarrel = resolve(here, "../../dist/blocks/index.js");
    expect(blocks.artifactSha256).toBe(sha256(readFileSync(existsSync(builtBarrel) ? builtBarrel : resolve(here, "../blocks/index.ts"), "utf8")));
    expect(blocks.types).toContain("DataTableProps");
    expect(blocks.values).not.toContain("DataTableProps");
    expect(await readSurfacePackageEvidence([...fills].reverse())).toEqual(evidence);
  });

  it("reports the installed version and the built barrel, never the catalog pin", async () => {
    const root = await fs.realpath(await fs.mkdtemp(join(tmpdir(), "surface-evidence-")));
    temporary.push(root);
    const pkg = join(root, "node_modules", "@clossys", "designer");
    await fs.mkdir(join(pkg, "dist", "blocks"), { recursive: true });
    await fs.writeFile(join(pkg, "package.json"), JSON.stringify({ name: "@clossys/designer", version: "0.11.0", type: "module", exports: { "./blocks": { types: "./dist/blocks/index.d.ts", import: "./dist/blocks/index.js" } } }));
    const built = `export { Faq } from "./Faq.js";\n`;
    await fs.writeFile(join(pkg, "dist", "blocks", "index.js"), built);
    await fs.writeFile(join(pkg, "dist", "blocks", "index.d.ts"), `export { Faq } from "./Faq.js";\nexport type { FaqProps } from "./Faq.js";\n`);
    const faq = fills.filter(doc => doc.$extensions["com.clossys.fill"].slot === "sections.faq");
    expect(await readSurfacePackageEvidence(faq, { from: join(root, "app") })).toEqual([{ module: "@clossys/designer/blocks", version: "0.11.0", artifactSha256: sha256(built), values: ["Faq"], types: ["FaqProps"] }]);
    // A package that is not installed yields no row (the check reports S4), never an invented one.
    const shell = fills.filter(doc => doc.$extensions["com.clossys.fill"].slot === "frames.site-shell");
    expect(await readSurfacePackageEvidence(shell, { from: join(root, "app") })).toEqual([]);
  });

  it("reads the package that owns the resolving directory itself, with no node_modules copy", async () => {
    const root = await fs.realpath(await fs.mkdtemp(join(tmpdir(), "surface-evidence-own-")));
    temporary.push(root);
    await fs.mkdir(join(root, "dist", "blocks"), { recursive: true });
    await fs.mkdir(join(root, "src", "library-cli"), { recursive: true });
    await fs.writeFile(join(root, "package.json"), JSON.stringify({ name: "@clossys/designer", version: "0.10.0", type: "module", exports: { "./blocks": { import: "./dist/blocks/index.js" } } }));
    const built = `export { Faq } from "./Faq.js";\n`;
    await fs.writeFile(join(root, "dist", "blocks", "index.js"), built);
    const faq = fills.filter(doc => doc.$extensions["com.clossys.fill"].slot === "sections.faq");
    expect(await readSurfacePackageEvidence(faq, { from: join(root, "src", "library-cli") })).toEqual([{ module: "@clossys/designer/blocks", version: "0.10.0", artifactSha256: sha256(built), values: ["Faq"], types: [] }]);
  });
});

const sourceDocument = (modules: readonly string[]): SurfaceCandidateDocument => ({ sections: { synthetic: { impl: { kind: "source" }, dependencies: modules.map(module => ({ module, version: "0.0.1", license: "MIT" })) } } }) as unknown as SurfaceCandidateDocument;
async function installedFixture(manifest: object, files: Record<string, string>) {
  const root = await fs.realpath(await fs.mkdtemp(join(tmpdir(), "surface-import-evidence-")));
  temporary.push(root);
  const pkg = join(root, "node_modules", "fixture");
  await fs.mkdir(pkg, { recursive: true });
  await fs.writeFile(join(pkg, "package.json"), JSON.stringify({ name: "fixture", version: "1.2.3", type: "module", ...manifest }));
  for (const [path, content] of Object.entries(files)) {
    await fs.mkdir(dirname(join(pkg, path)), { recursive: true });
    await fs.writeFile(join(pkg, path), content);
  }
  return { root, pkg, read: (module = "fixture") => readSurfacePackageEvidence([sourceDocument([module])], { from: root }) };
}

describe("native import resolution and bounded artifact provenance (supplemental)", () => {
  it("collects exact root and subpath dependencies without consulting their candidate versions", () => {
    const document = sourceDocument(["react", "next/link.js", "react", "next/image.js"]);
    expect(surfacePackageModules([document])).toEqual(["next/image.js", "next/link.js", "react"]);
  });

  it("uses nested import conditions, key order, string exports and explicit type declarations", async () => {
    const f = await installedFixture({ exports: {
      ".": { types: "./index.d.ts", node: { import: "./import.mjs", require: "./require.cjs" } },
      "./ordered.js": { default: "./default.mjs", import: "./import.mjs" },
      "./features/*": "./features/*.mjs",
    } }, {
      "import.mjs": 'const text = "export const Ghost = 1; export default Ghost"; export const Imported = 1;\n',
      "require.cjs": "exports.Required = 1;\n",
      "default.mjs": "export const DefaultFirst = 1;\n",
      "index.d.ts": 'declare const text: "export interface Ghost {}"; export declare const DeclarationOnly: string;\n',
      "features/one.mjs": "export const Feature = 1;\n",
    });
    const root = (await f.read())[0]!;
    expect(root.values).toEqual(["Imported"]);
    expect(root.types).toEqual(["DeclarationOnly"]);
    expect(root.version).toBe("1.2.3");
    expect((await f.read("fixture/ordered.js"))[0]!.values).toEqual(["DefaultFirst"]);
    expect((await f.read("fixture/features/one"))[0]!.values).toEqual(["Feature"]);
    const stringRoot = await installedFixture({ exports: "./index.mjs" }, { "index.mjs": "export default function Entry() {}\n" });
    expect((await stringRoot.read())[0]!.values).toEqual(["default"]);
  });

  it("uses real legacy CommonJS import namespaces and the actual selected entry bytes", async () => {
    const f = await installedFixture({ type: "commonjs", main: "./main.cjs" }, { "main.cjs": "exports.Legacy = function Legacy() {};\n", "link.js": "exports.Link = function Link() {};\n" });
    expect((await f.read())[0]).toEqual({ module: "fixture", version: "1.2.3", artifactSha256: sha256("exports.Legacy = function Legacy() {};\n"), values: ["Legacy", "default"], types: [] });
    expect((await f.read("fixture/link.js"))[0]!.values).toEqual(["Link", "default"]);
    const missing = await installedFixture({ main: "./dist/index.js" }, { "src/index.ts": "export const SourceOnly = 1;\n" });
    expect(await missing.read()).toEqual([]);
  });

  it("refuses require-only, null/private, missing and declaration-only runtime targets", async () => {
    const f = await installedFixture({ main: "./public.mjs", exports: {
      ".": { require: "./public.mjs" },
      "./null.js": null,
      "./missing.js": "./missing.mjs",
      "./types.js": { types: "./index.d.ts" },
      "./declaration.js": "./index.d.ts",
      "./fake.js": "./fake.js",
      "./type-only.mjs": "./type-only.mjs",
      "./escape.js": "../public.mjs",
    } }, { "public.mjs": "export const Public = 1;\n", "private.js": "export const Private = 1;\n", "index.d.ts": "export declare const PretendRuntime: string;\n", "fake.js": "export declare const PretendRuntime: string;\n", "type-only.mjs": "export type PretendRuntime = string;\n" });
    for (const module of ["fixture", "fixture/null.js", "fixture/private.js", "fixture/missing.js", "fixture/types.js", "fixture/declaration.js", "fixture/fake.js", "fixture/type-only.mjs", "fixture/escape.js", "fixture/../public.mjs", "fixture/%2e%2e/public.mjs", "fixture/dir\\private.js"]) expect(await f.read(module), module).toEqual([]);
  });

  it("allows canonical package-root symlinks, but refuses artifact and source-fallback escapes", async () => {
    const f = await installedFixture({ exports: { ".": "./index.mjs", "./source": "./dist/source.js" } }, { "index.mjs": "export const Inside = 1;\n", "src/source.ts": "export const SourceOnly = 1;\n" });
    const linkedRoot = join(f.root, "linked");
    await fs.mkdir(join(linkedRoot, "node_modules"), { recursive: true });
    await fs.symlink(f.pkg, join(linkedRoot, "node_modules", "fixture"), "dir");
    expect((await readSurfacePackageEvidence([sourceDocument(["fixture"])], { from: linkedRoot }))[0]!.values).toEqual(["Inside"]);
    expect((await f.read("fixture/source"))[0]!.values).toEqual(["SourceOnly"]);
    const outside = join(f.root, "outside.mjs");
    await fs.writeFile(outside, "export const Escaped = 1;\n");
    await fs.rm(join(f.pkg, "index.mjs"));
    await fs.symlink(outside, join(f.pkg, "index.mjs"));
    expect(await f.read()).toEqual([]);
    await fs.rm(join(f.pkg, "src/source.ts"));
    await fs.symlink(outside, join(f.pkg, "src/source.ts"));
    expect(await f.read("fixture/source")).toEqual([]);
    await fs.rm(join(f.pkg, "src/source.ts"));
    await fs.writeFile(join(f.pkg, "src/source.ts"), "export const SourceOnly = 1;\n");
    await fs.symlink(f.root, join(f.pkg, "dist"), "dir");
    expect(await f.read("fixture/source")).toEqual([]);
  });

  it("authenticates optional same-consumer declaration namespaces and refuses missing or escaped evidence", async () => {
    const f = await installedFixture({ type: "commonjs", main: "./index.cjs" }, { "index.cjs": "exports.Runtime = function Runtime() {};\n" });
    const types = join(f.root, "node_modules", "@types", "fixture");
    await fs.mkdir(types, { recursive: true });
    const manifest = { name: "@types/fixture", version: "4.5.6", types: "index.d.ts" };
    await fs.writeFile(join(types, "package.json"), JSON.stringify(manifest));
    const declaration = "export = Fixture;\ndeclare namespace Fixture { interface ActualType { label: string } function Runtime(): void; }\n";
    await fs.writeFile(join(types, "index.d.ts"), declaration);
    // This synthetic consumer has declarations but no compiler: availability alone is not type proof.
    expect((await f.read())[0]!.types).toEqual([]);
    await fs.symlink(await fs.realpath(resolve(here, "../../../../node_modules/typescript")), join(f.root, "node_modules", "typescript"), "dir");
    const row = (await f.read())[0]!;
    expect(row.types).toEqual(["ActualType"]);
    expect(row.values).toEqual(["Runtime", "default"]);
    expect(row.version).toBe("1.2.3");
    await fs.writeFile(join(types, "package.json"), JSON.stringify({ ...manifest, name: "@types/substituted" }));
    expect((await f.read())[0]!.types).toEqual([]);
    await fs.writeFile(join(types, "package.json"), JSON.stringify(manifest));
    const outside = join(f.root, "outside.d.ts");
    await fs.writeFile(outside, declaration);
    await fs.rm(join(types, "index.d.ts"));
    await fs.symlink(outside, join(types, "index.d.ts"));
    expect((await f.read())[0]!.types).toEqual([]);
    await fs.rm(join(types, "index.d.ts"));
    await fs.writeFile(join(types, "index.d.ts"), declaration);
    expect((await f.read())[0]!.types).toEqual(["ActualType"]);
  }, 20_000);

  it("reads real installed React/Next, then rejects version and export substitutions in source analysis", async () => {
    const from = resolve(here, "../../../..");
    const modules = ["react", "next/link.js", "next/image.js"];
    const rows = await readSurfacePackageEvidence([sourceDocument(modules)], { from });
    expect(rows.map(row => row.module)).toEqual([...modules].sort());
    for (const row of rows) {
      const name = row.module.split("/")[0]!;
      const manifest = JSON.parse(await fs.readFile(join(from, "node_modules", name, "package.json"), "utf8"));
      expect(row.version).toBe(manifest.version);
      expect(row.artifactSha256).toBe(sha256(await fs.readFile(join(from, "node_modules", row.module === "react" ? "react/index.js" : row.module), "utf8")));
      expect(row.values).toContain("default");
    }
    expect(rows.find(row => row.module === "react")!.values).toContain("useState");
    expect(rows.find(row => row.module === "react")!.types).toContain("ButtonHTMLAttributes");
    expect(rows.find(row => row.module === "next/link.js")!.types).toContain("LinkProps");
    expect(rows.find(row => row.module === "next/image.js")!.types).toContain("ImageProps");
    for (const module of modules) {
      const row = rows.find(row => row.module === module)!;
      const fixture = syntheticSurface();
      const fill = { ...fixture.candidate, dependencies: [{ module, version: row.version, license: "MIT" }] };
      const files = [{ ...fixture.source, content: `import Dependency from "${module}";\nexport function Synthetic() { return Dependency; }\n` }];
      const analyze = (packages = rows, candidate = fill, source = files) => analyzeSurfaceSource({ fill: candidate, files: source, components: { components: {} } as never, componentFiles: [], packages });
      expect(analyze().findings).toEqual([]);
      expect(analyze(rows, { ...fill, dependencies: [{ module, version: "0.0.0", license: "MIT" }] }).findings).toEqual([expect.objectContaining({ code: "S4" })]);
      expect(analyze(rows.map(item => item.module === module ? { ...item, values: [] } : item)).findings).toEqual([expect.objectContaining({ code: "S4" })]);
      expect(analyze(rows, fill, [{ ...files[0]!, content: `import { UnavailableRuntimeExport } from "${module}";\nexport function Synthetic() { return UnavailableRuntimeExport; }\n` }]).findings).toEqual([expect.objectContaining({ code: "S4" })]);
      expect(analyze(rows.map(item => item.module === module ? { ...item, values: [], types: ["default"] } : item)).findings).toEqual([expect.objectContaining({ code: "S4" })]);
    }
    const fixture = syntheticSurface();
    const react = rows.find(row => row.module === "react")!;
    const fill = { ...fixture.candidate, dependencies: [{ module: "react", version: react.version, license: "MIT" }] };
    const files = [{ ...fixture.source, content: 'import type { ButtonHTMLAttributes } from "react";\nexport function Synthetic(props: ButtonHTMLAttributes<HTMLButtonElement>) { return props; }\n' }];
    const analyze = (packages = rows) => analyzeSurfaceSource({ fill, files, components: { components: {} } as never, componentFiles: [], packages });
    expect(analyze().findings).toEqual([]);
    expect(analyze(rows.map(row => row.module === "react" ? { ...row, types: [] } : row)).findings).toEqual([expect.objectContaining({ code: "S4" })]);
  });
});
