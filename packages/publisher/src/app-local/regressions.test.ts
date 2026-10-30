import { expect, it } from "vitest";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { collectSourceClosure, type SourceClosure } from "../../../designer/src/components/source-closure.js";
import type { CompositeLibraryData } from "../../../designer/src/catalog-core/types.js";
import { analyzeAppLocalSource, appLocalSourceResolver, printAppLocalSource } from "./source.js";
import { appLocalHash, generatedText } from "./format.js";
import { verifyAppLocal, writeAppLocal } from "./files.js";
const empty = (): CompositeLibraryData => ({ source: { id: "example", kind: "consumer", author: "consumer", license: "MIT" }, values: { fills: [] }, components: { files: [], fills: [] } });
const hash = (content: string) => createHash("sha256").update(content).digest("hex");
async function put(root: string, path: string, content: string) { await mkdir(dirname(join(root, path)), { recursive: true }); await writeFile(join(root, path), content); }
async function snapshot(root: string) {
  const result: Record<string, unknown> = {};
  async function walk(prefix = "") { for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) { const path = prefix ? `${prefix}/${entry.name}` : entry.name; if (entry.isDirectory()) await walk(path); else result[path] = [hash(await readFile(join(root, path), "utf8")), (await stat(join(root, path))).mtimeMs]; } }
  await walk(); return result;
}
async function bundled(root: string, closure: SourceClosure, entry: string) {
  for (const file of closure.files) await put(root, file.path, generatedText(file.content));
  const result = await build({ entryPoints: [join(root, entry)], bundle: true, write: false, platform: "node", format: "cjs", jsx: "automatic", nodePaths: [fileURLToPath(new URL("../../../../node_modules", import.meta.url))], logLevel: "silent" });
  const output = join(root, "bundle.cjs"); await writeFile(output, result.outputFiles[0]!.text); return createRequire(import.meta.url)(output);
}
it("converts both receipt-owned and consumer JSON to executable modules, including re-export attributes", async () => {
  const root = await mkdtemp(join(tmpdir(), "app-local-json-regression-"));
  try {
    const library = empty(), files = [
      { path: "components/button/Button.ts", content: 'import data from "./data.json" with {type:"json"}; export const Button = () => data.message;' },
      { path: "components/button/data.json", content: '{"message":"selected"}\n' },
      { path: "notices/button.txt", content: "MIT example source" },
    ];
    library.components = { files, fills: [{ $extensions: { "com.clossys.fill": { id: "example/components.button", slot: "components.button", source: "example" } }, components: { button: {
      slot: "components.button", source: "example", root: "Button", members: [], props: [], propMap: {}, reads: { tokens: [], assets: [], components: [] }, composes: [],
      impl: { kind: "source", entry: files[0]!.path, export: "Button" }, license: "MIT", deps: [], origin: { kind: "authored", license: "MIT" }, notice: files[2]!.path,
      outputSha256: files.map(file => ({ path: file.path, sha256: hash(file.content) })),
    } } }] } as CompositeLibraryData["components"];
    const selected = collectSourceClosure({ library, analyze: analyzeAppLocalSource, resolve: appLocalSourceResolver(library, root, {}), transformSource: printAppLocalSource });
    expect((await bundled(join(root, "selected"), selected, files[0]!.path)).Button()).toBe("selected");
    await put(root, "settings.json", '{"message":"consumer"}\n');
    const consumer = empty();
    const copied = collectSourceClosure({ library: consumer, additionalEntries: [{ path: "entry.ts", content: 'export {default as settings} from "./settings.json" with {type:"json"};' }], analyze: analyzeAppLocalSource, resolve: appLocalSourceResolver(consumer, root, {}), transformSource: printAppLocalSource });
    expect((await bundled(join(root, "consumer"), copied, "entry.ts")).settings.message).toBe("consumer");
  } finally { await rm(root, { recursive: true, force: true }); }
});
it("resolves actual owning-package imports maps without third-party dependencies", () => {
  const library = empty(), resolve = appLocalSourceResolver(library, process.cwd(), {}), files = new Map<string, string>();
  const barrel = resolve({ specifier: "@clossys/designer/frames", importer: undefined, names: ["AuthFrame"], files });
  if (barrel.kind !== "source") throw new Error("Expected actual Frame source");
  const frame = resolve({ specifier: "./AuthFrame.js", importer: barrel.module, names: ["AuthFrame"], files });
  if (frame.kind !== "source") throw new Error("Expected actual AuthFrame implementation");
  const reference = analyzeAppLocalSource(frame.module).find(value => value.specifier === "#designer-frame-i18n")!;
  expect(reference).toBeDefined();
  const local = resolve({ specifier: reference.specifier, importer: frame.module, names: reference.names ?? [], files });
  expect(local.kind).toBe("source");
  if (local.kind === "source") expect(local.module.path).toMatch(/i18n\.(?:client|server)\.tsx?$/);
});
it("preserves one real ThemeProvider context across separate named imports", async () => {
  const root = await mkdtemp(join(tmpdir(), "app-local-context-regression-"));
  try {
    const library = empty(), content = 'import {createElement} from "react"; import {renderToString} from "react-dom/server"; import {ThemeProvider} from "@clossys/designer/theme"; import {useTheme} from "@clossys/designer/theme"; function Child(){return createElement("div",null,useTheme().preference)} export function render(){return renderToString(createElement(ThemeProvider,null,createElement(Child)))}';
    const closure = collectSourceClosure({ library, additionalEntries: [{ path: "entry.ts", content }], analyze: analyzeAppLocalSource, resolve: appLocalSourceResolver(library, root, { react: ">=18", "react-dom": ">=18" }), transformSource: printAppLocalSource });
    expect((await bundled(root, closure, "entry.ts")).render()).toBe("<div>system</div>");
    expect(closure.files.filter(file => /\/ThemeProvider(?:-[a-f0-9]+)?\.tsx$/.test(file.path))).toHaveLength(1);
  } finally { await rm(root, { recursive: true, force: true }); }
});
it("checks app-root routes and build scripts while leaving hashes and mtimes unchanged", async () => {
  const root = await mkdtemp(join(tmpdir(), "app-local-scan-regression-"));
  try {
    const appDir = join(root, "apps/web"), outDir = join(appDir, "src/clossys"), files: Record<string, string> = { "routes.ts": generatedText("export const routes = [];\n") };
    files[".manifest.json"] = generatedText(JSON.stringify({ "routes.ts": appLocalHash(files["routes.ts"]!) }));
    await put(appDir, "package.json", '{"private":true}\n');
    const expected = { appDir, outDir, files, dependencies: {} };
    await writeAppLocal(outDir, expected);
    await put(appDir, "app/page.tsx", 'import {Button} from "@clossys/designer/components"; export default Button;');
    await put(appDir, "scripts/build.mjs", 'import "@clossys/publisher/core";');
    await put(appDir, "node_modules/example/index.js", 'import "@clossys/writer";');
    await put(appDir, ".next/server.js", 'import "@clossys/writer";');
    const before = await snapshot(root), findings = await verifyAppLocal(outDir, expected);
    expect(await snapshot(root)).toEqual(before);
    expect(findings).toContainEqual(expect.objectContaining({ kind: "clossys-import", path: "app/page.tsx" }));
    expect(findings).toContainEqual(expect.objectContaining({ kind: "clossys-import", path: "scripts/build.mjs" }));
    expect(findings.some(finding => /node_modules|\.next/.test(finding.path))).toBe(false);
  } finally { await rm(root, { recursive: true, force: true }); }
});
