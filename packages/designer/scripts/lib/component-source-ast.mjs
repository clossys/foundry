// Node-only TypeScript AST reading of stock component source (scripts tooling, never shipped in
// dist). It writes the committed src/catalog-core/component-source-proofs.json, so the runtime and
// the browser never load the compiler: they compare the exact source bytes (sha256) and script kind
// with a proof this reader wrote. Unknown bytes have no proof. The kind and key below must match
// src/catalog-core/component-source-proofs.ts; component-source-proofs.test.ts pins both together.
import { createHash } from "node:crypto";
import ts from "typescript";

/** A source the reader refuses rather than guesses (same "components: ..." messages as CatalogError). */
export class ComponentSourceError extends Error {}

/** The script kind a module path is parsed as; only .ts and .tsx sources carry proofs. */
export function componentSourceKind(path) {
  return /\.tsx$/.test(path) ? "tsx" : /\.ts$/.test(path) ? "ts" : undefined;
}
/** The table key: script kind plus the sha256 of the exact source bytes (UTF-8). */
export function componentSourceProofKey(kind, content) {
  return `${kind}:${createHash("sha256").update(content, "utf8").digest("hex")}`;
}

const sorted = values => [...new Set(values)].sort();

function declaredName(node) {
  if ((ts.isVariableDeclaration(node) || ts.isParameter(node) || ts.isBindingElement(node)) && ts.isIdentifier(node.name)) return node.name;
  if ((ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isClassDeclaration(node) || ts.isClassExpression(node)
    || ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node) || ts.isEnumDeclaration(node) || ts.isTypeParameterDeclaration(node)
    || ts.isImportSpecifier(node) || ts.isImportClause(node)) && node.name && ts.isIdentifier(node.name)) return node.name;
  return undefined;
}

/** True when the identifier names a binding rather than a member, key or label. */
function isReference(id) {
  const parent = id.parent;
  if (ts.isPropertyAccessExpression(parent) && parent.name === id) return false;
  if (ts.isQualifiedName(parent) && parent.right === id) return false;
  if ((ts.isPropertyAssignment(parent) || ts.isPropertySignature(parent) || ts.isPropertyDeclaration(parent) || ts.isMethodDeclaration(parent)
    || ts.isMethodSignature(parent) || ts.isGetAccessor(parent) || ts.isSetAccessor(parent) || ts.isEnumMember(parent)) && parent.name === id) return false;
  if (ts.isBindingElement(parent) && parent.propertyName === id) return false;
  if (ts.isJsxAttribute(parent) && parent.name === id) return false;
  if ((ts.isImportSpecifier(parent) || ts.isExportSpecifier(parent)) && parent.propertyName === id) return false;
  if (ts.isLabeledStatement(parent) || ts.isBreakOrContinueStatement(parent)) return false;
  if (ts.isNamespaceImport(parent)) return false;
  return true;
}

/** An identifier reached only through erased type grammar (not a `typeof` query). */
function inErasedType(node) {
  for (let current = node; current.parent; current = current.parent) {
    const parent = current.parent;
    if (ts.isTypeQueryNode(parent)) return false;
    if (ts.isTypeNode(parent) && !ts.isExpressionWithTypeArguments(parent)) return true;
    if (ts.isExpressionWithTypeArguments(parent) && parent.expression === current) {
      const clause = parent.parent;
      return ts.isHeritageClause(clause) && (ts.isInterfaceDeclaration(clause.parent) || clause.token === ts.SyntaxKind.ImplementsKeyword);
    }
    if (ts.isTypeAliasDeclaration(parent) || ts.isInterfaceDeclaration(parent)) return true;
    if (ts.isExpression(parent) || ts.isStatement(parent)) return false;
  }
  return false;
}

/**
 * Read concrete local function exports and every namespace member read from
 * real source. Syntax errors, shadowed namespaces, computed or optional
 * namespace reads and bare namespace values are refused here, not guessed.
 */
