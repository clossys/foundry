import ts from "typescript";
import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { builtinModules } from "node:module";
import { dirname, extname, isAbsolute, join, posix, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { CompositeLibraryData } from "@clossys/designer/catalog";
import { loadCatalogBundles } from "@clossys/designer/catalog-bundles";
import type { SourceImport, SourceModule, SourceRequest, SourceResolution } from "@clossys/designer/components/source-closure";
import { appLocalHash } from "./format.js";

const syntax = (source: SourceModule) => ts.createSourceFile(source.path, source.content, ts.ScriptTarget.Latest, true, source.path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
const importedName = (name: ts.ModuleExportName): string => name.text;
/** Static imports, re-exports, import types, require and dynamic import all enter the same closed graph. */
export function analyzeAppLocalSource(source: SourceModule): SourceImport[] {
  if (source.path.endsWith(".css")) return [...source.content.matchAll(/@import\s+(?:url\(\s*)?(["'])([^"']+)\1/g)].map(match => {
    const start = match.index! + match[0].indexOf(match[1]!); return { specifier: match[2]!, start, end: start + match[2]!.length + 2 };
  });
  const file = syntax(source), result: SourceImport[] = [];
  const add = (literal: ts.Expression | ts.TypeNode, names: string[]) => {
    if (!ts.isStringLiteralLike(literal)) throw new Error(`Nonliteral module loading is unsupported in ${source.path}`);
    result.push({ specifier: literal.text, start: literal.getStart(file), end: literal.getEnd(), names });
  };
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) {
      const names: string[] = [], clause = node.importClause;
      if (clause?.name) names.push("default");
      if (clause?.namedBindings) {
        if (ts.isNamespaceImport(clause.namedBindings)) names.push("*");
        else for (const item of clause.namedBindings.elements) names.push(importedName(item.propertyName ?? item.name));
      }
      add(node.moduleSpecifier, names); return;
    }
    if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
      add(node.moduleSpecifier, node.exportClause && ts.isNamedExports(node.exportClause) ? node.exportClause.elements.map(item => importedName(item.propertyName ?? item.name)) : ["*"]); return;
    }
    if (ts.isImportTypeNode(node)) {
      if (!ts.isLiteralTypeNode(node.argument)) throw new Error("Nonliteral import type is unsupported");
      const qualifier = node.qualifier; let name = qualifier;
      while (name && ts.isQualifiedName(name)) name = name.left;
      add(node.argument.literal, name && ts.isIdentifier(name) ? [name.text] : ["*"]); return;
    }
    if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || ts.isIdentifier(node.expression) && node.expression.text === "require")) {
      if (node.arguments.length !== 1 || !node.arguments[0]) throw new Error("Expected one literal module argument");
      add(node.arguments[0], ["*"]); return;
    }
    ts.forEachChild(node, visit);
  };
  visit(file); return result;
}
const relocated = (text: string): string => text.replaceAll("@clossys/", "app-local/").replaceAll("@clossys", "app-local");
/** Relocation changes package identity literals consistently as well as removing source comments. Imports have already been resolved. */
export function printAppLocalSource(content: string, source: SourceModule): string {
  if (source.path.endsWith(".css")) return relocated(content.replace(/\/\*[\s\S]*?\*\//g, ""));
  const file = syntax({ ...source, content });
  const transformed = ts.transform(file, [context => root => {
    const visit: ts.Visitor = node => {
      if (ts.isStringLiteral(node) && node.text.startsWith(".") && /\.tsx?$/.test(node.text) && (ts.isImportDeclaration(node.parent) || ts.isExportDeclaration(node.parent) || ts.isCallExpression(node.parent) || ts.isLiteralTypeNode(node.parent))) return ts.factory.createStringLiteral(node.text.replace(/\.tsx?$/, ""));
      if (ts.isStringLiteral(node) && node.text.includes("@clossys")) return ts.factory.createStringLiteral(relocated(node.text));
      if (ts.isNoSubstitutionTemplateLiteral(node) && node.text.includes("@clossys")) return ts.factory.createNoSubstitutionTemplateLiteral(relocated(node.text));
      if (ts.isTemplateHead(node) && node.text.includes("@clossys")) return ts.factory.createTemplateHead(relocated(node.text));
      if (ts.isTemplateMiddle(node) && node.text.includes("@clossys")) return ts.factory.createTemplateMiddle(relocated(node.text));
      if (ts.isTemplateTail(node) && node.text.includes("@clossys")) return ts.factory.createTemplateTail(relocated(node.text));
      if (ts.isRegularExpressionLiteral(node) && node.text.includes("@clossys")) return ts.factory.createRegularExpressionLiteral(relocated(node.text));
      if (ts.isJsxText(node) && node.text.includes("@clossys")) return ts.factory.createJsxText(relocated(node.text));
      if (ts.isImportDeclaration(node) && node.attributes && ts.isStringLiteralLike(node.moduleSpecifier) && /\.tsx?$/.test(node.moduleSpecifier.text)) return ts.factory.updateImportDeclaration(node, node.modifiers, node.importClause, ts.factory.createStringLiteral(node.moduleSpecifier.text.replace(/\.tsx?$/, "")), undefined);
      return ts.visitEachChild(node, visit, context);
    };
    return ts.visitNode(root, visit) as ts.SourceFile;
  }]);
  try { return ts.createPrinter({ removeComments: true, newLine: ts.NewLineKind.LineFeed }).printFile(transformed.transformed[0] as ts.SourceFile); }
  finally { transformed.dispose(); }
}
interface PackageManifest { name: string; exports?: unknown; dependencies?: Record<string, string>; peerDependencies?: Record<string, string>; optionalDependencies?: Record<string, string> }
interface Origin { absolute: string; root: string; manifest: PackageManifest }
function safeFile(path: string): string {
  const absolute = resolve(path);
  for (let current = absolute; ; current = dirname(current)) {
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) throw new Error("Source symbolic links are unsupported");
    if (dirname(current) === current) break;
  }
  if (!existsSync(absolute) || !lstatSync(absolute).isFile()) throw new Error(`Missing source file ${posix.basename(path)}`);
  return absolute;
}
function sourceFile(path: string): string {
  const candidates = [path, path.replace(/\.js$/, ".ts"), path.replace(/\.js$/, ".tsx"), `${path}.ts`, `${path}.tsx`, `${path}.js`, join(path, "index.ts"), join(path, "index.tsx"), join(path, "index.js")];
  const selected = candidates.find(candidate => existsSync(candidate) && lstatSync(candidate).isFile());
  if (!selected) throw new Error(`Missing source module ${posix.basename(path)}`);
  return safeFile(selected);
}
const packageName = (specifier: string): string => specifier.startsWith("@") ? specifier.split("/").slice(0, 2).join("/") : specifier.split("/")[0]!;
function condition(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const record = value as Record<string, unknown>;
  for (const key of ["react-server", "node", "import", "default"]) { const result = condition(record[key]); if (result) return result; }
}
/** Resolve installed source offline; selected component ownership is enforced on every returned module. */
export function appLocalSourceResolver(library: CompositeLibraryData, appRoot: string, dependencies: Readonly<Record<string, string>>) {
  const origins = new Map<string, Origin>(), packages = new Map<string, { root: string; manifest: PackageManifest }>();
  const knownOwners = new Map<string, string>(), knownSlots = new Set<string>();
  for (const document of [...loadCatalogBundles().componentFills, ...library.components.fills]) {
    for (const fill of Object.values(document.components)) {
      knownSlots.add(fill.slot);
      if (fill.impl.kind === "package") for (const name of [fill.impl.export, ...(fill.secondaryExports?.map(entry => entry.export) ?? [])]) knownOwners.set(`${fill.impl.module}#${name}`, fill.slot);
    }
  }
  function installed(name: string, specifier: string) {
    const cached = packages.get(name); if (cached) return cached;
    let entry: string;
    if (name === "@clossys/publisher") entry = fileURLToPath(new URL("../../", import.meta.url));
    else {
      // Package roots are found from the ordinary installed public entry, preserving the workspace's existing resolution.
      entry = fileURLToPath(import.meta.resolve(specifier));
    }
    entry = realpathSync(entry); let root = lstatSync(entry).isDirectory() ? entry : dirname(entry);
    for (;;) {
      const manifestPath = join(root, "package.json");
      if (existsSync(manifestPath)) {
        const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as PackageManifest;
        if (manifest.name === name) { const found = { root, manifest }; packages.set(name, found); return found; }
      }
      const parent = dirname(root); if (parent === root) throw new Error("Installed package source root is unavailable"); root = parent;
    }
  }
  function narrow(content: string, path: string, names: readonly string[]): string {
    if (!names.length || names.includes("*")) return content;
    const file = syntax({ path, content });
    // Preserve initialization and local declarations; only prune explicit re-exports of unrelated names.
    if (!file.statements.some(statement => ts.isExportDeclaration(statement) && statement.moduleSpecifier)) return content;
    const wanted = new Set(names), kept: string[] = [];
    for (const statement of file.statements) {
      if (!ts.isExportDeclaration(statement) || !statement.moduleSpecifier) { kept.push(statement.getFullText(file)); continue; }
      if (!statement.exportClause) { kept.push(statement.getFullText(file)); continue; }
      if (!ts.isNamedExports(statement.exportClause)) throw new Error("Unsupported namespace barrel export");
      const elements = statement.exportClause.elements.filter(item => wanted.has(item.name.text));
      if (!elements.length) continue;
      const updated = ts.factory.updateExportDeclaration(statement, statement.modifiers, statement.isTypeOnly, ts.factory.updateNamedExports(statement.exportClause, elements), statement.moduleSpecifier, statement.attributes);
      kept.push(ts.createPrinter({ removeComments: true }).printNode(ts.EmitHint.Unspecified, updated, file));
    }
    if (!kept.length) throw new Error("Requested named export is missing from source barrel");
    return kept.join("\n") + "\n";
  }
  function packageModule(absolute: string, root: string, manifest: PackageManifest, names: readonly string[], publicSpecifier?: string): SourceModule {
    const raw = readFileSync(safeFile(absolute), "utf8"), rel = relative(root, absolute).split(sep).join("/");
    if (isAbsolute(rel) || rel.startsWith("../")) throw new Error("Source import escapes installed package");
    let path = `components/_vendor/${manifest.name.replace(/^@[^/]+\//, "")}/${rel}`, content = raw;
    if (absolute.endsWith(".json")) { path = path.replace(/\.json$/, ".json-data.ts"); content = `export default ${JSON.stringify(JSON.parse(raw))} as const;\n`; }
    else { content = narrow(raw, path, names); if (content !== raw) path = path.replace(/(\.[^.]+)$/, `-${appLocalHash([...names].sort().join("\n")).slice(0, 12)}$1`); }
    const slot = names.map(name => publicSpecifier ? knownOwners.get(`${publicSpecifier}#${name}`) : knownOwners.get(`${manifest.name}/components#${name}`) ?? knownOwners.get(`${manifest.name}/components/server#${name}`)).find(Boolean);
    // A shipped top-level component is a frozen leaf, even when reached through a relative import.
    let ownerSlot = slot;
    const componentDirectory = /^src\/components\/([a-z][a-z0-9-]*)\//.exec(rel)?.[1];
    if (manifest.name === "@clossys/designer" && componentDirectory && knownSlots.has(`components.${componentDirectory}`)) ownerSlot = `components.${componentDirectory}`;
    if (manifest.name === "@clossys/designer" && /^src\/components\/[A-Z][^/]*\.tsx$/.test(rel)) {
      const exportName = rel.split("/").at(-1)!.replace(/\.tsx$/, "");
      ownerSlot = knownOwners.get(`@clossys/designer/components#${exportName}`) ?? knownOwners.get(`@clossys/designer/components/server#${exportName}`) ?? `components.${exportName.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase()}`;
    }
    const module: SourceModule = { path, content, origin: "installed", ...(ownerSlot ? { ownerSlot } : {}) }; origins.set(path, { absolute, root, manifest }); return module;
  }
  function resolveModule(request: SourceRequest): SourceResolution {
    const { specifier, importer, names, files } = request;
    if (specifier.startsWith("node:") || builtinModules.includes(specifier)) return { kind: "builtin" };
    if (/^(?:https?:|data:)/.test(specifier)) throw new Error("Remote source modules are unsupported");
    if (specifier.startsWith(".")) {
      if (!importer) throw new Error("Relative source needs an importer");
      const localPath = posix.normalize(posix.join(posix.dirname(importer.path), specifier));
      const candidates = [localPath, localPath.replace(/\.js$/, ".ts"), localPath.replace(/\.js$/, ".tsx"), `${localPath}.ts`, `${localPath}.tsx`, `${localPath}/index.ts`, `${localPath}/index.tsx`];
      const local = candidates.find(path => files.has(path));
      if (local) return { kind: "source", module: { path: local, content: files.get(local)! } };
      const origin = origins.get(importer.path);
      if (origin) return { kind: "source", module: packageModule(sourceFile(resolve(dirname(origin.absolute), specifier)), origin.root, origin.manifest, names) };
      const absolute = sourceFile(resolve(appRoot, localPath));
      const rel = relative(resolve(appRoot), absolute);
      if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error("Consumer source escapes app root");
      const path = `components/_consumer/${rel.split(sep).join("/")}`;
      const module: SourceModule = { path, content: readFileSync(absolute, "utf8"), origin: "consumer" }; origins.set(path, { absolute, root: appRoot, manifest: { name: "consumer", dependencies: { ...dependencies } } });
      return { kind: "source", module };
    }
    if (specifier.startsWith("@clossys/")) {
      const name = packageName(specifier), pkg = installed(name, specifier), subpath = specifier === name ? "." : `.${specifier.slice(name.length)}`;
      const exports = pkg.manifest.exports;
      const target = typeof exports === "string" && subpath === "." ? exports : exports && typeof exports === "object" ? condition((exports as Record<string, unknown>)[subpath]) : undefined;
      if (!target) throw new Error("First-party source export is unavailable");
      const relativeSource = target.replace(/^\.\/dist\//, "src/").replace(/\.js$/, "");
      return { kind: "source", module: packageModule(sourceFile(join(pkg.root, relativeSource)), pkg.root, pkg.manifest, names, specifier) };
    }
    const name = packageName(specifier), origin = importer ? origins.get(importer.path) : undefined;
    const manifest = origin?.manifest;
    const versions = [manifest?.dependencies?.[name], manifest?.peerDependencies?.[name], manifest?.optionalDependencies?.[name], dependencies[name]].filter((value): value is string => typeof value === "string");
    const version = versions[0]; if (!version) throw new Error(`Undeclared third-party source dependency: ${name}`);
    return { kind: "dependency", name, version };
  }
  return resolveModule;
}
