/** @vitest-environment node */
import * as fs from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { importFoundryFrames } from "../importers/foundry-frames.js";
import { importFoundrySections } from "../importers/foundry-sections.js";
import { specimenSectionSourceCatalog } from "../importers/specimen-sections.js";
import { sha256 } from "../catalog-core/digest.js";
import type { SurfaceCandidateDocument } from "../catalog-core/surface-types.js";
import { packageBarrelExports, readSurfacePackageEvidence } from "./surface-package-evidence.js";

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
    await fs.writeFile(join(pkg, "package.json"), JSON.stringify({ name: "@clossys/designer", version: "0.11.0", exports: { "./blocks": { types: "./dist/blocks/index.d.ts", import: "./dist/blocks/index.js" } } }));
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
    await fs.writeFile(join(root, "package.json"), JSON.stringify({ name: "@clossys/designer", version: "0.10.0", exports: { "./blocks": { import: "./dist/blocks/index.js" } } }));
    const built = `export { Faq } from "./Faq.js";\n`;
    await fs.writeFile(join(root, "dist", "blocks", "index.js"), built);
    const faq = fills.filter(doc => doc.$extensions["com.clossys.fill"].slot === "sections.faq");
    expect(await readSurfacePackageEvidence(faq, { from: join(root, "src", "library-cli") })).toEqual([{ module: "@clossys/designer/blocks", version: "0.10.0", artifactSha256: sha256(built), values: ["Faq"], types: [] }]);
  });
  it("reads value and declaration exports of a retained specimen SOURCE dependency from the installed package", async () => {
    const sources = specimenSectionSourceCatalog().fills;
    const evidence = await readSurfacePackageEvidence(sources);
    const studio = evidence.find(row => row.module === "@clossys/designer/studio")!;
    expect(studio.values).toEqual(expect.arrayContaining(["SpecimenPageViewports", "bindNativeSpecimenContext", "studioSpecimenLeaves"]));
    expect(studio.types).toContain("SpecimenLeafProps");
    expect(studio.version).toBe(JSON.parse(readFileSync(resolve(here, "../../package.json"), "utf8")).version);
    expect(studio.artifactSha256).toBe(sha256(JSON.stringify({ javascript: { path: './dist/studio/index.js', sha256: sha256(readFileSync(resolve(here, "../../dist/studio/index.js"), "utf8")) }, types: { path: './dist/studio/index.d.ts', sha256: sha256(readFileSync(resolve(here, "../../dist/studio/index.d.ts"), "utf8")) } })));
    const absent = await fs.realpath(await fs.mkdtemp(join(tmpdir(), "surface-source-evidence-")));
    temporary.push(absent);
    expect(await readSurfacePackageEvidence(sources, { from: absent })).toEqual([]);
  });
  it("invalidates SOURCE dependency identity on declaration-only changes with unchanged export names", async () => {
    const root = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'surface-declaration-evidence-')));
    temporary.push(root);
    const pkg = join(root, 'node_modules', '@clossys', 'designer');
    await fs.mkdir(join(pkg, 'dist', 'studio'), { recursive: true });
    await fs.writeFile(join(pkg, 'package.json'), JSON.stringify({ name: '@clossys/designer', version: '0.12.0', exports: { './studio': { import: './dist/studio/index.js', types: './dist/studio/index.d.ts' } } }));
    await fs.writeFile(join(pkg, 'dist', 'studio', 'index.js'), 'export const SpecimenPageViewports = () => null;\n');
    const declaration = join(pkg, 'dist', 'studio', 'index.d.ts');
    await fs.writeFile(declaration, 'export declare const SpecimenPageViewports: () => null;\nexport interface SpecimenLeafProps { items: readonly unknown[] }\n');
    const sources = specimenSectionSourceCatalog().fills;
    const before = (await readSurfacePackageEvidence(sources, { from: root }))[0]!;
    await fs.writeFile(declaration, 'export declare const SpecimenPageViewports: () => null;\nexport interface SpecimenLeafProps { items: readonly unknown[]; required: boolean }\n');
    const after = (await readSurfacePackageEvidence(sources, { from: root }))[0]!;
    expect(after.values).toEqual(before.values);
    expect(after.types).toEqual(before.types);
    expect(after.version).toBe(before.version);
    expect(after.artifactSha256).not.toBe(before.artifactSha256);
  });
});
