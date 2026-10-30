import { expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { build } from "esbuild";
import { collectSourceClosure } from "../../../designer/src/components/source-closure.js";
import { importFoundryComponents, loadComponentRegistry } from "../../../designer/src/catalog-core/index.js";
import { applyComponentLibraryChange } from "../../../designer/src/catalog-core/changeset-components.js";
import { componentLibraryHash } from "../../../designer/src/catalog-core/resolve-components.js";
import type { CompositeLibraryData } from "../../../designer/src/catalog-core/types.js";
import { analyzeAppLocalSource, appLocalSourceResolver, printAppLocalSource } from "./source.js";
import { generatedText } from "./format.js";
const empty = (): CompositeLibraryData => ({ source: { id: "example", kind: "consumer", author: "consumer", license: "MIT" }, values: { fills: [] }, components: { fills: [], files: [] } });
const closure = (library: CompositeLibraryData, content: string) => collectSourceClosure({ library, additionalEntries: [{ path: "entry.ts", content }], analyze: analyzeAppLocalSource, resolve: appLocalSourceResolver(library, process.cwd(), { react: ">=18" }), transformSource: (content, source) => { const output = printAppLocalSource(content, source); if (output.includes("@clossys")) throw new Error(`Unrelocated identity in ${source.path}: ${output.split("\n").find(line => line.includes("@clossys"))}`); return output; } });
it("copies actual installed transitive first-party sources and converts runtime JSON into loadable TS", async () => {
  const result = closure(empty(), 'import { directionFor } from "@clossys/writer/locale"; import brief from "@clossys/publisher/strategy-brief.json" with {type:"json"}; export const language = directionFor("ar", {locales:[{tag:"ar",dir:"rtl"}]}); export { brief };');
  expect(result.files.some(file => /writer\/src\/model\/types/.test(file.path))).toBe(true);
  expect(result.files.some(file => file.path.endsWith("strategy-brief.json-data.ts"))).toBe(true);
  for (const file of result.files) expect(file.content).not.toContain("@clossys/");
  expect(result.files.find(file => file.path === "entry.ts")!.content).not.toContain('type: "json"');
  const directory = await mkdtemp(join(tmpdir(), "app-local-source-smoke-"));
  try {
    for (const file of result.files) { await mkdir(dirname(join(directory, file.path)), { recursive: true }); await writeFile(join(directory, file.path), generatedText(file.content)); }
    const bundled = await build({ entryPoints: [join(directory, "entry.ts")], bundle: true, write: false, format: "esm", platform: "browser", packages: "external", logLevel: "silent" });
    const loaded = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0]!.text).toString("base64")}`);
    expect(loaded.language).toBe("rtl"); expect(loaded.brief).toBeTypeOf("object");
  } finally { await rm(directory, { recursive: true, force: true }); }
});
it("uses the actual selected Button and Icon closure without importing unrelated component leaves", () => {
  const library = empty(), catalog = { slots: loadComponentRegistry().slots, fills: importFoundryComponents().fills };
  const components = { source: library.source, adoptedAt: "2026-10-29", ...library.components };
  library.components = applyComponentLibraryChange(catalog, components, { baseHash: componentLibraryHash(components), changes: [
    { op: "adopt", slot: "components.button", source: "foundry" }, { op: "adopt", slot: "components.icon", source: "foundry" },
  ] });
  const result = closure(library, 'export { Button } from "@clossys/designer/components";');
  expect(result.files.some(file => /\/Button(?:-[a-f0-9]+)?\.tsx$/.test(file.path))).toBe(true);
  expect(result.files.some(file => /\/Icon(?:-[a-f0-9]+)?\.tsx$/.test(file.path))).toBe(true);
  expect(result.files.some(file => /\/(?:Dialog|Menu|Table)(?:-[a-f0-9]+)?\.tsx$/.test(file.path))).toBe(false);
  expect(result.dependencies).toMatchObject({ react: ">=18", "react-aria-components": "^1.19.0", "tailwind-merge": "^3.7.0" });
  const unselected = { ...library, components: { ...library.components, fills: library.components.fills.filter(document => !document.components.icon) } };
  expect(() => closure(unselected, 'export { Button } from "@clossys/designer/components";')).toThrow(/selected/i);
});
it("refuses dynamic module discovery and undeclared source dependencies", () => {
  expect(() => analyzeAppLocalSource({ path: "entry.ts", content: "export async function load(name:string){return import(name)}" })).toThrow(/Nonliteral/i);
  expect(() => closure(empty(), 'import "unknown-runtime-package";')).toThrow(/Undeclared/);
});
