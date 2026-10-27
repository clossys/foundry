import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { build, type Metafile } from "esbuild";
import { fileHash, hash, inventoryGraph, packageRoot, assertSingleton } from "./inventory.js";
import type { ModuleManifest } from "./materialize.js";

export interface CompileResult {
  status: "compiled" | "refused"; compiler: { version: string; entrySha256: string };
  diagnostics: { code: number; message: string; file?: string; start?: number }[];
  bundle: { version: string; entrySha256: string; sha256?: string; errors: string[] };
  metafile?: Metafile; edges: ReturnType<typeof inventoryGraph>; closureError?: string;
  bindings: Readonly<Record<string, string>>; evidenceClass: ModuleManifest["status"];
}
/** Always run both real tools. A bundle cannot override failed type diagnostics. */
export async function compileFixture(manifest: ModuleManifest, entries: readonly string[]): Promise<CompileResult> {
  const root = manifest.root;
  const assertBytes = () => { for (const file of manifest.files) if (fileHash(resolve(root, file.path)) !== file.sha256) throw new Error(`materialized byte differs before/after compilation: ${file.path}`); };
  assertBytes();
  if (entries.length !== 1) throw new Error("one exact host entry is required per browser bundle");
  const configPath = resolve(root, "tsconfig.json");
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, "\n"));
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root, undefined, configPath);
  if (!parsed.options.strict || !parsed.options.noEmit || parsed.options.skipLibCheck !== false || parsed.options.module !== ts.ModuleKind.ESNext || parsed.options.moduleResolution !== ts.ModuleResolutionKind.Bundler || parsed.options.paths) throw new Error("fixture compiler configuration differs from strict bundler contract");
  const program = ts.createProgram({ rootNames: parsed.fileNames, options: parsed.options });
  const diagnostics = [...parsed.errors, ...ts.getPreEmitDiagnostics(program)].map(diagnostic => ({ code: diagnostic.code, message: ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"), ...(diagnostic.file ? { file: diagnostic.file.fileName, start: diagnostic.start } : {}) }));
  const result: CompileResult = { status: "refused", compiler: { version: ts.version, entrySha256: fileHash(resolve(packageRoot(resolveTypeScript()).root, "lib/typescript.js")) }, diagnostics, bundle: { version: "unavailable", entrySha256: "unavailable", errors: [] }, edges: [], bindings: manifest.bindings, evidenceClass: manifest.status };
  try { result.edges = inventoryGraph(root, parsed.fileNames); }
  catch (error) { result.closureError = String(error); }
  const esbuild = await import("esbuild");
  result.bundle.version = esbuild.version;
  result.bundle.entrySha256 = fileHash(new URL(import.meta.resolve("esbuild")).pathname);
  try {
    const bundled = await build({ absWorkingDir: root, entryPoints: [...entries], bundle: true, platform: "browser", format: "esm", write: false, metafile: true, outdir: "bundle", logLevel: "silent" });
    result.metafile = bundled.metafile;
    const code = bundled.outputFiles.map(file => file.text).join("\n");
    result.bundle.sha256 = hash(code);
    writeFileSync(resolve(root, "bundle.js"), code);
    const roots = Object.keys(bundled.metafile.inputs).filter(path => /node_modules\/(?:react|react-aria-components)\//.test(path)).map(path => {
      const actual = resolve(root, path); const found = packageRoot(actual);
      return { specifier: String(found.data.name), packageRoot: found.root };
    });
    assertSingleton(result.edges); assertSingleton(roots);
  } catch (error) { result.bundle.errors.push(String(error)); }
  assertBytes();
  if (!diagnostics.length && !result.closureError && !result.bundle.errors.length) result.status = "compiled";
  writeFileSync(resolve(root, "compile-diagnostics.json"), JSON.stringify(result, null, 2));
  if (result.metafile) writeFileSync(resolve(root, "bundle-metafile.json"), JSON.stringify(result.metafile, null, 2));
  return result;
}
function resolveTypeScript(): string { return new URL(import.meta.resolve("typescript")).pathname; }

export function strictConfig(files: readonly string[]): string {
  return JSON.stringify({ compilerOptions: { target: "ES2022", strict: true, noEmit: true, module: "ESNext", moduleResolution: "Bundler", jsx: "react-jsx", skipLibCheck: false, types: [], lib: ["ES2022", "DOM", "DOM.Iterable"] }, files }, null, 2);
}
