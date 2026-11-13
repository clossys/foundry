// @vitest-environment node
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "esbuild";
import { expect, it } from "vitest";
import { loadCatalog, libraryHash } from "./index.js";
import { completedCatalogLibrary } from "./__fixtures__/completed-catalog-library.js";
import { libraryFiles } from "../library-cli/fs-library.js";
import { readLibrary, readSurfacePackageEvidence } from "./node.js";

it.each(["default", "react-server"])("exposes only the two Node readers under %s", condition => {
  const conditions = condition === "react-server" ? ["--conditions=react-server"] : [];
  const output = execFileSync(process.execPath, [...conditions, "--input-type=module", "-e", 'import * as reader from "@clossys/designer/catalog/node"; console.log(JSON.stringify(Object.keys(reader).sort()));'], { encoding: "utf8" });
  expect(JSON.parse(output)).toEqual(["readLibrary", "readSurfacePackageEvidence"]);
});

it("reads a real library and installed surface barrel through the narrow entry", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "designer-node-reader-")));
  try {
    const catalog = loadCatalog();
    const library = completedCatalogLibrary(catalog, { id: "example", kind: "consumer", author: "consumer", license: "UNLICENSED" }, "2026-10-23");
    for (const [name, contents] of libraryFiles(catalog, library)) {
      const path = join(root, name);
      await mkdir(join(path, ".."), { recursive: true }); await writeFile(path, contents);
    }
    expect(libraryHash(await readLibrary(root, catalog))).toBe(libraryHash(library));
    const docs = [{ sections: { example: { impl: { kind: "package", module: "@clossys/designer/frames" } } } }] as Parameters<typeof readSurfacePackageEvidence>[0];
    const evidence = await readSurfacePackageEvidence(docs);
    expect(evidence).toHaveLength(1);
    expect(evidence[0]).toMatchObject({ module: "@clossys/designer/frames", values: expect.arrayContaining(["AppFrame"]) });
  } finally { await rm(root, { recursive: true, force: true }); }
});

it("keeps CLI and scanner modules outside the reader import graph", async () => {
  const result = await build({ entryPoints: [join(import.meta.dirname, "node.ts")], bundle: true, platform: "node", format: "esm", write: false, metafile: true, logLevel: "silent" });
  expect(Object.keys(result.metafile!.inputs).filter(file => /consumer-dogfood|library-cli\/cli\./.test(file))).toEqual([]);
});

it("preserves scanner package-relative paths when only its exact Node subpath is external", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "designer-node-scanner-")));
  try {
    await writeFile(join(root, "page.tsx"), 'export default function Page() { return <main />; }');
    const result = await build({ stdin: { contents: `import { consumerDogfoodSources } from "@clossys/designer/catalog/dogfood/node"; const root = ${JSON.stringify(root)}; const result = await consumerDogfoodSources(["page.tsx"], {version:1,sources:{},pages:["page.tsx"]},root,root); console.log(JSON.stringify(result.files));`, resolveDir: process.cwd() }, bundle: true, platform: "node", format: "esm", external: ["@clossys/designer/catalog/dogfood/node"], write: false, metafile: true });
    expect(Object.keys(result.metafile!.inputs)).toEqual(["<stdin>"]);
    const files = JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", result.outputFiles[0]!.text], { encoding: "utf8" }));
    expect(files).toEqual([{ file: "page.tsx", content: expect.stringContaining("function Page") }]);
  } finally { await rm(root, { recursive: true, force: true }); }
});
