import ts from 'typescript';
import fs from 'node:fs';
import path from 'node:path';
import { registerHooks } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const dynamicPrefix = 'surface-source-dynamic:';
const resolvePrefix = 'surface-source-resolve:';
const runtimeModule = import.meta.url;
let generation = 0;
let active = false;

/** Distinct requests keep a dynamic installed import separate from a same-named static source edge. */
export const sourceDynamicSpecifier = value => dynamicPrefix + encodeURIComponent(value);
export const sourceResolveSpecifier = value => resolvePrefix + encodeURIComponent(value);

/** Execute current native source as ESM, retaining hooks through the complete awaited caller. */
export async function runSourceEsm(repository, run) {
  if (active) throw new Error('A native source runtime is already active');
  const root = path.resolve(repository);
  const sourceRoots = fs.readdirSync(path.join(root, 'packages'), { withFileTypes: true })
    .filter(entry => entry.isDirectory() && fs.existsSync(path.join(root, 'packages', entry.name, 'package.json')))
    .map(entry => path.join(root, 'packages', entry.name, 'src') + path.sep);
  const owned = file => sourceRoots.some(directory => file.startsWith(directory));
  const asPath = url => { try { return url.startsWith('file:') ? fileURLToPath(url) : undefined; } catch { return undefined; } };
  const existing = file => [file.replace(/\.js$/, '.ts'), file.replace(/\.js$/, '.tsx'), file]
    .find(candidate => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
  const sourceOfDistribution = file => {
    const relative = path.relative(root, file);
    const match = /^packages\/([^/]+)\/dist\/(.+)$/.exec(relative.split(path.sep).join('/'));
    if (!match) return undefined;
    const source = existing(path.join(root, 'packages', match[1], 'src', match[2]));
    if (!source || !owned(source)) throw new Error(`Native source dependency missing: ${relative}`);
    return source;
  };
  const revision = String(++generation);
  const sourceUrl = file => { const url = pathToFileURL(file); url.searchParams.set('surface-source-runtime', revision); return url.href; };
  const modules = new Map();
  const moduleOf = file => {
    if (modules.has(file)) return modules.get(file);
    const text = fs.readFileSync(file, 'utf8');
    const ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const edges = new Set(ast.statements.filter(node => ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
      .map(node => node.moduleSpecifier).filter(node => node && ts.isStringLiteralLike(node)).map(node => node.text));
    const names = new Set();
    const visit = node => { if (ts.isIdentifier(node)) names.add(node.text); ts.forEachChild(node, visit); };
    visit(ast);
    const unique = base => { let name = base; while (names.has(name)) name += '_'; names.add(name); return name; };
    const module = { text, ast, edges, dynamic: unique('__surfaceSourceDynamic'), resolve: unique('__surfaceSourceResolve') };
    modules.set(file, module); return module;
  };
  const sourceRelative = (specifier, parent) => {
    const file = asPath(new URL(specifier, parent).href);
    if (!file) return undefined;
    const source = sourceOfDistribution(file) ?? (owned(file) ? existing(file) : undefined);
    return source ? { url: sourceUrl(source), shortCircuit: true } : undefined;
  };
  const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier.startsWith(resolvePrefix)) return nextResolve(decodeURIComponent(specifier.slice(resolvePrefix.length)), context);
      if (specifier.startsWith(dynamicPrefix)) {
        const actual = decodeURIComponent(specifier.slice(dynamicPrefix.length));
        if (actual.startsWith('.') || actual.startsWith('file:')) {
          const selected = sourceRelative(actual, context.parentURL);
          if (selected) return selected;
        }
        return nextResolve(actual, context);
      }
      const parent = context.parentURL && asPath(context.parentURL);
      if (parent && owned(parent) && /\.[cm]?tsx?$/.test(parent) && moduleOf(parent).edges.has(specifier)) {
        if (specifier.startsWith('.')) {
          const selected = sourceRelative(specifier, context.parentURL);
          if (selected) return selected;
        }
        const resolved = nextResolve(specifier, context);
        const file = asPath(resolved.url);
        if (file && specifier.startsWith('@clossys/')) {
          const source = sourceOfDistribution(file);
          if (!source) throw new Error(`Native source export missing: ${specifier}`);
          return { ...resolved, url: sourceUrl(source), shortCircuit: true };
        }
        return resolved;
      }
      return nextResolve(specifier, context);
    },
    load(url, context, nextLoad) {
      const file = asPath(url);
      if (!file || !owned(file) || !/\.[cm]?tsx?$/.test(file)) return nextLoad(url, context);
      const module = moduleOf(file);
      const output = ts.transpileModule(module.text, {
        fileName: file,
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
        transformers: { before: [factoryContext => {
          const factory = factoryContext.factory;
          let dynamicUsed = false, resolveUsed = false;
          const visit = node => {
            if (ts.isCallExpression(node) && node.arguments.length) {
              if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
                dynamicUsed = true;
                return factory.updateCallExpression(node, node.expression, node.typeArguments, [factory.createCallExpression(factory.createIdentifier(module.dynamic), undefined, [ts.visitNode(node.arguments[0], visit)]), ...node.arguments.slice(1).map(argument => ts.visitNode(argument, visit))]);
              }
              if (ts.isPropertyAccessExpression(node.expression) && ts.isMetaProperty(node.expression.expression) && node.expression.expression.keywordToken === ts.SyntaxKind.ImportKeyword && node.expression.name.text === 'resolve') {
                resolveUsed = true;
                return factory.updateCallExpression(node, node.expression, node.typeArguments, [factory.createCallExpression(factory.createIdentifier(module.resolve), undefined, [ts.visitNode(node.arguments[0], visit)]), ...node.arguments.slice(1).map(argument => ts.visitNode(argument, visit))]);
              }
            }
            if (ts.isPropertyAccessExpression(node) && ts.isMetaProperty(node.expression) && node.expression.keywordToken === ts.SyntaxKind.ImportKeyword && node.name.text === 'resolve') throw new Error(`Native source resolver must be called directly: ${path.relative(root, file)}`);
            return ts.visitEachChild(node, visit, factoryContext);
          };
          return source => {
            const transformed = ts.visitNode(source, visit);
            const imports = [];
            if (dynamicUsed) imports.push(factory.createImportSpecifier(false, factory.createIdentifier('sourceDynamicSpecifier'), factory.createIdentifier(module.dynamic)));
            if (resolveUsed) imports.push(factory.createImportSpecifier(false, factory.createIdentifier('sourceResolveSpecifier'), factory.createIdentifier(module.resolve)));
            return imports.length ? factory.updateSourceFile(transformed, [factory.createImportDeclaration(undefined, factory.createImportClause(false, undefined, factory.createNamedImports(imports)), factory.createStringLiteral(runtimeModule)), ...transformed.statements]) : transformed;
          };
        }] },
      });
      return { format: 'module', source: output.outputText, shortCircuit: true };
    },
  });
  active = true;
  try {
    return await run(async file => {
      const selected = path.resolve(root, file);
      if (!owned(selected) || !fs.existsSync(selected)) throw new Error('Native source entry must be an existing workspace source file');
      return import(sourceUrl(selected));
    });
  } finally { hooks.deregister(); active = false; }
}
