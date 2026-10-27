import ts from "typescript";
import { readFileSync, realpathSync, statSync, readdirSync } from "node:fs";
import { dirname, extname, isAbsolute, relative, resolve, sep } from "node:path";

const extensions = [".tsx", ".ts", ".jsx", ".js", ".mjs", ".css"];
const inside = (root, file) => { const path = relative(root, file); return !isAbsolute(path) && path !== ".." && !path.startsWith(`..${sep}`); };
export function dogfoodLocalFile(file, specifier) {
  const path = resolve(dirname(file), specifier), base = path.replace(/\.[cm]?jsx?$/, "");
  if (extname(path) && ![...extensions, ".json"].includes(extname(path))) throw new Error(`unsupported import source extension ${specifier}`);
  for (const candidate of [path, ...extensions.map(extension => base + extension), ...extensions.map(extension => resolve(path, "index" + extension))]) {
    let regular = false;
    try { regular = statSync(candidate).isFile(); } catch { /* Try the next exact source path. */ }
    if (regular) {
      const target = realpathSync(candidate);
      if (![...extensions, ".json"].includes(extname(target))) throw new Error(`unsupported import source extension ${specifier}`);
      return target;
    }
  }
  throw new Error(`unresolved local import ${specifier}`);
}

function runtimeEntry(value, css = false) {
  if (typeof value === "string") return value;
  if (!value || Array.isArray(value) || typeof value !== "object") throw new Error("unresolved runtime export condition");
  // Inspect the import/default runtime, never a types-only or server-only promise.
  if (css && Object.hasOwn(value, "style")) return runtimeEntry(value.style, css);
  for (const [condition, entry] of Object.entries(value)) if ((css ? ["import", "default"] : ["import", "node", "default"]).includes(condition)) return runtimeEntry(entry, css);
  throw new Error("unresolved runtime export condition");
}

/** Resolve an exact public package export to actual source. No package name earns
 * an exemption: the caller must inspect the returned file and its closure. */
