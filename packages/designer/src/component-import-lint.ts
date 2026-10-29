/** Independent source rule: runtime and blocks select components through the consumer index. */
import ts from "typescript";
export interface ComponentImportFinding { readonly path: string; readonly line: number; readonly specifier: string }
/** Erased type imports carry no implementation and are intentionally allowed. */
export function componentImportFindings(path: string, source: string, resolve?: (specifier: string) => string | undefined): ComponentImportFinding[] {
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const findings: ComponentImportFinding[] = [];
  function check(node: ts.Node, literal: ts.Expression) {
    if (!ts.isStringLiteralLike(literal)) return;
    const specifier = literal.text, resolved = resolve?.(specifier)?.replaceAll("\\", "/");
    if (!/(?:^|\/)components(?:\/|$)/.test(specifier) && !(resolved && /\/src\/components\//.test(resolved))) return;
    findings.push({ path, line: file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1, specifier });
  }
  function visit(node: ts.Node): void {
    if (ts.isImportDeclaration(node)) {
      const clause = node.importClause, bindings = clause?.namedBindings;
      if (clause?.isTypeOnly || bindings && ts.isNamedImports(bindings) && bindings.elements.length > 0 && bindings.elements.every(item => item.isTypeOnly)) return;
      check(node, node.moduleSpecifier);
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
      if (node.isTypeOnly || node.exportClause && ts.isNamedExports(node.exportClause) && node.exportClause.elements.length > 0 && node.exportClause.elements.every(item => item.isTypeOnly)) return;
      check(node, node.moduleSpecifier);
    } else if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || ts.isIdentifier(node.expression) && node.expression.text === "require") && node.arguments[0]) check(node, node.arguments[0]);
    ts.forEachChild(node, visit);
  }
  visit(file);
  return findings;
}
