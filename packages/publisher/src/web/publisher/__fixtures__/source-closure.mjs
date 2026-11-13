import { readFileSync, existsSync } from "node:fs";
import { dirname, join, posix } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
const sourceRoot = fileURLToPath(new URL("../../../", import.meta.url));

/** Snapshot actual source bytes, retaining all local imports for conservative LK11 inspection. */
export function layoutSourceClosure(entry) {
  const files = {};
  const visit = file => {
    if (Object.hasOwn(files, file)) return;
    const source = readFileSync(join(sourceRoot, file), "utf8"); files[file] = source;
    if (file.endsWith(".json")) return;
    const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    for (const statement of ast.statements) {
      if (!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) continue;
      if (ts.isImportDeclaration(statement) && statement.importClause?.isTypeOnly) continue;
      if (ts.isExportDeclaration(statement) && statement.isTypeOnly) continue;
      const specifier = statement.moduleSpecifier;
      if (!specifier || !ts.isStringLiteral(specifier) || !specifier.text.startsWith(".")) continue;
      const path = posix.normalize(posix.join(dirname(file), specifier.text));
      const resolved = [path, path.replace(/\.js$/, ".ts"), path.replace(/\.js$/, ".tsx")].find(candidate => existsSync(join(sourceRoot, candidate)));
      if (resolved) visit(resolved);
    }
  };
  visit(entry); return { entry, files };
}