export function dogfoodPackageFile(file, specifier, designerRoot, { css = false, onRead = () => {} } = {}) {
  const match = /^(@[^/.][^/]*\/[^/.][^/]*|[^@./][^/]*)(\/.*)?$/.exec(specifier);
  if (!match || /[\\:%?#]/.test(specifier) || specifier.split("/").some(part => !part || part === "." || part === "..")) throw new Error(`unqualified external import ${specifier}`);
  const name = match[1], subpath = match[2] ? "." + match[2] : ".";
  const roots = [designerRoot];
  // A source checkout's sibling manifests are the authoritative workspace names.
  // Do not derive a package directory from a familiar-looking scope or suffix.
  for (const entry of readdirSync(dirname(designerRoot), { withFileTypes: true })) if (entry.isDirectory()) roots.push(resolve(dirname(designerRoot), entry.name));
  for (let parent = dirname(file);; parent = dirname(parent)) {
    roots.push(resolve(parent, "node_modules", name));
    if (dirname(parent) === parent) break;
  }
  for (const candidate of [...new Set(roots)]) {
    let manifest;
    try { manifest = JSON.parse(readFileSync(resolve(candidate, "package.json"), "utf8")); } catch (error) {
      if (error.code === "ENOENT" || error.code === "ENOTDIR") continue;
      throw new Error(`malformed package manifest for ${specifier}`);
    }
    if (manifest.name !== name) continue;
    const root = realpathSync(candidate), exports = manifest.exports;
    onRead(resolve(root, "package.json"));
    let entry;
    if (exports !== undefined) {
      const subpaths = exports && typeof exports === "object" && Object.keys(exports).some(key => key.startsWith("."));
      entry = runtimeEntry(subpaths ? exports[subpath] : subpath === "." ? exports : undefined, css);
    } else if (subpath === "." && typeof manifest.main === "string") entry = manifest.main.startsWith("./") ? manifest.main : "./" + manifest.main;
    if (typeof entry !== "string" || !entry.startsWith("./") || !inside(root, resolve(root, entry))) throw new Error(`unregistered public export ${specifier}`);
    // This is a source gate. Workspace dist exports map to the same authored src
    // entry, as Designer's existing source contract does; installed packages use
    // their actual exported bytes. Neither path is treated as a trusted boundary.
    const workspace = dirname(root) === realpathSync(dirname(designerRoot));
    const target = workspace && entry.startsWith("./dist/") ? dogfoodLocalFile(resolve(root, "src/_entry.ts"), "./" + entry.slice(7)) : dogfoodLocalFile(resolve(root, "_entry.js"), entry);
    if (!inside(root, target)) throw new Error(`package export leaves its source boundary: ${specifier}`);
    return target;
  }
  throw new Error(`unresolved external import ${specifier}`);
}

/** Exact named export resolution. Unknown, ambiguous, cyclic and malformed
 * barrels refuse rather than allowing the import's spelling to assert ownership. */
export function dogfoodExport(file, name, trail = new Set()) {
  const identity = file + "#" + name;
  if (trail.has(identity)) throw new Error(`cyclic public export ${name}`);
  trail = new Set([...trail, identity]);
  const ast = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, /x$/.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  if (ast.parseDiagnostics.length) throw new Error(`malformed public export source ${file}`);
  const local = new Map(), imported = new Map(), matches = [];
  for (const statement of ast.statements) {
    if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) && statement.name) local.set(statement.name.text, statement);
    if (ts.isVariableStatement(statement)) for (const row of statement.declarationList.declarations) if (ts.isIdentifier(row.name) && row.initializer) local.set(row.name.text, row.initializer);
    if (ts.isImportDeclaration(statement) && statement.importClause && !statement.importClause.isTypeOnly && ts.isStringLiteral(statement.moduleSpecifier) && statement.moduleSpecifier.text.startsWith(".")) {
      const target = dogfoodLocalFile(file, statement.moduleSpecifier.text), clause = statement.importClause;
      if (clause.name) imported.set(clause.name.text, { target, name: "default" });
      if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) for (const row of clause.namedBindings.elements) if (!row.isTypeOnly) imported.set(row.name.text, { target, name: (row.propertyName ?? row.name).text });
    }
  }
  const lookup = original => {
    if (local.has(original)) return { file, name: original, node: local.get(original) };
    const binding = imported.get(original);
    if (binding) return dogfoodExport(binding.target, binding.name, trail);
    throw new Error(`unresolved public export ${original}`);
  };
  for (const statement of ast.statements) {
    const exported = statement.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword);
    const primary = statement.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.DefaultKeyword);
    if (exported && (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) && (primary ? name === "default" : statement.name?.text === name)) matches.push({ file, name, node: statement });
    if (exported && ts.isVariableStatement(statement)) for (const row of statement.declarationList.declarations) if (ts.isIdentifier(row.name) && row.name.text === name && row.initializer) matches.push(lookup(name));
    if (ts.isExportAssignment(statement) && !statement.isExportEquals && name === "default") matches.push(ts.isIdentifier(statement.expression) ? lookup(statement.expression.text) : { file, name, node: statement.expression });
    if (ts.isExportDeclaration(statement) && !statement.isTypeOnly) {
      if (statement.exportClause && ts.isNamedExports(statement.exportClause)) for (const row of statement.exportClause.elements) if (!row.isTypeOnly && row.name.text === name) {
        const original = (row.propertyName ?? row.name).text;
        if (!statement.moduleSpecifier) matches.push(lookup(original));
        else if (ts.isStringLiteral(statement.moduleSpecifier) && statement.moduleSpecifier.text.startsWith(".")) matches.push(dogfoodExport(dogfoodLocalFile(file, statement.moduleSpecifier.text), original, trail));
        else throw new Error(`unresolved public export module ${name}`);
      }
    }
  }
  if (matches.length !== 1) throw new Error(`unresolved or ambiguous public export ${name}`);
  return { ...matches[0], witnesses: [file, ...(matches[0].witnesses ?? [])] };
}
