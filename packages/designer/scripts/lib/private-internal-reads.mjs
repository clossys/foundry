// Node producer annotation only. Permissions never supply observed source use.
import { createHash } from "node:crypto";
import { posix as path } from "node:path";
import ts from "typescript";

const digest = content => createHash("sha256").update(content).digest("hex");
const safePath = value => typeof value === "string" && /^[A-Za-z0-9_-][A-Za-z0-9_.-]*(?:\/[A-Za-z0-9_-][A-Za-z0-9_.-]*)*$/.test(value) && !value.split("/").some(part => part === "." || part === "..");
const runtimeImport = node => ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && (!node.importClause || !node.importClause.isTypeOnly && (node.importClause.name || !node.importClause.namedBindings || ts.isNamespaceImport(node.importClause.namedBindings) || node.importClause.namedBindings.elements.some(item => !item.isTypeOnly)));

export function classifyPrivateInternalReads({ scan, declarations = [], packageRoot, read, scanAssets }) {
  if (!Array.isArray(declarations) || new Set(declarations).size !== declarations.length || declarations.some(target => !safePath(target) || !target.startsWith(packageRoot + "/") || !target.slice(packageRoot.length + 1).includes("/internal/") && !target.slice(packageRoot.length + 1).startsWith("internal/") || !/\.[cm]?tsx?$/.test(target))) throw new Error("Invalid private internal read declaration");
  if (!declarations.length) return { scan, witnesses: [] };
  const printer = ts.createPrinter({ removeComments: true });
  const parse = (file, content) => ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const witnesses = [];
  const files = scan.files.map(file => {
    const original = read(file.path);
    if (original === undefined || !file.path.startsWith(packageRoot + "/")) return file;
    const originalAst = parse(file.path, original), selectedAst = parse(file.path, file.content);
    if (originalAst.parseDiagnostics.length || selectedAst.parseDiagnostics.length) return file;
    const edits = [];
    for (const selected of selectedAst.statements.filter(runtimeImport)) {
      const specifier = selected.moduleSpecifier.text;
      if (!specifier.startsWith("./") && !specifier.startsWith("../")) continue;
      const printed = printer.printNode(ts.EmitHint.Unspecified, selected, selectedAst);
      const matches = originalAst.statements.filter(node => runtimeImport(node) && printer.printNode(ts.EmitHint.Unspecified, node, originalAst) === printed);
      if (matches.length !== 1) continue;
      const base = path.normalize(path.join(path.dirname(file.path), specifier)).replace(/\.[cm]?jsx?$/, "");
      const target = [base + ".ts", base + ".tsx", path.join(base, "index.ts"), path.join(base, "index.tsx")].find(candidate => candidate.startsWith(packageRoot + "/") && read(candidate) !== undefined);
      if (!target || !declarations.includes(target)) continue;
      const rawAssets = scanAssets(file.path, selected.moduleSpecifier.getText(selectedAst));
      if (!rawAssets.length) continue;
      const node = matches[0];
      witnesses.push({ target, targetSha256: digest(read(target)), file: file.path, sourceSha256: digest(original), specifier, line: originalAst.getLineAndCharacterOfPosition(node.getStart(originalAst)).line + 1, rawAssets });
      // Replace only this AST-proven module literal, retaining all runtime expressions.
      edits.push([selected.moduleSpecifier.getStart(selectedAst), selected.moduleSpecifier.end]);
    }
    let content = file.content;
    for (const [start, end] of edits.sort((a, b) => b[0] - a[0])) content = content.slice(0, start) + '"' + " ".repeat(end - start - 2) + '"' + content.slice(end);
    return edits.length ? { ...file, content } : file;
  });
  witnesses.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.target.localeCompare(b.target));
  return { scan: { ...scan, files }, witnesses };
}
