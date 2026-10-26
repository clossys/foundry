// Source-only import/export reachability for the section/frame consumption report.
// This tooling never loads component modules, follows consumer files or runs a renderer.
import { posix as path } from "node:path";
import ts from "typescript";

export function createSurfaceSourceScanner({ read, packages }) {
  const modules = new Map(), owners = new Map(), printer = ts.createPrinter({ removeComments: true });
  const key = target => `${target.file}#${target.name}`;
  const names = node => ts.isIdentifier(node) ? [node.text] : ts.isObjectBindingPattern(node) || ts.isArrayBindingPattern(node) ? node.elements.flatMap(item => ts.isBindingElement(item) ? names(item.name) : []) : [];
  function localTarget(file, specifier) {
    let base;
    if (specifier.startsWith(".")) base = path.normalize(path.join(path.dirname(file), specifier));
    else {
      const pkg = Object.keys(packages).find(name => specifier === name || specifier.startsWith(name + "/"));
      if (!pkg) return undefined;
      base = path.join(packages[pkg], specifier.slice(pkg.length));
    }
    // The read port only admits source under the named in-repository packages.
    base = base.replace(/\.[cm]?jsx?$/, "");
    return [base + ".ts", base + ".tsx", path.join(base, "index.ts"), path.join(base, "index.tsx")].find(file => read(file) !== undefined);
  }
  function moduleInfo(file) {
    if (modules.has(file)) return modules.get(file);
    const source = read(file); if (source === undefined) return undefined;
    const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const info = { ast, declarations: new Map(), imports: new Map(), exports: new Map(), stars: [] };
    modules.set(file, info);
    for (const statement of ast.statements) {
      if (ts.isImportDeclaration(statement) && statement.importClause && !statement.importClause.isTypeOnly) {
        const specifier = statement.moduleSpecifier.text, target = localTarget(file, specifier), clause = statement.importClause;
        const add = (name, symbol) => info.imports.set(name, { file: target, name: symbol, specifier, statement });
        if (clause.name) add(clause.name.text, "default");
        if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) for (const item of clause.namedBindings.elements) if (!item.isTypeOnly) add(item.name.text, item.propertyName?.text ?? item.name.text);
        if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) add(clause.namedBindings.name.text, "*");
      }
      if (ts.isExportDeclaration(statement) && !statement.isTypeOnly) {
        const target = statement.moduleSpecifier ? localTarget(file, statement.moduleSpecifier.text) : file;
        if (statement.exportClause && ts.isNamedExports(statement.exportClause)) {
          for (const item of statement.exportClause.elements) if (!item.isTypeOnly && target) info.exports.set(item.name.text, { file: target, name: item.propertyName?.text ?? item.name.text });
        } else if (!statement.exportClause && target) info.stars.push(target);
      }
      const exported = statement.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword);
      if (ts.isVariableStatement(statement)) for (const declaration of statement.declarationList.declarations) for (const name of names(declaration.name)) {
        info.declarations.set(name, ts.factory.updateVariableStatement(statement, statement.modifiers, ts.factory.updateVariableDeclarationList(statement.declarationList, [declaration])));
        if (exported) info.exports.set(name, { file, name });
      }
      if (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement) || ts.isEnumDeclaration(statement)) {
        const name = statement.name?.text ?? "default";
        info.declarations.set(name, statement);
        if (exported) info.exports.set(statement.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.DefaultKeyword) ? "default" : name, { file, name });
      }
      if (ts.isExportAssignment(statement) && !statement.isExportEquals) { info.declarations.set("default", statement); info.exports.set("default", { file, name: "default" }); }
    }
    return info;
  }
  function exportTarget(file, name, seen = new Set()) {
    const identity = `${file}#${name}`; if (seen.has(identity)) return undefined; seen.add(identity);
    const info = moduleInfo(file); if (!info) return undefined;
    const target = info.exports.get(name) ?? info.imports.get(name);
    if (target) return target.file === file && target.name === name ? target : target.file ? exportTarget(target.file, target.name, seen) : undefined;
    for (const star of info.stars) { const found = exportTarget(star, name, new Set(seen)); if (found) return found; }
    return undefined;
  }
  function pointer(packageName, address) {
    const match = /^\.\/([^#]+)#([A-Za-z_$][\w$]*)/.exec(address ?? "");
    if (!match) return undefined;
    const file = localTarget("", `${packageName}/${match[1]}`);
    return file ? exportTarget(file, match[2]) : undefined;
  }
  function scan({ fill, packageName, pointer: address }) {
    const target = pointer(packageName, address), selected = new Map(), seen = new Set(), resolvedImports = {}, unresolved = [];
    const issue = (file, node, evidence, code = "DF2") => unresolved.push({ file, line: node ? moduleInfo(file).ast.getLineAndCharacterOfPosition(node.getStart()).line + 1 : 0, code, evidence });
    const select = (file, name, node) => {
      if (!selected.has(file)) selected.set(file, new Map());
      selected.get(file).set(name, printer.printNode(ts.EmitHint.Unspecified, node, moduleInfo(file).ast));
    };
    function visit(target) {
      const identity = key(target); if (seen.has(identity)) return; seen.add(identity);
      const info = moduleInfo(target.file), node = info?.declarations.get(target.name);
      if (!node) { issue(target.file, undefined, `unresolved runtime declaration ${target.name}`); return; }
      select(target.file, target.name, node);
      const references = new Set(), members = new Map();
      function walk(node) {
        if (ts.isTypeNode(node) || ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) return;
        if (ts.isIdentifier(node)) references.add(node.text);
        if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression)) { const name = node.expression.text; if (!members.has(name)) members.set(name, new Set()); members.get(name).add(node.name.text); }
        if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) issue(target.file, node, "unresolved dynamic import; runtime source is not inferred");
        if (ts.isElementAccessExpression(node) && ts.isIdentifier(node.expression) && info.imports.get(node.expression.text)?.name === "*") issue(target.file, node, "unresolved computed namespace access");
        ts.forEachChild(node, walk);
      }
      walk(node);
      for (const symbol of [...references].sort()) {
        const imported = info.imports.get(symbol);
        if (!imported) { if (info.declarations.has(symbol)) visit({ file: target.file, name: symbol }); continue; }
        select(target.file, `import:${imported.specifier}`, imported.statement);
        if (!imported.file) continue; // Unknown JSX import provenance is DF5 in the shared parser.
        for (const name of imported.name === "*" ? members.get(symbol) ?? [] : [imported.name]) {
          const resolved = exportTarget(imported.file, name);
          if (!resolved) { issue(target.file, imported.statement, `unresolved source export ${imported.specifier}#${name}`); continue; }
          const slots = [...(owners.get(key(resolved)) ?? [])].sort();
          if (slots.length === 1) { resolvedImports[`${target.file}:${imported.specifier}#${name}`] = slots[0]; continue; }
          if (slots.length > 1) { issue(target.file, imported.statement, `ambiguous slot ownership ${imported.specifier}#${name}: ${slots.join(", ")}`, "DF5"); continue; }
          // Literal glyph imports are not registered assets simply because the name looks familiar.
          if (/\/icons\//.test(resolved.file)) issue(target.file, imported.statement, `unregistered asset import ${imported.specifier}#${name}`, "DF5");
          if (/\/(?:tokens\/tokens|components\/glyph-context)\.ts$/.test(resolved.file)) { issue(target.file, imported.statement, `unresolved injected runtime inventory ${imported.specifier}#${name}`); continue; }
          visit(resolved);
        }
      }
    }
    if (target) visit(target); else issue("", undefined, `unresolved source ${packageName}${address ?? ""}`);
    return { fill, files: [...selected].sort(([a], [b]) => a.localeCompare(b)).map(([file, nodes]) => ({ path: file, content: [...nodes].sort(([a], [b]) => a.localeCompare(b)).map(([, text]) => text).join("\n") })), resolvedImports,
      unresolved: [...new Map(unresolved.map(row => [JSON.stringify(row), row])).values()].sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.evidence.localeCompare(b.evidence)) };
  }
  return { pointer, scan, addOwner(target, slot) { if (target) { const identity = key(target); if (!owners.has(identity)) owners.set(identity, new Set()); owners.get(identity).add(slot); } } };
}
