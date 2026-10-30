import ts from "typescript";
import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { builtinModules } from "node:module";
import { dirname, isAbsolute, join, posix, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { CompositeLibraryData } from "@clossys/designer/catalog";
import { loadCatalogBundles } from "@clossys/designer/catalog-bundles";
import type { SourceImport, SourceModule, SourceRequest, SourceResolution } from "@clossys/designer/components/source-closure";
import { mergeSourceDependencyRanges } from "@clossys/designer/components/source-closure";
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
/** Inspect application source without refusing unrelated dynamic imports. */
export function firstPartyAppImports(source: SourceModule): readonly string[] {
  const file = syntax(source), references = new Set<string>();
  const add = (node: ts.Node | undefined) => { if (node && ts.isStringLiteralLike(node) && node.text.startsWith("@clossys/")) references.add(node.text); };
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) add(node.moduleSpecifier);
    else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) add(node.argument.literal);
    else if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || ts.isIdentifier(node.expression) && node.expression.text === "require" || ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "resolve")) add(node.arguments[0]);
    ts.forEachChild(node, visit);
  };
  visit(file); return [...references];
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
      if (ts.isExportDeclaration(node) && node.attributes && node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier) && /\.tsx?$/.test(node.moduleSpecifier.text)) return ts.factory.updateExportDeclaration(node, node.modifiers, node.isTypeOnly, node.exportClause, ts.factory.createStringLiteral(node.moduleSpecifier.text.replace(/\.tsx?$/, "")), undefined);
      return ts.visitEachChild(node, visit, context);
    };
    return ts.visitNode(root, visit) as ts.SourceFile;
  }]);
  try { return ts.createPrinter({ removeComments: true, newLine: ts.NewLineKind.LineFeed }).printFile(transformed.transformed[0] as ts.SourceFile); }
  finally { transformed.dispose(); }
}
interface PackageManifest { name: string; exports?: unknown; imports?: Record<string, unknown>; dependencies?: Record<string, string>; peerDependencies?: Record<string, string>; optionalDependencies?: Record<string, string> }
interface Origin { absolute: string; root: string; manifest: PackageManifest }
function safeFile(path: string): string {
  const absolute = resolve(path);
  for (let current = absolute; ; current = dirname(current)) {
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) throw new Error("Source symbolic links are unsupported");
    if (dirname(current) === current) break;
  }
  if (!existsSync(absolute) || !lstatSync(absolute).isFile()) throw new Error(`Missing source file ${posix.basename(path)}`);
  return realpathSync(absolute);
}
function sourceFile(path: string): string {
  const candidates = [path, path.replace(/\.js$/, ".ts"), path.replace(/\.js$/, ".tsx"), `${path}.ts`, `${path}.tsx`, `${path}.js`, join(path, "index.ts"), join(path, "index.tsx"), join(path, "index.js")];
  const selected = candidates.find(candidate => existsSync(candidate) && lstatSync(candidate).isFile());
  if (!selected) throw new Error(`Missing source module ${posix.basename(path)}`);
  return safeFile(selected);
}
const packageName = (specifier: string): string => specifier.startsWith("@") ? specifier.split("/").slice(0, 2).join("/") : specifier.split("/")[0]!;
function condition(value: unknown, active: ReadonlySet<string>): string | undefined {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  for (const [key, target] of Object.entries(value)) if (key === "default" || active.has(key)) { const found = condition(target, active); if (found) return found; }
}
function normalizedSource(path: string, content: string): { path: string; content: string } {
  return path.endsWith(".json") ? { path: path.replace(/\.json$/, ".json-data.ts"), content: `export default ${JSON.stringify(JSON.parse(content))} as const;\n` } : { path, content };
}
export interface AppLocalResolutionOptions { readonly conditions?: readonly string[] }
/** Resolve actual sources offline. Stateful implementation modules have one identity; only forwarding facades are narrowed. */
export function appLocalSourceResolver(library: CompositeLibraryData, appRoot: string, dependencies: Readonly<Record<string, string>>, options: AppLocalResolutionOptions = {}) {
  const origins = new Map<string, Origin>(), virtual = new Map<string, SourceModule>(), implementations = new Map<string, SourceModule>(), packages = new Map<string, { root: string; manifest: PackageManifest }>();
  const conditions = new Set(options.conditions ?? ["node", "import"]);
  const selectedFills = new Map(library.components.fills.flatMap(document => Object.values(document.components).map(fill => [fill.slot, fill] as const)));
  const knownOwners = new Map<string, string>(), knownSlots = new Set<string>(), selected = new Set(selectedFills.keys());
  for (const document of [...loadCatalogBundles().componentFills, ...library.components.fills]) for (const fill of Object.values(document.components)) {
    knownSlots.add(fill.slot);
    if (fill.impl.kind === "package") for (const name of [fill.impl.export, ...(fill.secondaryExports?.map(entry => entry.export) ?? [])]) knownOwners.set(`${fill.impl.module}#${name}`, fill.slot);
  }
  function confined(root: string, path: string): string {
    const absolute = resolve(path), rel = relative(resolve(root), absolute);
    if (isAbsolute(rel) || rel === ".." || rel.startsWith(`..${sep}`)) throw new Error("Source import escapes its owning root");
    return absolute;
  }
  function installed(name: string, specifier: string) {
    const cached = packages.get(name); if (cached) return cached;
    const entry = realpathSync(name === "@clossys/publisher" ? fileURLToPath(new URL("../../", import.meta.url)) : fileURLToPath(import.meta.resolve(specifier)));
    let root = lstatSync(entry).isDirectory() ? entry : dirname(entry);
    for (;;) {
      const manifestPath = join(root, "package.json");
      if (existsSync(manifestPath)) {
        const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as PackageManifest;
        if (manifest.name === name) { const found = { root, manifest }; packages.set(name, found); return found; }
      }
      const parent = dirname(root); if (parent === root) throw new Error("Installed package source root is unavailable"); root = parent;
    }
  }
  function register(module: SourceModule, origin: Origin): SourceModule { virtual.set(module.path, module); origins.set(module.path, origin); return module; }
  function owner(manifest: PackageManifest, rel: string, names: readonly string[], publicSpecifier?: string): string | undefined {
    if (manifest.name !== "@clossys/designer") return;
    const componentDirectory = /^src\/components\/([a-z][a-z0-9-]*)\//.exec(rel)?.[1];
    if (componentDirectory && knownSlots.has(`components.${componentDirectory}`)) return `components.${componentDirectory}`;
    if (/^src\/components\/[A-Z][^/]*\.tsx$/.test(rel)) {
      const name = rel.split("/").at(-1)!.replace(/\.(?:client|server)\.tsx$/, "").replace(/\.tsx$/, "");
      const known = knownOwners.get(`${manifest.name}/components#${name}`) ?? knownOwners.get(`${manifest.name}/components/server#${name}`);
      const inferred = `components.${name.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase()}`;
      return known ?? (knownSlots.has(inferred) ? inferred : undefined);
    }
    if (publicSpecifier) return names.map(name => knownOwners.get(`${publicSpecifier}#${name}`)).find(Boolean);
  }
  function facade(raw: string, path: string, names: readonly string[], origin: Origin): SourceModule | undefined {
    if (!names.length || names.includes("*")) return;
    const file = syntax({ path, content: raw });
    // Modules containing implementations or local state remain whole and canonical.
    if (!file.statements.every(statement => ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement) && statement.moduleSpecifier !== undefined || ts.isExpressionStatement(statement) || ts.isEmptyStatement(statement))) return;
    const exports = file.statements.filter(ts.isExportDeclaration);
    if (!exports.length || exports.some(statement => !statement.exportClause || !ts.isNamedExports(statement.exportClause))) return;
    const wanted = new Set(names), found = new Set<string>(), forwarded: string[] = [];
    for (const statement of exports) {
      const clause = statement.exportClause as ts.NamedExports;
      const elements = clause.elements.filter(item => wanted.has(item.name.text));
      for (const item of elements) found.add(item.name.text);
      if (!elements.length) continue;
      forwarded.push(ts.createPrinter({ removeComments: true }).printNode(ts.EmitHint.Unspecified, ts.factory.updateExportDeclaration(statement, statement.modifiers, statement.isTypeOnly, ts.factory.updateNamedExports(clause, elements), statement.moduleSpecifier, statement.attributes), file));
    }
    if ([...wanted].some(name => !found.has(name))) throw new Error(`Requested export is absent from source: ${[...wanted].filter(name => !found.has(name)).join(", ")}`);
    const initialization = file.statements.filter(statement => !ts.isExportDeclaration(statement));
    const directives = initialization.filter(statement => ts.isExpressionStatement(statement) && ts.isStringLiteral(statement.expression)).map(statement => statement.getText(file));
    const imports: string[] = [];
    if (initialization.some(statement => !ts.isEmptyStatement(statement) && !directives.includes(statement.getText(file)))) {
      const initPath = path.replace(/(\.[^.]+)$/, ".initialization$1");
      register({ path: initPath, content: initialization.map(statement => statement.getFullText(file)).join("\n") + "\nexport {};\n", origin: "installed" }, origin);
      let relative = posix.relative(posix.dirname(path), initPath); if (!relative.startsWith(".")) relative = `./${relative}`;
      imports.push(`import ${JSON.stringify(relative)};`);
    }
    const facadePath = path.replace(/(\.[^.]+)$/, `.forward-${appLocalHash([...wanted].sort().join("\n")).slice(0, 12)}$1`);
    return register({ path: facadePath, content: [...directives, ...imports, ...forwarded, ""].join("\n"), origin: "installed" }, origin);
  }
  function assertExports(module: SourceModule, names: readonly string[]): void {
    if (!names.length || names.includes("*") || module.path.endsWith(".css")) return;
    const file = syntax(module), available = new Set<string>(); let wildcard = false;
    const binding = (name: ts.BindingName): void => { if (ts.isIdentifier(name)) available.add(name.text); else for (const item of name.elements) if (ts.isBindingElement(item)) binding(item.name); };
    for (const statement of file.statements) {
      if (ts.isExportAssignment(statement)) { available.add("default"); continue; }
      if (ts.isExportDeclaration(statement)) {
        if (!statement.exportClause) wildcard = true;
        else if (ts.isNamedExports(statement.exportClause)) for (const item of statement.exportClause.elements) available.add(item.name.text);
        else available.add(statement.exportClause.name.text);
        continue;
      }
      const modifiers = ts.canHaveModifiers(statement) ? ts.getModifiers(statement) : undefined;
      if (!modifiers?.some(item => item.kind === ts.SyntaxKind.ExportKeyword)) continue;
      if (modifiers.some(item => item.kind === ts.SyntaxKind.DefaultKeyword)) available.add("default");
      else if (ts.isVariableStatement(statement)) for (const item of statement.declarationList.declarations) binding(item.name);
      else if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement) || ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement) || ts.isEnumDeclaration(statement)) && statement.name) available.add(statement.name.text);
    }
    if (!wildcard && names.some(name => !available.has(name))) throw new Error(`Requested export is absent from ${module.path}: ${names.filter(name => !available.has(name)).join(", ")}`);
  }
  function packageModule(input: string, root: string, manifest: PackageManifest, names: readonly string[], publicSpecifier?: string): SourceModule {
    const absolute = safeFile(confined(root, input)), rel = relative(root, absolute).split(sep).join("/"), raw = readFileSync(absolute, "utf8");
    const origin = { absolute, root, manifest }, path = `components/_vendor/${manifest.name.replace(/^@[^/]+\//, "")}/${rel}`;
    const ownerSlot = owner(manifest, rel, names, publicSpecifier);
    if (ownerSlot && !selected.has(ownerSlot)) throw new Error(`Source component ${ownerSlot} is outside selected library: ${rel}`);
    const forwarding = facade(raw, path, names, origin);
    if (forwarding) return { ...forwarding, ...(ownerSlot ? { ownerSlot } : {}) };
    const previous = implementations.get(absolute); if (previous) { assertExports(previous, names); return previous; }
    const normalized = normalizedSource(path, raw);
    const module = register({ ...normalized, origin: "installed", ...(ownerSlot ? { ownerSlot } : {}) }, origin);
    assertExports(module, names); implementations.set(absolute, module); return module;
  }
  function consumerModule(input: string, names: readonly string[]): SourceModule {
    const absolute = safeFile(confined(appRoot, input)), previous = implementations.get(absolute); if (previous) { assertExports(previous, names); return previous; }
    const rel = relative(resolve(appRoot), absolute).split(sep).join("/"), normalized = normalizedSource(`components/_consumer/${rel}`, readFileSync(absolute, "utf8"));
    const module = register({ ...normalized, origin: "consumer" }, { absolute, root: resolve(appRoot), manifest: { name: "consumer", dependencies: { ...dependencies } } });
    assertExports(module, names); implementations.set(absolute, module); return module;
  }
  function packageTarget(origin: Origin, target: string, names: readonly string[]): SourceModule {
    if (!target.startsWith("./")) throw new Error("Package source target must remain inside its owner");
    const relativeSource = target.replace(/^\.\/dist\//, "src/");
    return packageModule(sourceFile(confined(origin.root, join(origin.root, relativeSource))), origin.root, origin.manifest, names);
  }
  /** Generated leaf indexes address the selected descriptor, not an installed default. */
  function selectedIndex(path: string, names: readonly string[], files: ReadonlyMap<string, string>): SourceModule | undefined {
    const leaf = /^components\/([a-z][a-z0-9-]*)\/index(?:\.(?:js|ts|tsx))?$/.exec(path)?.[1];
    if (!leaf) return undefined;
    const slot = `components.${leaf}`, fill = selectedFills.get(slot);
    if (!fill) throw new Error(`Source component ${slot} is outside selected library`);
    if (fill.impl.kind === "composed") throw new Error("Selected component has no materialized source");
    const exports = [fill.impl.export, ...(fill.secondaryExports?.map(entry => entry.export) ?? [])];
    if (names.some(name => name !== "*" && !exports.includes(name))) throw new Error(`Requested export is absent from selected ${slot}`);
    const requested = !names.length || names.includes("*") ? exports : names;
    if (fill.impl.kind === "source") {
      const content = files.get(fill.impl.entry);
      if (content === undefined) throw new Error("Selected component source is not receipted");
      const module = { path: fill.impl.entry, content, ownerSlot: slot };
      assertExports(module, requested);
      return module;
    }
    const resolution = resolveModule({ specifier: fill.impl.module, importer: undefined, names: requested, files });
    if (resolution.kind !== "source") throw new Error("Selected component requires actual source");
    return { ...resolution.module, ownerSlot: slot };
  }
  function resolveModule(request: SourceRequest): SourceResolution {
    const { specifier, importer, names, files } = request;
    if (specifier.startsWith("node:") || builtinModules.includes(specifier)) return { kind: "builtin" };
    if (/^(?:https?:|data:)/.test(specifier)) throw new Error("Remote source modules are unsupported");
    if (specifier.startsWith("#")) {
      const origin = importer && origins.get(importer.path); if (!origin) throw new Error("Package-private source import has no owning package");
      const table = origin.manifest.imports ?? {}, active = new Set(conditions);
      if (importer && syntax(importer).statements.some(statement => ts.isExpressionStatement(statement) && ts.isStringLiteral(statement.expression) && statement.expression.text === "use client")) active.delete("react-server");
      let target = condition(table[specifier], active);
      if (!target) for (const [pattern, value] of Object.entries(table)) {
        const star = pattern.indexOf("*"); if (star < 0 || !specifier.startsWith(pattern.slice(0, star)) || !specifier.endsWith(pattern.slice(star + 1))) continue;
        target = condition(value, active)?.replaceAll("*", specifier.slice(star, specifier.length - (pattern.length - star - 1))); if (target) break;
      }
      if (!target) throw new Error("Owning package has no active source import mapping");
      return { kind: "source", module: packageTarget(origin, target, names) };
    }
    if (specifier.startsWith(".")) {
      if (!importer) throw new Error("Relative source needs an importer");
      const localPath = posix.normalize(posix.join(posix.dirname(importer.path), specifier));
      const candidates = [localPath, localPath.replace(/\.js$/, ".ts"), localPath.replace(/\.js$/, ".tsx"), `${localPath}.ts`, `${localPath}.tsx`, `${localPath}/index.ts`, `${localPath}/index.tsx`];
      const synthesized = candidates.map(path => virtual.get(path)).find(Boolean); if (synthesized) return { kind: "source", module: synthesized };
      const local = candidates.find(path => files.has(path));
      if (local) {
        const normalized = normalizedSource(local, files.get(local)!);
        return { kind: "source", module: normalized.path === local ? { ...normalized } : { ...normalized, origin: "consumer", ownerSlot: /^components\/([a-z][a-z0-9-]*)\//.test(local) ? `components.${local.split("/")[1]}` : undefined } };
      }
      const origin = origins.get(importer.path);
      const selectedPath = origin?.manifest.name === "@clossys/designer"
        ? relative(origin.root, confined(origin.root, resolve(dirname(origin.absolute), specifier))).split(sep).join("/").replace(/^src\//, "")
        : localPath;
      const component = selectedIndex(selectedPath, names, files);
      if (component) return { kind: "source", module: component };
      if (origin) return { kind: "source", module: origin.manifest.name === "consumer" ? consumerModule(sourceFile(confined(origin.root, resolve(dirname(origin.absolute), specifier))), names) : packageModule(sourceFile(confined(origin.root, resolve(dirname(origin.absolute), specifier))), origin.root, origin.manifest, names) };
      return { kind: "source", module: consumerModule(sourceFile(confined(appRoot, resolve(appRoot, localPath))), names) };
    }
    if (specifier.startsWith("@clossys/")) {
      const name = packageName(specifier), pkg = installed(name, specifier), subpath = specifier === name ? "." : `.${specifier.slice(name.length)}`;
      const target = typeof pkg.manifest.exports === "string" && subpath === "." ? pkg.manifest.exports : pkg.manifest.exports && typeof pkg.manifest.exports === "object" ? condition((pkg.manifest.exports as Record<string, unknown>)[subpath], conditions) : undefined;
      if (!target) throw new Error("First-party source export is unavailable");
      return { kind: "source", module: packageTarget({ absolute: pkg.root, root: pkg.root, manifest: pkg.manifest }, target, names) };
    }
    const name = packageName(specifier), origin = importer ? origins.get(importer.path) : undefined, manifest = origin?.manifest;
    const declared = manifest?.dependencies?.[name] ?? manifest?.peerDependencies?.[name] ?? manifest?.optionalDependencies?.[name] ?? dependencies[name];
    if (typeof declared !== "string") throw new Error(`Undeclared third-party source dependency: ${name}`);
    const version = dependencies[name] === undefined ? mergeSourceDependencyRanges(undefined, declared) : mergeSourceDependencyRanges(declared, dependencies[name]!);
    return { kind: "dependency", name, version };
  }
  return resolveModule;
}
