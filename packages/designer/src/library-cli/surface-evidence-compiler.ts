/** Independent host compiler. Its input is the exact selected source closure, never a fixture. */
import ts from "typescript";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { installedSurfaceDependency } from "./surface-installed-dependencies.js";

const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const require = createRequire(import.meta.url);
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const virtualRoot = join(packageRoot, ".surface-evidence");
let text = "";
for await (const chunk of process.stdin) text += chunk;
const request = JSON.parse(text) as { modules?: string[]; files?: Record<string, string> };
const options: ts.CompilerOptions = { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, jsx: ts.JsxEmit.ReactJSX, strict: true, skipLibCheck: true, esModuleInterop: true, types: [], rootDir: virtualRoot, outDir: join(virtualRoot, "compiled"), noEmitOnError: true };
const inputs = new Map<string, string>();
const host = ts.createCompilerHost(options);
const originalRead = host.readFile, originalExists = host.fileExists, originalDirectory = host.directoryExists;
const files = new Map(Object.entries(request.files ?? {}).map(([name, content]) => [join(virtualRoot, name), content]));
host.readFile = name => {
  const content = files.get(name) ?? originalRead(name);
  if (content !== undefined) inputs.set(name, content);
  return content;
};
host.fileExists = name => files.has(name) || originalExists(name);
host.directoryExists = name => [...files.keys()].some(file => file.startsWith(name + "/")) || !!originalDirectory?.(name);
host.getSourceFile = (name, languageVersion) => {
  const content = host.readFile(name);
  return content === undefined ? undefined : ts.createSourceFile(name, content, languageVersion, true);
};
const outputs: Record<string, string> = {};
host.writeFile = (name, content) => { outputs[relative(options.outDir!, name).split("\\").join("/")] = content; };
if (request.modules) {
  const roots = request.modules.map(module => {
    const resolved = ts.resolveModuleName(module, join(virtualRoot, "index.ts"), options, host).resolvedModule;
    if (!resolved) throw new Error(`Native surface dependency declarations unavailable: ${module}`);
    return resolved.resolvedFileName;
  });
  const program = ts.createProgram(roots, { ...options, rootDir: undefined, noEmit: true }, host);
  const checker = program.getTypeChecker();
  const packages = [], dependencies = [];
  for (const [index, module] of request.modules.entries()) {
    const scoped = module.startsWith("@"), name = module.split("/").slice(0, scoped ? 2 : 1).join("/");
    const entry = fileURLToPath(import.meta.resolve(module));
    let directory = dirname(entry), manifest: { name?: string; version?: string; license?: string } | undefined;
    for (;;) {
      try { const found = JSON.parse(readFileSync(join(directory, "package.json"), "utf8")); if (found.name === name) { manifest = found; break; } } catch { /* Walk to the owning installed manifest. */ }
      if (dirname(directory) === directory) throw new Error(`Native surface dependency manifest unavailable: ${module}`);
      directory = dirname(directory);
    }
    if (!manifest?.version || typeof manifest.license !== "string") throw new Error(`Native surface dependency identity unavailable: ${module}`);
    const source = program.getSourceFile(roots[index]!)!;
    const symbol = checker.getSymbolAtLocation(source);
    if (!symbol) throw new Error(`Native surface dependency type exports unavailable: ${module}`);
    const installed = await installedSurfaceDependency(module);
    const values = installed.values;
    const types = checker.getExportsOfModule(symbol).map(symbol => symbol.name).filter(name => !values.includes(name)).sort();
    // The installed manifest, runtime entry and the actual declaration inputs authenticate this inventory.
    packages.push({ module, version: manifest.version, artifactSha256: installed.artifactSha256, values, types });
    dependencies.push(installed.dependency);
  }
  process.stdout.write(JSON.stringify({ packages, dependencies }));
} else {
  const program = ts.createProgram([...files.keys()], options, host);
  const diagnostics = ts.getPreEmitDiagnostics(program);
  if (diagnostics.length) {
    process.stderr.write(ts.formatDiagnosticsWithColorAndContext(diagnostics, { getCurrentDirectory: () => packageRoot, getCanonicalFileName: name => name, getNewLine: () => "\n" }));
    process.exitCode = 1;
  } else {
    const emitted = program.emit();
    if (emitted.emitSkipped || emitted.diagnostics.length || !Object.keys(outputs).length) throw new Error("Native surface compiler did not emit a complete program.");
    const compilerEntry = require.resolve("typescript");
    const manifest = { version: ts.version, node: process.version, compilerSha256: hash(readFileSync(compilerEntry, "utf8")), options: { ...options, rootDir: relative(packageRoot, options.rootDir!), outDir: relative(packageRoot, options.outDir!) }, inputs: [...inputs].map(([path, content]) => ({ path: relative(packageRoot, path).split("\\").join("/"), sha256: hash(content) })).sort((a, b) => a.path.localeCompare(b.path)) };
    process.stdout.write(JSON.stringify({ outputs, manifest }));
  }
}
