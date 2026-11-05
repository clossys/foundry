/** Node-only independent artifact inspection; descriptor export claims are never inputs. */
import { createHash } from "node:crypto";
import { readFileSync, realpathSync, existsSync } from "node:fs";
import { dirname, resolve, relative, sep } from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { isBuiltin } from "node:module";
import { gunzipSync } from "node:zlib";
import ts from "typescript";

export const hash = (bytes: string | Uint8Array): string => createHash("sha256").update(bytes).digest("hex");
export const fileHash = (path: string): string => hash(readFileSync(path));
export function inside(root: string, path: string): boolean {
  const suffix = relative(resolve(root), resolve(path));
  return suffix === "" || (!suffix.startsWith(`..${sep}`) && suffix !== ".." && !suffix.startsWith(sep));
}
export interface ImportEdge {
  from: string; specifier: string; names: { name: string; typeOnly: boolean }[];
  typeOnly: boolean; resolved?: string; packageRoot?: string;
}
export interface DependencyArtifact {
  specifier: string; name: string; version: string; root: string; exports: unknown;
  entry: string; entrySha256: string; packageSha256: string; integrity: string;
  typeEntry: string; typeSha256: string; runtimeNames: string[]; typeNames: string[];
  compiledFiles: { path: string; sha256: string }[];
  closureStatus: "observed" | "refused"; closureError?: string;
  archive?: { path: string; sha256: string; inventorySha256: string };
}
export function staticImports(path: string, content = readFileSync(path, "utf8"), dependencyLiterals = false): ImportEdge[] {
  const source = ts.createSourceFile(path, content, ts.ScriptTarget.Latest, true);
  const edges: ImportEdge[] = [];
  const visit = (node: ts.Node): void => {
    if (!dependencyLiterals && ts.isModuleDeclaration(node) && ts.isStringLiteral(node.name)) throw new Error(`ambient module stub is not an installed artifact: ${path}`);
    if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === "require"))) {
      const argument = node.arguments[0];
      if (dependencyLiterals && node.arguments.length === 1 && argument && ts.isStringLiteral(argument)) {
        edges.push({ from: path, specifier: argument.text, names: [], typeOnly: false });
      } else throw new Error(`dynamic import is not a closed static graph: ${path}`);
    }
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
      if (!ts.isStringLiteral(node.moduleSpecifier)) throw new Error(`nonliteral module: ${path}`);
      const names: ImportEdge["names"] = [];
      let typeOnly = false;
      if (ts.isImportDeclaration(node)) {
        typeOnly = node.importClause?.isTypeOnly ?? false;
        if (node.importClause?.name) names.push({ name: "default", typeOnly });
        const bindings = node.importClause?.namedBindings;
        if (bindings && ts.isNamedImports(bindings)) for (const binding of bindings.elements) {
          names.push({ name: (binding.propertyName ?? binding.name).text, typeOnly: typeOnly || binding.isTypeOnly });
        }
        if (bindings && ts.isNamespaceImport(bindings)) names.push({ name: "*", typeOnly });
      } else {
        typeOnly = node.isTypeOnly;
        if (node.exportClause && ts.isNamedExports(node.exportClause)) for (const binding of node.exportClause.elements) {
          names.push({ name: (binding.propertyName ?? binding.name).text, typeOnly: typeOnly || binding.isTypeOnly });
        }
        else {
          if (!dependencyLiterals) throw new Error(`wildcard consumer export is not an inspected surface: ${path}`);
          names.push({ name: "*", typeOnly });
        }
      }
      edges.push({ from: path, specifier: node.moduleSpecifier.text, names, typeOnly });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return edges;
}