export function analyzeComponentSource(path, content) {
  const ast = ts.createSourceFile(path, content, ts.ScriptTarget.Latest, true, componentSourceKind(path) === "tsx" ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  if (ast.parseDiagnostics.length) throw new ComponentSourceError(`components: source does not parse: ${path}`);
  const functions = [], exports = [];
  const namespaces = new Map();
  for (const statement of ast.statements) {
    if (ts.isImportDeclaration(statement) && statement.importClause?.namedBindings && ts.isNamespaceImport(statement.importClause.namedBindings) && ts.isStringLiteral(statement.moduleSpecifier)) {
      const local = statement.importClause.namedBindings.name.text;
      if (namespaces.has(local)) throw new ComponentSourceError(`components: duplicate namespace import in ${path}`);
      namespaces.set(local, { module: statement.moduleSpecifier.text, erased: statement.importClause.isTypeOnly });
    }
    const exported = ts.canHaveModifiers(statement) && ts.getModifiers(statement)?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword);
    const ambient = ts.canHaveModifiers(statement) && ts.getModifiers(statement)?.some(modifier => modifier.kind === ts.SyntaxKind.DeclareKeyword);
    if (ts.isFunctionDeclaration(statement) && statement.name && statement.body && !ambient) {
      functions.push(statement.name.text);
      if (exported && !ts.getModifiers(statement)?.some(modifier => modifier.kind === ts.SyntaxKind.DefaultKeyword)) exports.push(statement.name.text);
    }
    if (ts.isVariableStatement(statement) && exported && !ambient) {
      for (const declaration of statement.declarationList.declarations) if (ts.isIdentifier(declaration.name)) exports.push(declaration.name.text);
    }
    // Only same-name local value exports; aliases and re-exports prove nothing about a local function.
    if (ts.isExportDeclaration(statement) && !statement.isTypeOnly && !statement.moduleSpecifier && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
      for (const element of statement.exportClause.elements) if (!element.isTypeOnly && !element.propertyName) exports.push(element.name.text);
    }
  }
  const reads = [];
  const visit = node => {
    const declared = declaredName(node);
    if (declared && namespaces.has(declared.text) && !(ts.isNamespaceImport(node.parent))) throw new ComponentSourceError(`components: namespace ${declared.text} is shadowed in ${path}`);
    if (ts.isIdentifier(node) && namespaces.has(node.text) && isReference(node)) {
      const binding = namespaces.get(node.text), parent = node.parent;
      if (ts.isQualifiedName(parent) && parent.left === node) {
        let top = parent;
        while (ts.isQualifiedName(top.parent) && top.parent.left === top) top = top.parent;
        if (ts.isTypeQueryNode(top.parent)) reads.push({ module: binding.module, member: parent.right.text, erased: binding.erased, typeQuery: true });
        else if (!inErasedType(parent)) throw new ComponentSourceError(`components: unsupported namespace escape or access in ${path}`);
      } else if (ts.isPropertyAccessExpression(parent) && parent.expression === node) {
        if (parent.questionDotToken || !ts.isIdentifier(parent.name)) throw new ComponentSourceError(`components: unsupported namespace escape or access in ${path}`);
        if (!inErasedType(parent)) reads.push({ module: binding.module, member: parent.name.text, erased: binding.erased, typeQuery: false });
      } else if (ts.isElementAccessExpression(parent) && parent.expression === node) {
        throw new ComponentSourceError(`components: unsupported computed namespace read in ${path}`);
      } else throw new ComponentSourceError(`components: unsupported namespace escape or access in ${path}`);
    }
    ts.forEachChild(node, visit);
  };
  for (const statement of ast.statements) if (!ts.isImportDeclaration(statement)) visit(statement);
  const unique = new Map(reads.map(read => [`${read.module}\0${read.member}\0${read.erased}\0${read.typeQuery}`, read]));
  return {
    functions: sorted(functions),
    exports: sorted(exports),
    namespaces: Object.fromEntries([...namespaces].sort(([a], [b]) => a < b ? -1 : 1)),
    reads: [...unique.values()].sort((a, b) => `${a.module}\0${a.member}\0${a.typeQuery}` < `${b.module}\0${b.member}\0${b.typeQuery}` ? -1 : 1),
  };
}

/** The committed proof table: one entry per distinct stock TypeScript source (script kind + exact bytes). */
export function componentSourceProofs(files) {
  const proofs = {};
  for (const file of [...files].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)) {
    const kind = componentSourceKind(file.path);
    if (!kind) continue;
    const key = componentSourceProofKey(kind, file.content);
    if (proofs[key]) continue;
    proofs[key] = analyzeComponentSource(file.path, file.content);
  }
  return { $generated: "scripts/generate-component-source-proofs.mjs", proofs: Object.fromEntries(Object.entries(proofs).sort(([a], [b]) => a < b ? -1 : 1)) };
}