const options: ts.CompilerOptions = { module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, jsx: ts.JsxEmit.ReactJSX, strict: true, skipLibCheck: false };
export function resolveType(specifier: string, from: string): string {
  const resolution = ts.resolveModuleName(specifier, from, options, ts.sys).resolvedModule;
  if (!resolution) throw new Error(`missing type target ${specifier} from ${from}`);
  return realpathSync(resolution.resolvedFileName);
}
/** Node's import conditions, evaluated at the actual caller directory, independently of TS. */
export function resolveRuntime(specifier: string, from: string): string {
  const key = `${dirname(from)}\0${specifier}`;
  const cached = runtimeResolutionCache.get(key);
  if (cached && existsSync(cached)) return realpathSync(cached);
  const run = spawnSync(process.execPath, ["--input-type=module", "--eval", "console.log(import.meta.resolve(process.argv[1]))", specifier], { cwd: dirname(from), encoding: "utf8", timeout: 10_000 });
  if (run.status !== 0) throw new Error(`missing runtime target ${specifier} from ${from}: ${run.stderr}`);
  const url = new URL(run.stdout.trim());
  if (url.protocol !== "file:") throw new Error(`non-file runtime target ${specifier}`);
  const resolved = realpathSync(decodeURIComponent(url.pathname));
  runtimeResolutionCache.set(key, resolved);
  return resolved;
}
const runtimeResolutionCache = new Map<string, string>();
export function packageRoot(entry: string): { root: string; data: Record<string, unknown> } {
  let cursor = dirname(realpathSync(entry));
  for (;;) {
    const file = resolve(cursor, "package.json");
    if (existsSync(file)) return { root: cursor, data: JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown> };
    const parent = dirname(cursor);
    if (parent === cursor) throw new Error(`package root unavailable: ${entry}`);
    cursor = parent;
  }
}
export function declaredNames(entry: string): { values: string[]; types: string[] } {
  const program = ts.createProgram([entry], options);
  const source = program.getSourceFile(entry);
  const checker = program.getTypeChecker();
  const symbol = source && checker.getSymbolAtLocation(source);
  if (!symbol) throw new Error(`declaration module unavailable: ${entry}`);
  const values: string[] = [], types: string[] = [];
  for (const exported of checker.getExportsOfModule(symbol)) {
    const target = exported.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exported) : exported;
    if (target.flags & ts.SymbolFlags.Value) values.push(exported.name);
    if (target.flags & ts.SymbolFlags.Type) types.push(exported.name);
  }
  return { values: values.sort(), types: types.sort() };
}
/** All reachable compiled static files, including package-to-package edges. No guessed export list. */
export function compiledInventory(entry: string): DependencyArtifact["compiledFiles"] {
  const seen = new Set<string>(); const queue = [entry];
  while (queue.length) {
    const next = realpathSync(queue.shift()!);
    if (seen.has(next)) continue;
    if (seen.size >= 10_000) throw new Error("compiled inventory exceeds bounded closure");
    seen.add(next);
    if (!/\.[cm]?js$/.test(next)) continue;
    // Dependency internals may use require/dynamic imports. Preserve the file inventory,
    // and refuse unsupported edges rather than silently declaring their closure complete.
    for (const edge of staticImports(next, readFileSync(next, "utf8"), true)) {
      if (isBuiltin(edge.specifier) || edge.typeOnly) continue;
      queue.push(resolveRuntime(edge.specifier, next));
    }
  }
  return [...seen].sort().map(path => ({ path, sha256: fileHash(path) }));
}
export async function inspectDependency(specifier: string, from: string, lockPath: string, archive?: { path: string; sha256: string; root: string }): Promise<DependencyArtifact> {
  const entry = resolveRuntime(specifier, from), typeEntry = resolveType(specifier, from);
  const { root, data } = packageRoot(entry);
  const name = String(data.name), version = String(data.version);
  const lock = JSON.parse(readFileSync(lockPath, "utf8")) as { packages: Record<string, { name?: string; version?: string; integrity?: string }> };
  const matching = Object.entries(lock.packages).filter(([path, row]) => (path === `node_modules/${name}` || path.endsWith(`/node_modules/${name}`)) && row.version === version);
  const integrities = [...new Set(matching.map(([, row]) => row.integrity).filter((value): value is string => !!value))];
  let archiveProof: DependencyArtifact["archive"];
  if (archive) {
    if (root !== realpathSync(archive.root) || specifier !== `${name}/components`) throw new Error("selected package is not the exact public archive artifact");
    archiveProof = { path: archive.path, sha256: archive.sha256, inventorySha256: verifyPackedArtifact(archive.path, archive.sha256, root) };
  } else if (integrities.length !== 1) throw new Error(`installed artifact is not uniquely bound by accepted lock: ${name}@${version}`);
  const namespace: Record<string, unknown> = await import(pathToFileURL(entry).href);
  const declared = declaredNames(typeEntry);
  let compiledFiles: DependencyArtifact["compiledFiles"] = [], closureError: string | undefined;
  try { compiledFiles = compiledInventory(entry); } catch (error) { closureError = String(error); }
  return { specifier, name, version, root, exports: data.exports ?? null, entry, entrySha256: fileHash(entry), packageSha256: fileHash(resolve(root, "package.json")), integrity: archiveProof ? `sha256:${archiveProof.sha256}` : integrities[0]!, typeEntry, typeSha256: fileHash(typeEntry), runtimeNames: Object.keys(namespace).sort(), typeNames: declared.types, compiledFiles, closureStatus: closureError ? "refused" : "observed", ...(closureError ? { closureError } : {}), ...(archiveProof ? { archive: archiveProof } : {}) };
}
/** Verify every regular packed byte against an existing extraction; never trusts a directory label. */
export function verifyPackedArtifact(archivePath: string, expectedSha256: string, extractedRoot: string): string {
  if (fileHash(archivePath) !== expectedSha256) throw new Error("selected package archive identity differs");
  const bytes = gunzipSync(readFileSync(archivePath), { maxOutputLength: 64 * 1024 * 1024 });
  const files: { path: string; sha256: string }[] = []; const seen = new Set<string>();
  const string = (buffer: Buffer): string => buffer.toString("utf8").split("\0")[0]!;
  for (let offset = 0; offset + 512 <= bytes.length;) {
    const header = bytes.subarray(offset, offset + 512);
    if (header.every(byte => byte === 0)) break;
    const name = string(header.subarray(0, 100)), prefix = string(header.subarray(345, 500));
    const full = prefix ? `${prefix}/${name}` : name;
    const sizeText = string(header.subarray(124, 136)).trim();
    if (!/^[0-7]+$/.test(sizeText)) throw new Error("unsupported packed size encoding");
    const size = parseInt(sizeText, 8), type = header[156];
    const relativeName = full.replace(/^package\//, "");
    if (!full.startsWith("package/") || relativeName.split("/").includes("..") || seen.has(relativeName)) throw new Error("unsafe packed artifact path");
    seen.add(relativeName);
    const target = resolve(extractedRoot, relativeName);
    if (!inside(extractedRoot, target)) throw new Error("packed artifact escapes extraction");
    if (type === 0 || type === 48) {
      const content = bytes.subarray(offset + 512, offset + 512 + size);
      if (content.length !== size || !inside(realpathSync(extractedRoot), realpathSync(target)) || !readFileSync(target).equals(content)) throw new Error(`packed artifact byte differs: ${relativeName}`);
      files.push({ path: relativeName, sha256: hash(content) });
    } else if (type !== 53) throw new Error("non-regular packed artifact entry");
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  if (!files.length) throw new Error("packed artifact inventory unavailable");
  return hash(JSON.stringify(files.sort((a, b) => a.path.localeCompare(b.path))));
}
export function assertNamedImport(artifact: Pick<DependencyArtifact, "runtimeNames" | "typeNames">, name: string, typeOnly: boolean): void {
  if (name === "*") throw new Error("wildcard consumer imports do not establish a named surface");
  if (typeOnly ? !artifact.typeNames.includes(name) : !artifact.runtimeNames.includes(name)) {
    throw new Error(`${typeOnly ? "missing type export" : "missing runtime export"}: ${name}`);
  }
}
export function assertSingleton(edges: readonly Pick<ImportEdge, "specifier" | "packageRoot">[]): void {
  for (const name of ["react", "react-aria-components"]) {
    const roots = new Set(edges.filter(edge => edge.specifier === name || edge.specifier.startsWith(`${name}/`)).map(edge => edge.packageRoot));
    if (roots.size !== 1 || roots.has(undefined)) throw new Error(`physical singleton identity differs: ${name}`);
  }
}
export function inventoryGraph(root: string, files: readonly string[]): ImportEdge[] {
  const result: ImportEdge[] = [];
  for (const file of files.filter(file => /\.[cm]?tsx?$/.test(file))) for (const edge of staticImports(file)) {
    if (/\.d\.[cm]?ts$/.test(file)) throw new Error(`ambient declaration supplied as source: ${file}`);
    if (isBuiltin(edge.specifier)) throw new Error(`Node import in browser fixture: ${edge.specifier}`);
    const target = resolveType(edge.specifier, file);
    if (edge.specifier.startsWith(".") && !inside(root, target)) throw new Error(`relative import escapes fixture: ${edge.specifier}`);
    if (edge.specifier.startsWith(".") && !files.some(path => realpathSync(path) === target)) throw new Error(`missing file in materialized closure: ${target}`);
    result.push({ ...edge, resolved: target, ...(edge.specifier.startsWith(".") ? {} : { packageRoot: packageRoot(resolveRuntime(edge.specifier, file)).root }) });
  }
  return result;
}
